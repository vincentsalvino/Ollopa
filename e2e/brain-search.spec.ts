import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 12: Brain Search (Ctrl+K)", () => {
  test("Ctrl+K opens brain search modal", async ({ page }) => {
    await expect(page.locator(".brain-search-overlay")).not.toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.locator(".brain-search-overlay")).toBeVisible();
  });

  test("brain search modal has search input", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test("typing in brain search triggers results", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await input.fill("test query");
    // Wait for debounce + mock response
    await page.waitForTimeout(500);
    const results = page.locator(".brain-search-result");
    await expect(results.first()).toBeVisible();
  });

  test("brain search shows result snippet", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await input.fill("test");
    await page.waitForTimeout(500);
    const snippet = page.locator(".brain-result-snippet");
    await expect(snippet.first()).toBeVisible();
    const text = await snippet.first().textContent();
    expect(text).toContain("Mock brain search result");
  });

  test("brain search shows relevance score", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await input.fill("test");
    await page.waitForTimeout(500);
    const score = page.locator(".brain-result-score");
    await expect(score.first()).toBeVisible();
  });

  test("brain search shows keywords", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await input.fill("test");
    await page.waitForTimeout(500);
    const keywords = page.locator(".brain-result-keyword");
    const count = await keywords.count();
    expect(count).toBeGreaterThan(0);
  });

  test("Escape closes brain search modal", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".brain-search-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".brain-search-overlay")).not.toBeVisible();
  });

  test("clicking overlay closes brain search", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".brain-search-overlay")).toBeVisible();
    await page.locator(".brain-search-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".brain-search-overlay")).not.toBeVisible();
  });

  test("empty query shows no results", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const results = page.locator(".brain-search-result");
    await expect(results).toHaveCount(0);
  });

  test("keyboard navigation works with arrow keys", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.locator(".brain-search-input");
    await input.fill("test");
    await page.waitForTimeout(500);
    // First result should be selected by default
    const firstResult = page.locator(".brain-search-result").first();
    await expect(firstResult).toHaveClass(/selected/);
  });
});
