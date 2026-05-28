import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 11: Graph Search & Zoom", () => {
  test("graph search and zoom CSS exists", async ({ page }) => {
    const hasSearchCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".graph-search-input"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasSearchCSS).toBe(true);
  });

  test("graph zoom controls CSS exists", async ({ page }) => {
    const hasZoomCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".graph-zoom-controls"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasZoomCSS).toBe(true);
  });
});
