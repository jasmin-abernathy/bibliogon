/**
 * Mobile/desktop smoke for the grouped editor tool dock.
 *
 * The old wrap-and-collapse toolbar was intentionally replaced because it
 * exposed dozens of unlabeled controls. The new contract is: five obvious
 * categories, one panel at a time, Text open by default.
 */
import { test, expect, createBook, createChapter } from "../fixtures/base";

test.describe("Grouped editor toolbar", () => {
    test("375px: shows five named categories and the text block", async ({ page }) => {
        const book = await createBook("Grouped Toolbar Mobile");
        await createChapter(book.id, "Opening", "Alice walked into the woods.");
        await page.setViewportSize({ width: 375, height: 720 });
        await page.goto(`/book/${book.id}`);
        await expect(page.locator(".ProseMirror")).toBeVisible();

        const dock = page.getByTestId("editor-tool-dock").first();
        await expect(dock).toBeVisible();
        await expect(page.getByTestId("toolbar-category-text").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-category-style").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-category-insert").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-category-tools").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-category-view").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-text-panel").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-collapse-toggle")).toHaveCount(0);
    });

    test("375px: Insert replaces the text block with explicit insert actions", async ({ page }) => {
        const book = await createBook("Grouped Toolbar Insert");
        await createChapter(book.id, "Opening", "Bob opened the door.");
        await page.setViewportSize({ width: 375, height: 720 });
        await page.goto(`/book/${book.id}`);
        await expect(page.locator(".ProseMirror")).toBeVisible();

        await page.getByTestId("toolbar-category-insert").first().click();
        await expect(page.getByTestId("toolbar-insert-panel").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-text-panel")).toHaveCount(0);
    });

    test("1920px: keeps the same information architecture", async ({ page }) => {
        const book = await createBook("Grouped Toolbar Desktop");
        await createChapter(book.id, "Opening", "Carol read the map.");
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(`/book/${book.id}`);
        await expect(page.locator(".ProseMirror")).toBeVisible();

        await expect(page.getByTestId("editor-tool-dock").first()).toBeVisible();
        await expect(page.getByTestId("toolbar-text-panel").first()).toBeVisible();
    });
});
