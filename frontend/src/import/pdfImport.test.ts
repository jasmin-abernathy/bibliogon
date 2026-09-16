import { describe, expect, it } from "vitest";

import { PdfNeedsOcrError, reconstructPdfLines, type PdfTextLine } from "./pdfImport";

function line(page: number, y: number, fontSize: number, text: string, x = 72): PdfTextLine {
    return { page, pageHeight: 800, x, y, fontSize, text };
}

function nodeText(node: { text?: string; content?: unknown[] }): string {
    if (typeof node.text === "string") return node.text;
    return (node.content ?? [])
        .map((child) => nodeText(child as { text?: string; content?: unknown[] }))
        .join("");
}

describe("reconstructPdfLines", () => {
    it("removes repeated page furniture and rebuilds chapters + paragraphs", () => {
        const lines: PdfTextLine[] = [
            line(1, 780, 9, "Example book"),
            line(1, 720, 22, "Chapter One"),
            line(1, 680, 11, "This is a long opening paragraph with enough text"),
            line(1, 666, 11, "to make the PDF text layer clearly usable."),
            line(1, 20, 9, "Page 1"),
            line(2, 780, 9, "Example book"),
            line(2, 720, 22, "Chapter Two"),
            line(2, 680, 11, "Another paragraph begins on the second page"),
            line(2, 666, 11, "and continues as normal body text."),
            line(2, 20, 9, "Page 2"),
        ];

        const out = reconstructPdfLines(lines, 2, "example.pdf", "reflow");

        expect(out.title).toBe("example");
        expect(out.removedRepeatedLines).toBe(4);
        expect(out.chapters.map((chapter) => chapter.title)).toEqual([
            "Chapter One",
            "Chapter Two",
        ]);
        expect(nodeText(out.chapters[0].doc)).toContain(
            "opening paragraph with enough text to make",
        );
        expect(nodeText(out.chapters[0].doc)).not.toContain("Example book");
        expect(nodeText(out.chapters[0].doc)).not.toContain("Page 1");
    });

    it("dehyphenates a word split by a PDF line wrap", () => {
        const out = reconstructPdfLines(
            [
                line(1, 720, 20, "Introduction"),
                line(1, 680, 11, "A sufficiently long paragraph demonstrates recon-"),
                line(1, 666, 11, "struction without preserving a print-only line break."),
            ],
            1,
            "sample.pdf",
            "reflow",
        );

        expect(nodeText(out.chapters[0].doc)).toContain("reconstruction without preserving");
    });

    it("offers a plain extraction mode without layout inference", () => {
        const out = reconstructPdfLines(
            [
                line(1, 720, 22, "Large text that should stay ordinary"),
                line(1, 680, 11, "This is enough body text for a useful extraction result."),
                line(2, 700, 11, "The second page is retained in reading order."),
            ],
            2,
            "plain.pdf",
            "plain",
        );

        expect(out.chapters).toHaveLength(1);
        expect(out.chapters[0].title).toBe("plain");
        expect(nodeText(out.chapters[0].doc)).toContain("Large text that should stay ordinary");
    });

    it("rejects image-only / effectively empty PDFs with an OCR-specific error", () => {
        expect(() => reconstructPdfLines([line(1, 700, 11, "x")], 4, "scan.pdf", "reflow")).toThrow(
            PdfNeedsOcrError,
        );
    });
});
