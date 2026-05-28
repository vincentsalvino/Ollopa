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
    const modal = page.locator(".system-prompt-modal");
    await expect(modal).toBeVisible();
  });

  test("system prompt modal shows template picker", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const templatePicker = page.locator(".template-picker");
    await expect(templatePicker).toBeVisible();
  });

  test("system prompt modal has save-as-template row", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const saveRow = page.locator(".template-save-row");
    await expect(saveRow).toBeVisible();
  });

  test("template name input is present", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const nameInput = page.locator(".template-name-input");
    await expect(nameInput).toBeVisible();
  });

  test("save template button is present", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const saveBtn = page.locator(".template-save-btn");
    await expect(saveBtn).toBeVisible();
  });

  test("template select dropdown lists templates from backend", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const options = page.locator(".template-select option");
    const count = await options.count();
    // At least the disabled placeholder + 1 mock template
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("save and cancel buttons are present", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    await expect(page.locator(".system-prompt-save")).toBeVisible();
    await expect(page.locator(".system-prompt-cancel")).toBeVisible();
  });

  test("cancel button closes the modal", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    await page.locator(".system-prompt-cancel").click();
    await expect(page.locator(".system-prompt-modal")).not.toBeVisible();
  });

  test("system prompt textarea is editable", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".system-prompt-modal");
    const textarea = page.locator(".system-prompt-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Custom system prompt");
    await expect(textarea).toHaveValue("Custom system prompt");
  });
});
