/**
 * Local-first PDF -> editable prose import.
 *
 * PDF.js extracts positioned text in the browser. We then rebuild a semantic
 * reading flow suitable for reflowable EPUB: repeated page furniture is
 * removed, larger text is interpreted as headings, wrapped lines become
 * paragraphs, and top-level headings can split the document into chapters.
 *
 * This intentionally does not OCR image-only PDFs. Those fail with
 * PdfNeedsOcrError so the UI can be honest instead of silently importing an
 * empty book.
 */

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

import type { TipTapDoc, TipTapNode } from "../medium-import/walker";
import { getStorage } from "../storage";
import type { ChapterImportTarget } from "./chapterImporters";

export type PdfImportMode = "reflow" | "plain";

export interface PdfTextLine {
    page: number;
    pageHeight: number;
    x: number;
    y: number;
    fontSize: number;
    text: string;
}

export interface ReconstructedPdfChapter {
    title: string;
    doc: TipTapDoc;
}

export interface PdfReconstruction {
    title: string;
    chapters: ReconstructedPdfChapter[];
    pageCount: number;
    removedRepeatedLines: number;
}

export interface PdfImportResult {
    bookId: string;
    bookTitle: string;
    chapterIds: string[];
    chapterTitles: string[];
    createdBook: boolean;
    pageCount: number;
    removedRepeatedLines: number;
    mode: PdfImportMode;
}

export class PdfNeedsOcrError extends Error {
    constructor() {
        super(
            "No usable text layer was found in this PDF. It appears to be scanned and needs OCR before import.",
        );
        this.name = "PdfNeedsOcrError";
    }
}

let worker: Worker | null = null;

function ensurePdfWorker(): void {
    if (typeof Worker === "undefined" || GlobalWorkerOptions.workerPort) return;
    worker = new PdfWorker();
    GlobalWorkerOptions.workerPort = worker;
}

function stemOf(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? filename;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return stem.trim() || "Imported PDF";
}

function normaliseRepeatedText(text: string): string {
    return text
        .toLocaleLowerCase()
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim();
}

