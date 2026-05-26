import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Theme Toggle", () => {
  test("defaults to dark theme", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("toggles to light theme on click", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("toggles back to dark theme on double click", async ({ page }) => {
    const toggle = page.locator(".theme-toggle");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("persists theme in localStorage", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const stored = await page.evaluate(() => localStorage.getItem("ollopa-desktop-theme"));
    expect(stored).toBe("light");
  });
});
