import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 3: Notification Sound Toggle", () => {
  test("sound toggle button is visible", async ({ page }) => {
    const toggle = page.locator(".sound-toggle");
    await expect(toggle).toBeVisible();
  });

  test("sound is enabled by default", async ({ page }) => {
    const toggle = page.locator(".sound-toggle");
    await expect(toggle).toHaveClass(/active/);
  });

  test("clicking sound toggle disables it", async ({ page }) => {
    const toggle = page.locator(".sound-toggle");
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
  });

  test("sound preference persists in localStorage", async ({ page }) => {
    const toggle = page.locator(".sound-toggle");
    await toggle.click();
    const stored = await page.evaluate(() =>
      localStorage.getItem("ollopa-sound")
    );
    expect(stored).toBe("false");
  });

  test("clicking toggle twice re-enables sound", async ({ page }) => {
    const toggle = page.locator(".sound-toggle");
    await toggle.click();
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);
  });
});
