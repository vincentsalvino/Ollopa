import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/");
  await page.waitForSelector(".toolbar");
});

test.describe("Toolbar Toggles", () => {
  test("enhance toggle starts active (ON by default)", async ({ page }) => {
    const toggle = page.locator(".enhance-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveClass(/active/);
  });

  test("clicking enhance toggle deactivates it", async ({ page }) => {
    const toggle = page.locator(".enhance-toggle");
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
  });

  test("clicking enhance toggle twice reactivates it", async ({ page }) => {
    const toggle = page.locator(".enhance-toggle");
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);
  });

  test("web search toggle starts active (ON by default)", async ({ page }) => {
    const toggle = page.locator(".web-search-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveClass(/active/);
  });

  test("clicking web search toggle deactivates it", async ({ page }) => {
    const toggle = page.locator(".web-search-toggle");
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
  });

  test("new chat button is visible", async ({ page }) => {
    const btn = page.locator(".restart-btn");
    await expect(btn).toBeVisible();
  });

  test("search button is visible", async ({ page }) => {
    const btns = page.locator('.toolbar-btn[title*="Search"]');
    await expect(btns.first()).toBeVisible();
  });

  test("export button is visible", async ({ page }) => {
    const btn = page.locator('.toolbar-btn[title*="Export"]');
    await expect(btn).toBeVisible();
  });
});