function median(values: number[]): number {
    if (values.length === 0) return 12;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function repeatedEdgeKeys(
    lines: PdfTextLine[],
    pageCount: number,
): Set<string> {
    const pagesByKey = new Map<string, Set<number>>();
    for (const line of lines) {
        const atEdge =
            line.y <= line.pageHeight * 0.11 ||
            line.y >= line.pageHeight * 0.89;
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

function textNode(text: string): TipTapNode {
    return { type: "text", text };
}

function paragraphNode(text: string): TipTapNode {
    return { type: "paragraph", content: [textNode(text)] };
}

function headingNode(text: string, level = 2): TipTapNode {
    return {
        type: "heading",
        attrs: { level },
        content: [textNode(text)],
    };
}

function joinWrapped(left: string, right: string): string {
    const a = left.trimEnd();
    const b = right.trimStart();
    if (!a) return b;
    if (!b) return a;
    if (/-$/u.test(a) && /^[\p{Ll}]/u.test(b)) {
        return `${a.slice(0, -1)}${b}`;
    }
    return `${a} ${b}`;
}

function isSentenceEnding(text: string): boolean {
    return /[.!?…]["'»”’)]?$/.test(text.trim());
}

function isHeadingLike(
    line: PdfTextLine,
    bodySize: number,
): "major" | "minor" | null {
    const text = line.text.trim();
    if (text.length < 2 || text.length > 140) return null;
    if (isSentenceEnding(text) && text.length > 55) return null;

    if (line.fontSize >= bodySize * 1.42) return "major";
    if (line.fontSize >= bodySize * 1.18) return "minor";

    const letters = text.replace(/[^\p{L}]/gu, "");
    const allCaps =
        letters.length >= 4 &&
        letters === letters.toLocaleUpperCase() &&
        text.length <= 80;
    return allCaps ? "minor" : null;
}

function makeDoc(content: TipTapNode[]): TipTapDoc {
    return {
        type: "doc",
        content: content.length > 0 ? content : [{ type: "paragraph" }],
    };
}

function sortedLines(lines: PdfTextLine[]): PdfTextLine[] {
    return [...lines].sort(
        (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
    );
}

function buildPlainChapter(
    lines: PdfTextLine[],
    fallbackTitle: string,
): ReconstructedPdfChapter {
    const content: TipTapNode[] = [];
    let page = -1;
    let paragraph = "";

    const flush = () => {
        const text = paragraph.trim();
        if (text) content.push(paragraphNode(text));
        paragraph = "";
    };

    for (const line of sortedLines(lines)) {
        if (page !== -1 && line.page !== page) flush();
        page = line.page;
        paragraph = joinWrapped(paragraph, line.text);
    }
    flush();

    return { title: fallbackTitle, doc: makeDoc(content) };
}

/**
 * Pure reconstruction stage, exported for deterministic layout tests.
 */
export function reconstructPdfLines(
    sourceLines: PdfTextLine[],
    pageCount: number,
    filename: string,
    mode: PdfImportMode = "reflow",
    metadataTitle?: string,
): PdfReconstruction {
    const fallbackTitle = metadataTitle?.trim() || stemOf(filename);
    const usable = sourceLines.filter((line) => line.text.trim().length > 0);
    const totalCharacters = usable.reduce(
        (sum, line) => sum + line.text.replace(/\s/g, "").length,
        0,
    );
    if (totalCharacters < Math.max(20, pageCount * 5)) {
        throw new PdfNeedsOcrError();
    }

    if (mode === "plain") {
        return {
            title: fallbackTitle,
            chapters: [buildPlainChapter(usable, fallbackTitle)],
            pageCount,
            removedRepeatedLines: 0,
        };
    }

    const repeated = repeatedEdgeKeys(usable, pageCount);
    const lines = usable.filter((line) => {
        const atEdge =
            line.y <= line.pageHeight * 0.11 ||
            line.y >= line.pageHeight * 0.89;
        return !(atEdge && repeated.has(normaliseRepeatedText(line.text)));
    });
    const removedRepeatedLines = usable.length - lines.length;

    // Repeating the size once per ~12 characters makes the median represent
    // body text instead of giving a short display heading the same weight as
    // a full prose line.
    const weightedSizes = lines.flatMap((line) =>
        Array.from(
            { length: Math.max(1, Math.ceil(line.text.length / 12)) },
            () => line.fontSize,
        ),
    );
    const bodySize = median(weightedSizes.filter((size) => size > 0));

    const chapters: ReconstructedPdfChapter[] = [];
    let chapterTitle = fallbackTitle;
    let nodes: TipTapNode[] = [];
    let paragraph = "";
    let previous: PdfTextLine | null = null;

    const flushParagraph = () => {
        const text = paragraph.trim();
        if (text) nodes.push(paragraphNode(text));
        paragraph = "";
    };
    const flushChapter = () => {
        flushParagraph();
        if (nodes.length > 0) {
            chapters.push({ title: chapterTitle, doc: makeDoc(nodes) });
        }
        nodes = [];
    };

    for (const line of sortedLines(lines)) {
        const heading = isHeadingLike(line, bodySize);
        if (heading === "major") {
            flushChapter();
            chapterTitle = line.text.trim();
            previous = line;
            continue;
        }
        if (heading === "minor") {
            flushParagraph();
            nodes.push(headingNode(line.text.trim(), 2));
            previous = line;
            continue;
        }

        const samePage = previous?.page === line.page;
        const verticalGap =
            samePage && previous
                ? Math.max(0, previous.y - line.y)
                : bodySize * 1.4;
        const indentationChanged =
            samePage &&
            previous &&
            Math.abs(previous.x - line.x) > bodySize * 1.5;
        const shouldBreak =
            paragraph.length > 0 &&
            (verticalGap > bodySize * 1.75 ||
                (indentationChanged && isSentenceEnding(paragraph)));

        if (shouldBreak) flushParagraph();
        paragraph = joinWrapped(paragraph, line.text);
        previous = line;
    }
    flushChapter();

    if (chapters.length === 0) {
        chapters.push(buildPlainChapter(lines, fallbackTitle));
    }

    return {
        title: fallbackTitle,
        chapters,
        pageCount,
        removedRepeatedLines,
    };
}

interface PositionedItem {
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
}

function groupItemsIntoLines(
    items: PositionedItem[],
    page: number,
    pageHeight: number,
): PdfTextLine[] {
    const groups: PositionedItem[][] = [];

    for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
        const tolerance = Math.max(1.5, item.fontSize * 0.18);
        const group = groups.find(
            (candidate) =>
                Math.abs((candidate[0]?.y ?? item.y) - item.y) <= tolerance,
        );
        if (group) group.push(item);
        else groups.push([item]);
    }

    return groups.map((group) => {
        const sorted = [...group].sort((a, b) => a.x - b.x);
        let text = "";
        let right = Number.NEGATIVE_INFINITY;
        for (const item of sorted) {
            const gap = item.x - right;
            if (
                text &&
                gap > Math.max(1, item.fontSize * 0.16) &&
                !/\s$/.test(text)
            ) {
                text += " ";
            }
            text += item.text;
            right = Math.max(right, item.x + item.width);
        }
        return {
            page,
            pageHeight,
            x: Math.min(...sorted.map((item) => item.x)),
            y: median(sorted.map((item) => item.y)),
            fontSize: median(sorted.map((item) => item.fontSize)),
            text: text.replace(/\s+/g, " ").trim(),
        };
    });
}

async function extractPdfLines(file: File): Promise<{
    lines: PdfTextLine[];
    pageCount: number;
    metadataTitle?: string;
}> {
    ensurePdfWorker();
    const loadingTask = getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    try {
        const lines: PdfTextLine[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();
            const items: PositionedItem[] = [];

            for (const raw of textContent.items) {
                if (!("str" in raw) || !raw.str.trim()) continue;
                const transform = raw.transform;
                const fontSize = Math.max(
                    raw.height || 0,
                    Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
                    1,
                );
                items.push({
                    text: raw.str,
                    x: transform[4] ?? 0,
                    y: transform[5] ?? 0,
                    width: raw.width || 0,
                    fontSize,
                });
            }
            lines.push(
                ...groupItemsIntoLines(items, pageNumber, viewport.height),
            );
        }

        let metadataTitle: string | undefined;
        try {
            const metadata = await pdf.getMetadata();
            const info = metadata.info as Record<string, unknown>;
            if (typeof info.Title === "string" && info.Title.trim()) {
                metadataTitle = info.Title.trim();
            }
        } catch {
            // Metadata is optional; layout extraction remains authoritative.
        }

        return { lines, pageCount: pdf.numPages, metadataTitle };
    } finally {
        await pdf.destroy();
    }
}

async function persistPdf(
    reconstruction: PdfReconstruction,
    target: ChapterImportTarget,
    mode: PdfImportMode,
): Promise<PdfImportResult> {
    const storage = getStorage();
    let bookId: string;
    let bookTitle: string;
    let position = 0;
    let createdBook = false;

    if (target.kind === "new-book") {
        const book = await storage.books.create({
            title: reconstruction.title,
            book_type: "prose",
        });
        bookId = book.id;
        bookTitle = book.title;
        createdBook = true;
    } else {
        const [book, existing] = await Promise.all([
            storage.books.get(target.bookId),
            storage.chapters.list(target.bookId),
        ]);
        bookId = target.bookId;
        bookTitle = book.title;
        position = existing.length;
    }

    const chapterIds: string[] = [];
    const chapterTitles: string[] = [];
    for (const chapter of reconstruction.chapters) {
        const created = await storage.chapters.create(bookId, {
            title: chapter.title,
            content: JSON.stringify(chapter.doc),
            position,
        });
        chapterIds.push(created.id);
        chapterTitles.push(created.title);
        position += 1;
    }

    return {
        bookId,
        bookTitle,
        chapterIds,
        chapterTitles,
        createdBook,
        pageCount: reconstruction.pageCount,
        removedRepeatedLines: reconstruction.removedRepeatedLines,
        mode,
    };
}

export async function importPdf(
    file: File,
    target: ChapterImportTarget,
    mode: PdfImportMode = "reflow",
): Promise<PdfImportResult> {
    const extracted = await extractPdfLines(file);
    const reconstructed = reconstructPdfLines(
        extracted.lines,
        extracted.pageCount,
        file.name,
        mode,
        extracted.metadataTitle,
    );
    return persistPdf(reconstructed, target, mode);
}
