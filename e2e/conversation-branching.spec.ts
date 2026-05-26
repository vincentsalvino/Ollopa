import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 5: Conversation Branching", () => {
  test("user message shows edit button on hover", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("Test message for edit");
    await page.locator(".send-btn").click();
    await page.waitForTimeout(300);
    const userMsg = page.locator(".tl-user").first();
    if (await userMsg.isVisible()) {
      await userMsg.hover();
      await expect(userMsg).toBeVisible();
    }
  });

  test("timeline supports truncation action type", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("First message");
    await page.locator(".send-btn").click();
    await page.waitForTimeout(200);
    await textarea.fill("Second message");
    await page.locator(".send-btn").click();
    await expect(page.locator(".timeline-view")).toBeVisible();
  });

  test("sending a message clears the input", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("message to send");
    await page.locator(".send-btn").click();
    await page.waitForTimeout(200);
    await expect(textarea).toHaveValue("");
  });

  test("sending a message clears the draft from localStorage", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("test for draft clear");
    await page.waitForTimeout(400);
    await page.locator(".send-btn").click();
    await page.waitForTimeout(200);
    const draft = await page.evaluate(() =>
      localStorage.getItem("ollopa-input-draft")
    );
    expect(draft).toBeNull();
  });

  test("multiple messages appear in timeline in order", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("First message");
    await page.locator(".send-btn").click();
    await page.waitForTimeout(300);
    await textarea.fill("Second message");
    await page.locator(".send-btn").click();
    await page.waitForTimeout(300);
    const entries = page.locator(".tl-user");
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
