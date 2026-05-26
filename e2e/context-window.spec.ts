import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 4: Context Window Usage Indicator", () => {
  test("context bar is visible", async ({ page }) => {
    const bar = page.locator(".context-bar");
    await expect(bar).toBeVisible();
  });

  test("context bar fill element exists in the DOM", async ({ page }) => {
    const fill = page.locator(".context-bar-fill");
    await expect(fill).toBeAttached();
  });

  test("context bar has tooltip with token info", async ({ page }) => {
    const bar = page.locator(".context-bar");
    const title = await bar.getAttribute("title");
    expect(title).toContain("tokens");
  });

  test("context bar fill starts at 0% width when no tokens used", async ({ page }) => {
    const fill = page.locator(".context-bar-fill");
    const width = await fill.evaluate((el) => el.style.width);
    expect(width).toBe("0%");
  });

  test("context bar tooltip shows 0 tokens initially", async ({ page }) => {
    const bar = page.locator(".context-bar");
    const title = await bar.getAttribute("title");
    expect(title).toMatch(/^0/);
  });

  test("context bar has correct CSS styles", async ({ page }) => {
    const bar = page.locator(".context-bar");
    const cursor = await bar.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("help");
  });

  test("context bar fill has color-coded background", async ({ page }) => {
    const fill = page.locator(".context-bar-fill");
    const bg = await fill.evaluate((el) => el.style.background);
    // At 0%, color should be success (green)
    expect(bg).toContain("51cf66");
  });
});
