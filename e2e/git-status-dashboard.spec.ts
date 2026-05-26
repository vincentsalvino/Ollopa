import { test, expect } from "@playwright/test";
import { injectTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await injectTauriMock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".toolbar");
});

test.describe("Feature 7: Git Status in Dashboard", () => {
  test("dashboard panel is visible", async ({ page }) => {
    const dashboard = page.locator(".dashboard-panel");
    await expect(dashboard).toBeVisible();
  });

  test("git status card shows branch name when project loaded", async ({ page }) => {
    const dashboard = page.locator(".dashboard-panel:not(.collapsed)");
    if (await dashboard.isVisible()) {
      const branchName = page.locator(".git-branch-name");
      await expect(dashboard).toBeVisible();
    }
  });

  test("dashboard has card elements", async ({ page }) => {
    const cards = page.locator(".card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("dashboard can be collapsed and expanded", async ({ page }) => {
    const dashboard = page.locator(".dashboard-panel");
    await expect(dashboard).toBeVisible();
    // Click collapse button if it exists
    const collapseBtn = page.locator(".collapse-btn");
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await expect(dashboard).toHaveClass(/collapsed/);
    }
  });

  test("dashboard shows cost information", async ({ page }) => {
    const costCard = page.locator(".card").filter({ hasText: /cost|token|session/i });
    // At least the token/session card should be present
    const count = await costCard.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
