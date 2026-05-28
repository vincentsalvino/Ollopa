import { chromium } from "@playwright/test";

/**
 * Warm up the Vite dev server by visiting the page once before tests run.
 * This forces Vite to pre-bundle all dependencies and compile all modules,
 * so subsequent test navigations don't hit cold-start timeouts.
 */
export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto("http://localhost:5173", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
  } catch (_) {
    // Swallow errors — this is just a warmup to trigger module compilation.
  }
  await browser.close();
}
