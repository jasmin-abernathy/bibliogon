/**
 * Local-first PDF -> editable prose import.
 *
 * The default "simplify" mode deliberately throws visual PDF styling away.
 * PDF.js extracts positioned text in the browser, pageStructure classifies
 * each source page, and the importer keeps that page rhythm as editable prose:
 * true numbered/semantic section openers become chapters, short display pages
 * remain one text block, and source-page boundaries get a small editable
 * "• • •" ornament.
 *
 * This intentionally does not OCR image-only PDFs. Those fail with
 * PdfNeedsOcrError so the UI can be honest instead of silently importing an
 * empty book.
 */

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

import type { TipTapDoc, TipTapNode } from "../../medium-import/walker";
import { getStorage } from "../../storage";
import type { ChapterImportTarget } from "../chapterImporters";
import {
    analysePdfPages,
    cleanPdfTextFragment,
    joinPdfLines,
    type PdfTextLine,
    type SimplifiedPdfPage,
} from "./pageStructure";

export type { PdfPageKind, PdfTextLine, SimplifiedPdfPage } from "./pageStructure";

export type PdfImportMode = "simplify" | "plain" | "reflow";

export interface ReconstructedPdfChapter {
    title: string;
    doc: TipTapDoc;
}

export interface PdfReconstruction {
    title: string;
    chapters: ReconstructedPdfChapter[];
    pageCount: number;
    removedRepeatedLines: number;
    shortPageCount: number;
}

