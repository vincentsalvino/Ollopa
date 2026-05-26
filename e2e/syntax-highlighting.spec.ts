import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 1: Syntax Highlighting", () => {
  test("highlight.js CSS is loaded", async ({ page }) => {
    const hlStyle = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      return sheets.some((s) => s.href?.includes("highlight.js") || false);
    });
    // The styles are bundled by Vite, so check for hljs class presence in CSS
    const hasHljsRules = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".hljs"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasHljsRules).toBe(true);
  });
});
