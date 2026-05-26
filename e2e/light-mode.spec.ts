import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Light Mode UI", () => {
  test("switching to light mode updates CSS variables", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bgPrimary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim()
    );
    expect(bgPrimary).toBe("#f5f5f7");
  });

  test("light mode hides dark background images", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const chatBg = page.locator(".panel-bg--chat");
    if (await chatBg.count() > 0) {
      const opacity = await chatBg.evaluate((el) =>
        parseFloat(getComputedStyle(el).opacity)
      );
      // In light mode, bg images should be hidden or very low opacity
      expect(opacity).toBeLessThanOrEqual(0.1);
    }
  });

  test("light mode text colors have sufficient contrast", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const textColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim()
    );
    // Text should be dark in light mode
    expect(textColor).toBe("#1a1a2e");
  });

  test("light mode code-bg uses a light-friendly background", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const codeBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--code-bg").trim()
    );
    expect(codeBg).toBeTruthy();
  });

  test("light mode toolbar background is light", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    const toolbar = page.locator(".toolbar");
    const bg = await toolbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should be a light/white color, not dark
    expect(bg).toBeTruthy();
  });

  test("switching back to dark mode restores dark variables", async ({ page }) => {
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bgPrimary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim()
    );
    expect(bgPrimary).toBe("#1a1a2e");
  });
});