export interface PdfImportResult {
    bookId: string;
    bookTitle: string;
    chapterIds: string[];
    chapterTitles: string[];
    createdBook: boolean;
    pageCount: number;
    removedRepeatedLines: number;
    shortPageCount: number;
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

function textNode(text: string): TipTapNode {
    return { type: "text", text };
}

function paragraphNode(text: string): TipTapNode {
    return { type: "paragraph", content: [textNode(text)] };
}

function ornamentNode(): TipTapNode {
    return paragraphNode("• • •");
}

function makeDoc(content: TipTapNode[]): TipTapDoc {
    return {
        type: "doc",
        content: content.length > 0 ? content : [{ type: "paragraph" }],
    };
}

function sortedByPage(lines: PdfTextLine[]): PdfTextLine[] {
    return [...lines].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

function buildPlainChapter(
    lines: PdfTextLine[],
    fallbackTitle: string,
): ReconstructedPdfChapter {
    const content: TipTapNode[] = [];
    let page = -1;
    let pageLines: PdfTextLine[] = [];

    const flush = () => {
        const text = joinPdfLines(pageLines);
        if (text) content.push(paragraphNode(text));
        pageLines = [];
    };

    for (const line of sortedByPage(lines)) {
        if (page !== -1 && line.page !== page) flush();
        page = line.page;
        pageLines.push({ ...line, text: cleanPdfTextFragment(line.text) });
    }
    flush();

    return { title: fallbackTitle, doc: makeDoc(content) };
}

interface MutableChapter {
    title: string;
    nodes: TipTapNode[];
    hasSourcePage: boolean;
}

function pageChapterTitle(page: SimplifiedPdfPage, fallbackTitle: string): string {
    if (page.kind === "chapter") {
        const title = page.heading?.trim() || fallbackTitle;
        return page.chapterNumber ? `${page.chapterNumber}. ${title}` : title;
    }
    return page.heading?.trim() || fallbackTitle;
}

function appendSourcePage(chapter: MutableChapter, page: SimplifiedPdfPage): void {
    if (chapter.hasSourcePage) chapter.nodes.push(ornamentNode());
    for (const block of page.blocks) {
        if (block.trim()) chapter.nodes.push(paragraphNode(block.trim()));
    }
    chapter.hasSourcePage = true;
}

function buildSimplifiedChapters(
    pages: SimplifiedPdfPage[],
    fallbackTitle: string,
): ReconstructedPdfChapter[] {
    const chapters: ReconstructedPdfChapter[] = [];
    let current: MutableChapter | null = null;

    const flush = () => {
        if (!current) return;
        if (current.nodes.length > 0) {
            chapters.push({
                title: current.title,
                doc: makeDoc(current.nodes),
            });
        }
        current = null;
    };

    for (const page of pages) {
        if (page.kind === "chapter" || page.kind === "section") {
            flush();
            current = {
                title: pageChapterTitle(page, fallbackTitle),
                nodes: [],
                hasSourcePage: false,
            };
            appendSourcePage(current, page);
            continue;
        }

        if (!current) {
            current = {
                title: fallbackTitle,
                nodes: [],
                hasSourcePage: false,
            };
        }
        appendSourcePage(current, page);
    }

    flush();
    return chapters;
}

/**
 * Pure reconstruction stage, exported for deterministic layout tests.
 *
 * "reflow" is kept as a backwards-compatible alias for the new conservative
 * "simplify" behaviour. New UI calls use "simplify".
 */
export function reconstructPdfLines(
    sourceLines: PdfTextLine[],
    pageCount: number,
    filename: string,
    mode: PdfImportMode = "simplify",
    metadataTitle?: string,
): PdfReconstruction {
    const fallbackTitle = metadataTitle?.trim() || stemOf(filename);
    const usable = sourceLines.filter((line) => cleanPdfTextFragment(line.text).length > 0);
    const totalCharacters = usable.reduce(
        (sum, line) => sum + cleanPdfTextFragment(line.text).replace(/\s/g, "").length,
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
            shortPageCount: 0,
        };
    }

    const analysis = analysePdfPages(usable, pageCount);
    const chapters = buildSimplifiedChapters(analysis.pages, fallbackTitle);

    return {
        title: fallbackTitle,
        chapters:
            chapters.length > 0
                ? chapters
                : [buildPlainChapter(usable, fallbackTitle)],
        pageCount,
        removedRepeatedLines: analysis.removedRepeatedLines,
        shortPageCount: analysis.shortPageCount,
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
            (candidate) => Math.abs((candidate[0]?.y ?? item.y) - item.y) <= tolerance,
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
            if (text && gap > Math.max(1, item.fontSize * 0.16) && !/\s$/.test(text)) {
                text += " ";
            }
            text += item.text;
            right = Math.max(right, item.x + item.width);
        }

        return {
            page,
            pageHeight,
            x: Math.min(...sorted.map((item) => item.x)),
            y: Math.max(...sorted.map((item) => item.y)),
            fontSize:
                sorted.reduce((sum, item) => sum + item.fontSize, 0) /
                Math.max(1, sorted.length),
            text: cleanPdfTextFragment(text),
        };
    });
}

function rotationDegrees(transform: number[]): number {
    const radians = Math.atan2(transform[1] ?? 0, transform[0] ?? 1);
    return (radians * 180) / Math.PI;
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
                const rotation = Math.abs(rotationDegrees(transform));

                // Curved/decorative Canva headings are often exported as many
                // individually rotated glyphs. Keeping those produces letter
                // soup, so simplify mode deliberately drops those tiny pieces.
                if (raw.str.trim().length <= 2 && rotation > 8 && rotation < 352) {
                    continue;
                }

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

            lines.push(...groupItemsIntoLines(items, pageNumber, viewport.height));
        }

        let metadataTitle: string | undefined;
        try {
            const metadata = await pdf.getMetadata();
            const info = metadata.info as Record<string, unknown>;
            if (typeof info.Title === "string" && info.Title.trim()) {
                metadataTitle = info.Title.trim();
            }
        } catch {
            // Metadata is optional; text extraction remains authoritative.
        }

        return { lines, pageCount: pdf.numPages, metadataTitle };
    } finally {
        await loadingTask.destroy();
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
        shortPageCount: reconstruction.shortPageCount,
        mode,
    };
}

export async function importPdf(
    file: File,
    target: ChapterImportTarget,
    mode: PdfImportMode = "simplify",
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
