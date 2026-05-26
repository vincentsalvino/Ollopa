import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 9: Streaming Token Counter", () => {
  test("streaming counter CSS class exists", async ({ page }) => {
    const hasStreamingCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".streaming-counter"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasStreamingCSS).toBe(true);
  });

  test("streaming stats row CSS exists", async ({ page }) => {
    const hasCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".streaming-stats-row"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasCSS).toBe(true);
  });

  test("token bar in toolbar is visible", async ({ page }) => {
    const tokenBar = page.locator(".token-bar");
    await expect(tokenBar).toBeVisible();
  });

  test("token label displays token count", async ({ page }) => {
    const label = page.locator(".token-label");
    await expect(label).toBeVisible();
  });

  test("token progress bar exists", async ({ page }) => {
    const progress = page.locator(".token-progress");
    await expect(progress).toBeVisible();
  });
});
