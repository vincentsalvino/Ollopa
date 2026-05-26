import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Model Selector", () => {
  test("opens dropdown on click", async ({ page }) => {
    await page.locator(".model-selector-btn").click();
    await expect(page.locator(".grouped-model-dropdown")).toBeVisible();
  });

  test("shows grouped models by provider", async ({ page }) => {
    await page.locator(".model-selector-btn").click();
    const groups = page.locator(".model-group-label");
    const groupTexts = await groups.allTextContents();
    expect(groupTexts).toContain("DeepSeek");
    expect(groupTexts).toContain("Claude");
    expect(groupTexts).toContain("OpenAI");
    expect(groupTexts).toContain("OpenRouter / Hermes");
    expect(groupTexts).toContain("Nous Research");
  });

  test("shows Manage API Keys button at top", async ({ page }) => {
    await page.locator(".model-selector-btn").click();
    const apiKeyBtn = page.locator(".api-key-btn");
    await expect(apiKeyBtn).toBeVisible();
    await expect(apiKeyBtn).toContainText("Manage API Keys");
  });

  test("lists individual models under each group", async ({ page }) => {
    await page.locator(".model-selector-btn").click();
    const items = page.locator(".model-dropdown-item:not(.api-key-btn)");
    const count = await items.count();
    // At least the DeepSeek models + Claude + OpenAI + OpenRouter + Nous
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test("closes dropdown on Escape", async ({ page }) => {
    await page.locator(".model-selector-btn").click();
    await expect(page.locator(".grouped-model-dropdown")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".grouped-model-dropdown")).not.toBeVisible();
  });
});
