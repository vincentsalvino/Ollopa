import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/");
  await page.waitForSelector(".toolbar");
});

test.describe("Chat Input", () => {
  test("input bar is visible and focusable", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await expect(textarea).toBeVisible();
    await textarea.focus();
    await expect(textarea).toBeFocused();
  });

  test("can type text into input", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("Hello world");
    await expect(textarea).toHaveValue("Hello world");
  });

  test("send button is visible", async ({ page }) => {
    const sendBtn = page.locator(".send-btn");
    await expect(sendBtn).toBeVisible();
  });

  test("shows file attach button", async ({ page }) => {
    const attachBtn = page.locator(".attach-btn");
    await expect(attachBtn).toBeVisible();
  });

  test("placeholder text is shown when empty", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    const placeholder = await textarea.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder!).toContain("Ask Claude anything");
  });
});
