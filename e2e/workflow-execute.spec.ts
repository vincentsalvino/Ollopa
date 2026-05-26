import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 10: Multi-Agent Workflow Execute", () => {
  test("agent panel workflow actions CSS exists", async ({ page }) => {
    const hasCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".agent-wf-actions"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasCSS).toBe(true);
  });

  test("agent workflow card CSS exists", async ({ page }) => {
    const hasCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".agent-wf-card"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasCSS).toBe(true);
  });

  test("agent step CSS exists", async ({ page }) => {
    const hasCSS = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules);
          if (rules.some((r) => r.cssText?.includes(".agent-step"))) return true;
        } catch (_) {}
      }
      return false;
    });
    expect(hasCSS).toBe(true);
  });
});
