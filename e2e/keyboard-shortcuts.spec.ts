import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/");
  await page.waitForSelector(".toolbar");
});

test.describe("Keyboard Shortcuts", () => {
  test("Ctrl+Shift+M toggles model selector", async ({ page }) => {
    await expect(page.locator(".grouped-model-dropdown")).not.toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".grouped-model-dropdown")).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".grouped-model-dropdown")).not.toBeVisible();
  });

  test("Ctrl+Shift+S opens search", async ({ page }) => {
    await expect(page.locator(".search-overlay")).not.toBeVisible();
    await page.keyboard.press("Control+Shift+S");
    await expect(page.locator(".search-overlay")).toBeVisible();
  });

  test("Ctrl+Shift+E opens export menu", async ({ page }) => {
    await expect(page.locator(".export-dropdown")).not.toBeVisible();
    await page.keyboard.press("Control+Shift+E");
    await expect(page.locator(".export-dropdown")).toBeVisible();
  });

  test("Escape closes all modals", async ({ page }) => {
    // Open model selector
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".grouped-model-dropdown")).toBeVisible();
    // Escape closes it
    await page.keyboard.press("Escape");
    await expect(page.locator(".grouped-model-dropdown")).not.toBeVisible();
  });
});
