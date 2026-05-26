import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 4: Context Window Usage Indicator (Ring)", () => {
  test("context ring is visible", async ({ page }) => {
    const ring = page.locator(".ctx-ring-btn");
    await expect(ring).toBeVisible();
  });

  test("context ring SVG exists", async ({ page }) => {
    const svg = page.locator(".ctx-ring-svg");
    await expect(svg).toBeAttached();
  });

  test("ring progress circle exists", async ({ page }) => {
    const progress = page.locator(".ring-progress");
    await expect(progress).toBeAttached();
  });

  test("ring shows percentage text", async ({ page }) => {
    const pct = page.locator(".ring-pct");
    await expect(pct).toBeAttached();
    const text = await pct.textContent();
    expect(text).toMatch(/\d+%/);
  });

  test("context ring has tooltip with usage info", async ({ page }) => {
    const ring = page.locator(".ctx-ring-btn");
    const title = await ring.getAttribute("title");
    expect(title).toContain("context used");
  });

  test("ring starts at 0% when no tokens used", async ({ page }) => {
    const pct = page.locator(".ring-pct");
    const text = await pct.textContent();
    expect(text).toBe("0%");
  });

  test("context ring has compress icon", async ({ page }) => {
    const icon = page.locator(".ring-icon");
    await expect(icon).toBeAttached();
  });
});
