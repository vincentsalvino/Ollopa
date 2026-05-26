import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("API Key Management Modal", () => {
  async function openApiKeysModal(page: import("@playwright/test").Page) {
    await page.locator(".model-selector-btn").click();
    await page.locator(".api-key-btn").click();
    await page.waitForSelector(".api-keys-modal");
  }

  test("opens from model dropdown", async ({ page }) => {
    await openApiKeysModal(page);
    await expect(page.locator(".api-keys-modal")).toBeVisible();
    // Model dropdown should close
    await expect(page.locator(".grouped-model-dropdown")).not.toBeVisible();
  });

  test("shows all 6 providers", async ({ page }) => {
    await openApiKeysModal(page);
    const rows = page.locator(".api-key-row");
    await expect(rows).toHaveCount(6);
  });

  test("displays correct provider names", async ({ page }) => {
    await openApiKeysModal(page);
    const names = await page.locator(".api-key-provider").allTextContents();
    expect(names).toContain("DeepSeek");
    expect(names).toContain("Anthropic Claude");
    expect(names).toContain("OpenAI");
    expect(names).toContain("OpenRouter");
    expect(names).toContain("Nous Research");
    expect(names).toContain("Tavily (Web Search)");
  });

  test("shows env var names", async ({ page }) => {
    await openApiKeysModal(page);
    const envVars = await page.locator(".api-key-envvar").allTextContents();
    expect(envVars).toContain("DEEPSEEK_API_KEY");
    expect(envVars).toContain("ANTHROPIC_API_KEY");
    expect(envVars).toContain("OPENAI_API_KEY");
  });

  test("shows Active status for set keys", async ({ page }) => {
    await openApiKeysModal(page);
    const activeStatuses = page.locator(".api-key-status.set");
    // Claude is set in our mock
    await expect(activeStatuses).toHaveCount(1);
    await expect(activeStatuses.first()).toContainText("Active");
  });

  test("shows Not set status for unset keys", async ({ page }) => {
    await openApiKeysModal(page);
    const notSetStatuses = page.locator(".api-key-status.not-set");
    await expect(notSetStatuses).toHaveCount(5);
  });

  test("shows masked key for active provider", async ({ page }) => {
    await openApiKeysModal(page);
    const masked = page.locator(".api-key-masked");
    await expect(masked).toHaveCount(1);
    await expect(masked.first()).toContainText("sk-a****xyz1");
  });

  test("clicking Add Key shows input field", async ({ page }) => {
    await openApiKeysModal(page);
    // Click "Add Key" on the first unset provider (DeepSeek)
    const addBtns = page.locator(".api-key-edit-btn");
    await addBtns.first().click();
    await expect(page.locator(".api-key-input")).toBeVisible();
    await expect(page.locator(".api-key-save-btn")).toBeVisible();
    await expect(page.locator(".api-key-cancel-btn")).toBeVisible();
  });

  test("cancel editing hides input field", async ({ page }) => {
    await openApiKeysModal(page);
    const addBtns = page.locator(".api-key-edit-btn");
    await addBtns.first().click();
    await expect(page.locator(".api-key-input")).toBeVisible();
    await page.locator(".api-key-cancel-btn").click();
    await expect(page.locator(".api-key-input")).not.toBeVisible();
  });

  test("input field is of type password", async ({ page }) => {
    await openApiKeysModal(page);
    const addBtns = page.locator(".api-key-edit-btn");
    await addBtns.first().click();
    const input = page.locator(".api-key-input");
    await expect(input).toHaveAttribute("type", "password");
  });

  test("close button dismisses modal", async ({ page }) => {
    await openApiKeysModal(page);
    await page.locator(".api-keys-close").click();
    await expect(page.locator(".api-keys-modal")).not.toBeVisible();
  });

  test("clicking overlay dismisses modal", async ({ page }) => {
    await openApiKeysModal(page);
    // Click on the overlay (outside the modal)
    await page.locator(".modal-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".api-keys-modal")).not.toBeVisible();
  });

  test("Escape key dismisses modal", async ({ page }) => {
    await openApiKeysModal(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".api-keys-modal")).not.toBeVisible();
  });
});
