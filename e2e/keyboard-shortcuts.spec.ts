import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Keyboard Shortcuts", () => {
  test("Ctrl+Shift+M toggles model selector", async ({ page }) => {
    await expect(page.locator(".dropdown-wrapper .dropdown").first()).not.toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".dropdown-wrapper .dropdown").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".dropdown-wrapper .dropdown").first()).not.toBeVisible();
  });

  test("Ctrl+Shift+S opens search", async ({ page }) => {
    await expect(page.locator(".search-overlay")).not.toBeVisible();
    await page.keyboard.press("Control+Shift+S");
    await expect(page.locator(".search-overlay")).toBeVisible();
  });

  test("Ctrl+Shift+E opens export menu", async ({ page }) => {
    await page.keyboard.press("Control+Shift+E");
    // Check any dropdown is visible (export uses .dropdown class now)
    const dropdowns = page.locator(".dropdown");
    const visibleCount = await dropdowns.evaluateAll((els) =>
      els.filter((el) => el.offsetParent !== null).length
    );
    expect(visibleCount).toBeGreaterThanOrEqual(1);
  });

  test("Escape closes all modals", async ({ page }) => {
    await page.keyboard.press("Control+Shift+M");
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    const dropdowns = page.locator(".dropdown");
    const visibleCount = await dropdowns.evaluateAll((els) =>
      els.filter((el) => el.offsetParent !== null).length
    );
    expect(visibleCount).toBe(0);
  });
});
