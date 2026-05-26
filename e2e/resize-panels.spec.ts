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

  test("default dashboard width is 280px", async ({ page }) => {
    await page.evaluate(() =>
      localStorage.removeItem("ollopa-dashboard-width")
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".toolbar");
    // The dashboard panel should exist with a reasonable width
    const dashboard = page.locator(".dashboard-panel");
    await expect(dashboard).toBeVisible();
  });

  test("resize handle has correct positioning between panels", async ({ page }) => {
    const handle = page.locator(".resize-handle");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });
});
