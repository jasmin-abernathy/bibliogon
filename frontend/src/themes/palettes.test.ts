/**
 * Tests for the palette registry.
 *
 * Pins the set of known palette IDs so a rename or deletion anywhere
 * in the codebase either propagates here (the conscious case) or
 * trips this test (the accidental case).
 */

import {describe, it, expect} from "vitest";
import {PALETTES, DEFAULT_PALETTE, isKnownPalette} from "./palettes";

describe("palette registry", () => {
    it("contains the three existing palettes", () => {
        const ids = PALETTES.map((p) => p.id);
        expect(ids).toContain("warm-literary");
        expect(ids).toContain("cool-modern");
        expect(ids).toContain("nord");
    });

    it("contains the three new palettes (Classic, Studio, Notebook)", () => {
        const ids = PALETTES.map((p) => p.id);
        expect(ids).toContain("classic");
        expect(ids).toContain("studio");
        expect(ids).toContain("notebook");
    });

    it("contains the Potager fork palette", () => {
        expect(PALETTES.map((p) => p.id)).toContain("potager");
    });

    it("has exactly seven palettes (guards against accidental additions)", () => {
        expect(PALETTES).toHaveLength(7);
    });

    it("uses kebab-case IDs with no whitespace", () => {
        for (const palette of PALETTES) {
            expect(palette.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it("gives every palette a non-empty label", () => {
        for (const palette of PALETTES) {
            expect(palette.label.trim()).not.toBe("");
        }
    });

    it("defaults to the Potager palette", () => {
        expect(DEFAULT_PALETTE).toBe("potager");
        expect(isKnownPalette(DEFAULT_PALETTE)).toBe(true);
    });
});

describe("isKnownPalette", () => {
    it("returns true for every registered ID", () => {
        for (const palette of PALETTES) {
            expect(isKnownPalette(palette.id)).toBe(true);
        }
    });

    it("returns false for unknown IDs", () => {
        expect(isKnownPalette("cyberpunk-pink")).toBe(false);
        expect(isKnownPalette("")).toBe(false);
        expect(isKnownPalette("Warm-Literary")).toBe(false); // case sensitive
    });
});
