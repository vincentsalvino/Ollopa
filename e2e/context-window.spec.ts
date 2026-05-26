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

  test("context bar has a fill element", async ({ page }) => {
    const fill = page.locator(".context-bar-fill");
    await expect(fill).toBeVisible();
  });

  test("context bar has tooltip with token info", async ({ page }) => {
    const bar = page.locator(".context-bar");
    const title = await bar.getAttribute("title");
    expect(title).toContain("tokens");
  });
});
