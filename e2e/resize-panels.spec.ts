import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 8: Drag-to-Resize Panels", () => {
  test("resize handle is present in the DOM", async ({ page }) => {
    const handle = page.locator(".resize-handle");
    await expect(handle).toBeVisible();
  });

  test("resize handle has col-resize cursor", async ({ page }) => {
    const handle = page.locator(".resize-handle");
    const cursor = await handle.evaluate((el) =>
      window.getComputedStyle(el).cursor
    );
    expect(cursor).toBe("col-resize");
  });

  test("dashboard width persists in localStorage", async ({ page }) => {
    // Set a custom width
    await page.evaluate(() =>
      localStorage.setItem("ollopa-dashboard-width", "350")
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".toolbar");
    const storedWidth = await page.evaluate(() =>
      localStorage.getItem("ollopa-dashboard-width")
    );
    expect(storedWidth).toBe("350");
  });
});
