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
    it("keeps a numbered chapter and turns following display pages into blocks, not chapters", () => {
        const lines: PdfTextLine[] = [
            line(1, 760, 18, "1."),
            line(1, 710, 29, "Se connecter à"),
            line(1, 675, 29, "son énergie"),
            line(1, 610, 21, "L’énergie est une source qui connecte tout le vivant."),
            line(1, 580, 21, "Elle circule en nous comme un souffle de vie."),
            line(2, 480, 31, "Je suis capable d’être"),
            line(2, 440, 31, "en parfaite harmonie"),
            line(2, 400, 31, "avec moi-même."),
            line(3, 480, 31, "Mon énergie me guide"),
            line(3, 440, 31, "avec amour et sagesse."),
        ];

        const out = reconstructPdfLines(lines, 3, "affirmations.pdf", "simplify");

        expect(out.chapters).toHaveLength(1);
        expect(out.chapters[0].title).toBe("1. Se connecter à son énergie");
        expect(out.shortPageCount).toBe(2);
        expect(nodeText(out.chapters[0].doc)).toContain(
            "Je suis capable d’être en parfaite harmonie avec moi-même.",
        );
        expect(nodeText(out.chapters[0].doc)).toContain("• • •");
        expect(nodeText(out.chapters[0].doc)).toContain(
            "Mon énergie me guide avec amour et sagesse.",
        );
    });

    it("joins apostrophe-split chapter titles instead of inserting a space", () => {
        const out = reconstructPdfLines(
            [
                line(1, 760, 18, "16."),
                line(1, 710, 29, "S’"),
                line(1, 675, 29, "ouvrir à la guérison"),
                line(1, 610, 21, "S’ouvrir à la guérison invite à avancer avec confiance."),
            ],
            1,
            "sample.pdf",
            "simplify",
        );

        expect(out.chapters[0].title).toBe("16. S’ouvrir à la guérison");
    });

    it("normalises Canva/PDF hyphen artifacts conservatively", () => {
        const out = reconstructPdfLines(
            [
                line(1, 760, 18, "4."),
                line(1, 710, 29, "Elever ses vibrations"),
                line(
                    1,
                    610,
                    21,
                    "Méditer et respecter son triangle corps-âme\uFFFEesprit aide à avancer.",
                ),
            ],
            1,
            "sample.pdf",
            "simplify",
        );

        expect(nodeText(out.chapters[0].doc)).toContain("corps-âme-esprit");
    });

    it("starts long unnumbered semantic pages as sections but keeps short display pages inside them", () => {
        const out = reconstructPdfLines(
            [
                line(1, 760, 30, "Introduction"),
                line(1, 680, 17, "Ce document contient une introduction suffisamment longue pour"),
                line(1, 655, 17, "être considérée comme une vraie page de texte et non une citation."),
                line(1, 605, 17, "Elle conserve simplement ses paragraphes sans design."),
                line(2, 480, 30, "Une courte affirmation"),
                line(2, 440, 30, "reste un seul bloc."),
            ],
            2,
            "sample.pdf",
            "simplify",
        );

        expect(out.chapters).toHaveLength(1);
        expect(out.chapters[0].title).toBe("Introduction");
        expect(out.shortPageCount).toBe(1);
        expect(nodeText(out.chapters[0].doc)).toContain(
            "Une courte affirmation reste un seul bloc.",
        );
    });

    it("removes repeated edge furniture before rebuilding text", () => {
        const lines: PdfTextLine[] = [
            line(1, 790, 9, "Example book"),
            line(1, 720, 18, "1."),
            line(1, 680, 28, "Chapter One"),
            line(1, 620, 12, "This is enough prose to keep the text layer useful."),
            line(1, 20, 9, "Page 1"),
            line(2, 790, 9, "Example book"),
            line(2, 500, 28, "A short display page with meaningful text."),
            line(2, 20, 9, "Page 2"),
        ];

        const out = reconstructPdfLines(lines, 2, "example.pdf", "simplify");

        expect(out.removedRepeatedLines).toBe(4);
        expect(nodeText(out.chapters[0].doc)).not.toContain("Example book");
        expect(nodeText(out.chapters[0].doc)).not.toContain("Page 1");
    });

    it("keeps the legacy reflow mode as an alias for simplify", () => {
        const lines = [
            line(1, 760, 18, "1."),
            line(1, 710, 29, "A real chapter"),
            line(1, 620, 18, "Enough text exists here for a valid PDF text layer."),
        ];

        const simplify = reconstructPdfLines(lines, 1, "sample.pdf", "simplify");
        const legacy = reconstructPdfLines(lines, 1, "sample.pdf", "reflow");

        expect(legacy.chapters.map((chapter) => chapter.title)).toEqual(
            simplify.chapters.map((chapter) => chapter.title),
        );
    });

    it("offers a plain extraction mode without page-role inference", () => {
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
        expect(() =>
            reconstructPdfLines([line(1, 700, 11, "x")], 4, "scan.pdf", "simplify"),
        ).toThrow(PdfNeedsOcrError);
    });
});
