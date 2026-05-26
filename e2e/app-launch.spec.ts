import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/");
  await page.waitForSelector(".toolbar");
});

test.describe("App Launch", () => {
  test("renders the main layout", async ({ page }) => {
    await expect(page.locator(".toolbar")).toBeVisible();
    await expect(page.locator(".input-bar-wrapper")).toBeVisible();
  });

  test("shows the model indicator in toolbar", async ({ page }) => {
    const modelBtn = page.locator(".model-selector-btn");
    await expect(modelBtn).toBeVisible();
  });

  test("shows the session history button", async ({ page }) => {
    const btn = page.locator(".sessions-btn");
    await expect(btn).toBeVisible();
  });

  test("shows the theme toggle", async ({ page }) => {
    await expect(page.locator(".theme-toggle")).toBeVisible();
  });

  test("shows the enhance toggle", async ({ page }) => {
    await expect(page.locator(".enhance-toggle")).toBeVisible();
  });

  test("shows the web search toggle", async ({ page }) => {
    await expect(page.locator(".web-search-toggle")).toBeVisible();
  });
});
