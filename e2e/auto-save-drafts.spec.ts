import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 2: Auto-Save Input Drafts", () => {
  test("typing saves draft to localStorage", async ({ page }) => {
    const textarea = page.locator(".chat-input");
    await textarea.fill("draft message here");
    // Wait for debounce (300ms)
    await page.waitForTimeout(500);
    const draft = await page.evaluate(() =>
      localStorage.getItem("ollopa-input-draft")
    );
    expect(draft).toBe("draft message here");
  });

  test("empty input removes draft from localStorage", async ({ page }) => {
    // Set a draft first
    await page.evaluate(() =>
      localStorage.setItem("ollopa-input-draft", "old draft")
    );
    const textarea = page.locator(".chat-input");
    await textarea.fill("");
    await page.waitForTimeout(500);
    const draft = await page.evaluate(() =>
      localStorage.getItem("ollopa-input-draft")
    );
    expect(draft).toBeNull();
  });

  test("draft is restored on page load", async ({ page }) => {
    // Set draft before reload
    await page.evaluate(() =>
      localStorage.setItem("ollopa-input-draft", "restored draft")
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".toolbar");
    const textarea = page.locator(".chat-input");
    await expect(textarea).toHaveValue("restored draft");
  });
});
