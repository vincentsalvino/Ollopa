import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 1: Syntax Highlighting", () => {
  test("highlight.js CSS is loaded", async ({ page }) => {
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

  test("atom-one-dark theme classes are present in stylesheets", async ({ page }) => {
    const hasAtomTheme = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".hljs-keyword"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasAtomTheme).toBe(true);
  });

  test("code-bg CSS variable is defined for code blocks", async ({ page }) => {
    const codeBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--code-bg").trim()
    );
    expect(codeBg).toBeTruthy();
  });
});
