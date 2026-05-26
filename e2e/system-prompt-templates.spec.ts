import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 6: System Prompt Template Library", () => {
  test("Ctrl+, opens system prompt modal", async ({ page }) => {
    await page.keyboard.press("Control+,");
    const modal = page.locator(".system-prompt-overlay");
    await expect(modal).toBeVisible();
  });

  test("system prompt modal shows template picker", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-overlay");
    const templatePicker = page.locator(".template-picker");
    await expect(templatePicker).toBeVisible();
  });

  test("system prompt modal has save-as-template row", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-overlay");
    const saveRow = page.locator(".template-save-row");
    await expect(saveRow).toBeVisible();
  });

  test("template name input is present", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-overlay");
    const nameInput = page.locator(".template-name-input");
    await expect(nameInput).toBeVisible();
  });

  test("save template button is present", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-overlay");
    const saveBtn = page.locator(".template-save-btn");
    await expect(saveBtn).toBeVisible();
  });
});
