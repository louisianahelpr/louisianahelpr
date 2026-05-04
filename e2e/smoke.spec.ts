import { test, expect } from "@playwright/test";

// Lean smoke tests for the deployed app. Goal: catch hard breakages
// (white screen, JS crash on landing, marketing routes 404) before they
// reach a wider audience.
//
// Posting a real job is intentionally NOT tested here yet — it requires a
// dedicated test customer account whose credentials live as repo secrets.
// The companion `.github/workflows/db-smoke.yml` workflow exercises the
// trigger fan-out path that broke production for ~2 days, so we have
// schema-level coverage for that specific bug class without needing a live
// account here.

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.VERCEL_URL ||
  "https://www.louisianahelpr.com";

test.describe("public landing", () => {
  test("homepage renders the marketing hero", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveTitle(/Helpr/i);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });

    expect(
      errors,
      "Uncaught JS errors on landing page:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("guest browse page loads without auth", async ({ page }) => {
    await page.goto(`${BASE_URL}/browse`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    expect(page.url()).not.toMatch(/\/login/);
  });

  test("legal page renders", async ({ page }) => {
    await page.goto(`${BASE_URL}/legal`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
  });
});
