import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/");
  await page.waitForSelector(".toolbar");
});

test.describe("Search", () => {
  test("opens search overlay", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Search"]').click();
    await expect(page.locator(".search-overlay")).toBeVisible();
    await expect(page.locator(".search-input")).toBeVisible();
  });

  test("search input is auto-focused", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Search"]').click();
    await expect(page.locator(".search-input")).toBeFocused();
  });

  test("can type search query", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Search"]').click();
    await page.locator(".search-input").fill("hello world");
    await expect(page.locator(".search-input")).toHaveValue("hello world");
  });

  test("search close button works", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Search"]').click();
    await expect(page.locator(".search-overlay")).toBeVisible();
    await page.locator(".search-close").click();
    await expect(page.locator(".search-overlay")).not.toBeVisible();
  });
});

test.describe("Export", () => {
  test("opens export dropdown", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Export"]').click();
    await expect(page.locator(".export-dropdown")).toBeVisible();
  });

  test("shows markdown and JSON options", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Export"]').click();
    const items = page.locator(".export-dropdown-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Markdown");
    await expect(items.last()).toContainText("JSON");
  });

  test("closes on Escape", async ({ page }) => {
    await page.locator('.toolbar-btn[title*="Export"]').click();
    await expect(page.locator(".export-dropdown")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".export-dropdown")).not.toBeVisible();
  });
});
