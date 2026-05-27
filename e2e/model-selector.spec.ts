import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Model Selector", () => {
  test("opens dropdown on click", async ({ page }) => {
    await page.locator(".model-pill").click();
    await expect(page.locator(".model-pill + .dropdown, .dropdown-wrapper .dropdown").first()).toBeVisible();
  });

  test("shows grouped models by provider", async ({ page }) => {
    await page.locator(".model-pill").click();
    const groups = page.locator(".dropdown-section-label");
    const groupTexts = await groups.allTextContents();
    expect(groupTexts).toContain("DeepSeek");
    expect(groupTexts).toContain("Anthropic");
    expect(groupTexts).toContain("OpenAI");
  });

  test("lists individual models under each group", async ({ page }) => {
    await page.locator(".model-pill").click();
    const items = page.locator(".dropdown-item");
    const count = await items.count();
    // DeepSeek(5) + Anthropic(2) + OpenAI(2) = 9
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test("includes deepseek-v4-pro model", async ({ page }) => {
    await page.locator(".model-pill").click();
    const items = await page.locator(".dropdown-item").allTextContents();
    expect(items.some((t) => t.includes("deepseek-v4-pro"))).toBeTruthy();
  });

  test("includes deepseek-v4-flash model", async ({ page }) => {
    await page.locator(".model-pill").click();
    const items = await page.locator(".dropdown-item").allTextContents();
    expect(items.some((t) => t.includes("deepseek-v4-flash"))).toBeTruthy();
  });
});
