import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Search", () => {
  test("opens search overlay", async ({ page }) => {
    await page.locator('.tbtn[title="Search conversations"]').click();
    await expect(page.locator(".search-overlay")).toBeVisible();
    await expect(page.locator(".search-input")).toBeVisible();
  });

  test("search input is auto-focused", async ({ page }) => {
    await page.locator('.tbtn[title="Search conversations"]').click();
    await expect(page.locator(".search-input")).toBeFocused();
  });

  test("can type search query", async ({ page }) => {
    await page.locator('.tbtn[title="Search conversations"]').click();
    await page.locator(".search-input").fill("hello world");
    await expect(page.locator(".search-input")).toHaveValue("hello world");
  });

  test("search close button works", async ({ page }) => {
    await page.locator('.tbtn[title="Search conversations"]').click();
    await expect(page.locator(".search-overlay")).toBeVisible();
    await page.locator(".search-close").click();
    await expect(page.locator(".search-overlay")).not.toBeVisible();
  });
});

test.describe("Export", () => {
  test("opens export dropdown", async ({ page }) => {
    await page.locator('.tbtn[title="Export"]').click();
    await expect(page.locator(".dropdown-wrapper .dropdown")).toBeVisible();
  });

  test("shows markdown and JSON options", async ({ page }) => {
    await page.locator('.tbtn[title="Export"]').click();
    const items = page.locator(".dropdown-wrapper .dropdown .dropdown-item");
    // There may be more dropdowns; filter to the visible export ones
    const exportItems = page.locator('.tbtn[title="Export"] + .dropdown .dropdown-item, .dropdown-wrapper:has(.tbtn[title="Export"]) .dropdown-item');
    const count = await exportItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("export items contain Markdown and JSON text", async ({ page }) => {
    await page.locator('.tbtn[title="Export"]').click();
    const texts = await page.locator(".dropdown-item").allTextContents();
    const hasMarkdown = texts.some((t) => t.includes("Markdown"));
    const hasJSON = texts.some((t) => t.includes("JSON"));
    expect(hasMarkdown).toBeTruthy();
    expect(hasJSON).toBeTruthy();
  });
});
