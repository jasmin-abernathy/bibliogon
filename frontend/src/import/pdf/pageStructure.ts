/**
 * Deterministic PDF page classification for the local-first importer.
 *
 * The goal is deliberately conservative: keep the source page order and text,
 * discard visual styling, and infer only a few robust page roles. A short
 * display page becomes one editable text block; numbered section openers start
 * chapters; longer unnumbered pages may start semantic sections.
 */

export interface PdfTextLine {
    page: number;
    pageHeight: number;
    x: number;
    y: number;
    fontSize: number;
    text: string;
}

export type PdfPageKind = "cover" | "chapter" | "section" | "short" | "prose";

export interface SimplifiedPdfPage {
    page: number;
    kind: PdfPageKind;
    heading?: string;
    chapterNumber?: string;
    blocks: string[];
}

export interface PdfPageAnalysis {
    pages: SimplifiedPdfPage[];
    removedRepeatedLines: number;
    shortPageCount: number;
}

const SHORT_PAGE_MAX_CHARS = 180;
const SHORT_PAGE_MAX_LINES = 8;

function median(values: number[]): number {
    if (values.length === 0) return 12;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function cleanPdfTextFragment(text: string): string {
    return text
        .normalize("NFC")
        // Canva/PDF exports can leak U+FFFE where a visible line-break hyphen
        // was used (for example "libre￾arbitre"). Keep the lexical hyphen.
        .replace(/\uFFFE/g, "-")
        // Soft hyphens are discretionary layout hints, not book content.
        .replace(/\u00AD/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
}

function normaliseRepeatedText(text: string): string {
    return cleanPdfTextFragment(text)
        .toLocaleLowerCase()
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim();
}

function repeatedEdgeKeys(lines: PdfTextLine[], pageCount: number): Set<string> {
    const pagesByKey = new Map<string, Set<number>>();

    for (const line of lines) {
        const atEdge = line.y <= line.pageHeight * 0.11 || line.y >= line.pageHeight * 0.89;
        const key = normaliseRepeatedText(line.text);
        if (!atEdge || key.length < 2 || key.length > 120) continue;

        const pages = pagesByKey.get(key) ?? new Set<number>();
        pages.add(line.page);
        pagesByKey.set(key, pages);
    }

    const threshold = Math.max(2, Math.ceil(pageCount * 0.45));
    return new Set(
        [...pagesByKey.entries()]
            .filter(([, pages]) => pages.size >= threshold)
            .map(([key]) => key),
    );
}

function sortedLines(lines: PdfTextLine[]): PdfTextLine[] {
    return [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
}

function weightedBodySize(lines: PdfTextLine[]): number {
    const weighted = lines.flatMap((line) =>
        Array.from(
            { length: Math.max(1, Math.ceil(cleanPdfTextFragment(line.text).length / 12)) },
            () => line.fontSize,
        ),
    );
    return median(weighted.filter((size) => size > 0));
}

function looksLikeGlyphSoup(text: string): boolean {
    const tokens = cleanPdfTextFragment(text).split(" ").filter(Boolean);
    if (tokens.length < 6) return false;
    const singleGlyphs = tokens.filter((token) => /^[\p{L}\p{N}]$/u.test(token)).length;
    return singleGlyphs / tokens.length >= 0.7;
}

/**
 * Join visual PDF lines without trying to rewrite the author's words.
 *
 * Apostrophe- and hyphen-ended lines are glued to the next line, which fixes
 * exports such as "S’" / "ouvrir" and "libre-" / "arbitre". We intentionally
 * keep the hyphen rather than guessing whether it was lexical or discretionary.
 */
export function joinPdfLines(lines: PdfTextLine[]): string {
    let result = "";

    for (const line of sortedLines(lines)) {
        const next = cleanPdfTextFragment(line.text);
        if (!next || looksLikeGlyphSoup(next)) continue;
        if (!result) {
            result = next;
            continue;
        }

        if (/[’']$/u.test(result) || /-$/u.test(result)) {
            result += next;
        } else {
            result += ` ${next}`;
        }
    }

    return result.trim();
}

function paragraphise(lines: PdfTextLine[]): string[] {
    const ordered = sortedLines(lines).filter((line) => {
        const text = cleanPdfTextFragment(line.text);
        return text.length > 0 && !looksLikeGlyphSoup(text);
    });
    if (ordered.length === 0) return [];

    const bodySize = weightedBodySize(ordered);
    const groups: PdfTextLine[][] = [];
    let current: PdfTextLine[] = [];

    for (const line of ordered) {
        const previous = current[current.length - 1];
        const gap = previous ? Math.max(0, previous.y - line.y) : 0;
        const paragraphGap = Math.max(bodySize * 1.65, (previous?.fontSize ?? bodySize) * 1.45);

        if (previous && gap > paragraphGap) {
            groups.push(current);
            current = [];
        }
        current.push(line);
    }

    if (current.length > 0) groups.push(current);
    return groups.map(joinPdfLines).filter(Boolean);
}

interface ChapterMarker {
    index: number;
    number: string;
}

function findChapterMarker(lines: PdfTextLine[]): ChapterMarker | null {
    const ordered = sortedLines(lines);

    for (let index = 0; index < Math.min(5, ordered.length); index += 1) {
        const line = ordered[index];
        const text = cleanPdfTextFragment(line.text);
        const match = text.match(/^(\d{1,3})\s*[.)]?$/);
        if (!match || line.y < line.pageHeight * 0.55) continue;
        return { index, number: match[1] };
    }

    return null;
}

function titleLinesAfterMarker(lines: PdfTextLine[], marker: ChapterMarker): PdfTextLine[] {
    const ordered = sortedLines(lines);
    const bodySize = weightedBodySize(ordered);
    const candidates: PdfTextLine[] = [];

    for (let index = marker.index + 1; index < ordered.length && candidates.length < 4; index += 1) {
        const line = ordered[index];
        const text = cleanPdfTextFragment(line.text);
        if (!text) continue;

        const largeEnough = line.fontSize >= bodySize * 1.18;
        const stillNearTop = line.y >= line.pageHeight * 0.45;
        if (!largeEnough || !stillNearTop) break;
        candidates.push(line);
    }

    if (candidates.length > 0) return candidates;

    const fallback = ordered[marker.index + 1];
    return fallback ? [fallback] : [];
}

function findSectionTitle(lines: PdfTextLine[]): PdfTextLine[] {
    const ordered = sortedLines(lines);
    if (ordered.length === 0) return [];

    const bodySize = weightedBodySize(ordered);
    const candidates: PdfTextLine[] = [];

    for (let index = 0; index < Math.min(5, ordered.length) && candidates.length < 3; index += 1) {
        const line = ordered[index];
        const text = cleanPdfTextFragment(line.text);
        if (!text || text.length > 120) break;

        const largeEnough = line.fontSize >= bodySize * 1.18;
        const stillNearTop = line.y >= line.pageHeight * 0.55;
        if (!largeEnough || !stillNearTop) break;
        candidates.push(line);
    }

    return candidates;
}

function withoutLines(lines: PdfTextLine[], omitted: PdfTextLine[]): PdfTextLine[] {
    const omittedSet = new Set(omitted);
    return lines.filter((line) => !omittedSet.has(line));
}

function analysePage(page: number, lines: PdfTextLine[]): SimplifiedPdfPage | null {
    const cleaned = lines
        .map((line) => ({ ...line, text: cleanPdfTextFragment(line.text) }))
        .filter((line) => line.text.length > 0 && !looksLikeGlyphSoup(line.text));

    if (cleaned.length === 0) return null;

    const marker = findChapterMarker(cleaned);
    if (marker) {
        const ordered = sortedLines(cleaned);
        const markerLine = ordered[marker.index];
        const titleLines = titleLinesAfterMarker(cleaned, marker);
        const heading = joinPdfLines(titleLines);
        const body = withoutLines(cleaned, [markerLine, ...titleLines]);

        return {
            page,
            kind: "chapter",
            chapterNumber: marker.number,
            heading: heading || `Chapter ${marker.number}`,
            blocks: paragraphise(body),
        };
    }

    const textLength = cleaned.reduce((sum, line) => sum + line.text.length, 0);

    // A first-page title/cover is usually sparse. Do not blindly label page 1
    // as a cover: some PDFs start directly with a substantial introduction.
    if (
        page === 1 &&
        textLength <= SHORT_PAGE_MAX_CHARS &&
        cleaned.length <= SHORT_PAGE_MAX_LINES
    ) {
        return {
            page,
            kind: "cover",
            blocks: paragraphise(cleaned),
        };
    }

    if (textLength <= SHORT_PAGE_MAX_CHARS && cleaned.length <= SHORT_PAGE_MAX_LINES) {
        return {
            page,
            kind: "short",
            blocks: [joinPdfLines(cleaned)].filter(Boolean),
        };
    }

    const sectionTitle = findSectionTitle(cleaned);
    if (sectionTitle.length > 0) {
        return {
            page,
            kind: "section",
            heading: joinPdfLines(sectionTitle),
            blocks: paragraphise(withoutLines(cleaned, sectionTitle)),
        };
    }

    return {
        page,
        kind: "prose",
        blocks: paragraphise(cleaned),
    };
}

export function analysePdfPages(
    sourceLines: PdfTextLine[],
    pageCount: number,
): PdfPageAnalysis {
    const usable = sourceLines.filter((line) => cleanPdfTextFragment(line.text).length > 0);
    const repeated = repeatedEdgeKeys(usable, pageCount);
    const filtered = usable.filter((line) => {
        const atEdge = line.y <= line.pageHeight * 0.11 || line.y >= line.pageHeight * 0.89;
        return !(atEdge && repeated.has(normaliseRepeatedText(line.text)));
    });

    const pages: SimplifiedPdfPage[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
        const analysed = analysePage(
            page,
            filtered.filter((line) => line.page === page),
        );
        if (analysed) pages.push(analysed);
    }

    return {
        pages,
        removedRepeatedLines: usable.length - filtered.length,
        shortPageCount: pages.filter((page) => page.kind === "short").length,
    };
}
