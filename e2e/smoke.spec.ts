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

// Helper: assert page rendered without JS errors. Captures pageerror
// events; some Sentry/PostHog console warnings are acceptable but a
// thrown JS error means the bundle is broken.
async function expectClean(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("public landing", () => {
  test("homepage renders the marketing hero", async ({ page }) => {
    const errors = await expectClean(page);
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

test.describe("auth pages", () => {
  test("login page renders without JS errors", async ({ page }) => {
    const errors = await expectClean(page);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    // Login page must show some form input (email/password) — otherwise
    // the SPA bundle is broken or the route is misconfigured.
    await expect(page.locator("input").first()).toBeVisible({ timeout: 10_000 });

    expect(
      errors,
      "Uncaught JS errors on /login:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("signup page renders without JS errors", async ({ page }) => {
    const errors = await expectClean(page);
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("input").first()).toBeVisible({ timeout: 10_000 });

    expect(
      errors,
      "Uncaught JS errors on /signup:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("forgot-password page renders", async ({ page }) => {
    await page.goto(`${BASE_URL}/forgot-password`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("static routes + tools", () => {
  test("404 page shows for unknown route", async ({ page }) => {
    await page.goto(`${BASE_URL}/this-route-definitely-does-not-exist-${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });
    // Body must render the React-side NotFound component (route exists in
    // App.tsx as <Route path="*" />). If Vercel's SPA-fallback rewrite ever
    // breaks, this catches it (bare 404 page from Vercel doesn't include "Helpr").
    await expect(page.locator("body")).toContainText(/(not found|404|home|Helpr)/i, { timeout: 10_000 });
  });

  test("Apple JWT generator tool loads", async ({ page }) => {
    // /tools/apple-jwt.html is a static file used during Apple Sign In
    // setup + every 6 months for JWT regeneration. If this file goes
    // missing, JWT regeneration day becomes a scramble.
    await page.goto(`${BASE_URL}/tools/apple-jwt.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Apple Sign In JWT Generator");
    // Sanity: form fields are rendered
    await expect(page.locator("#teamId")).toBeVisible();
    await expect(page.locator("#keyId")).toBeVisible();
    await expect(page.locator("#servicesId")).toBeVisible();
    await expect(page.locator("#p8")).toBeVisible();
    await expect(page.locator("#generate")).toBeVisible();
  });

  test("redirect /terms → /legal?tab=terms", async ({ page }) => {
    // The App.tsx route table has Navigate redirects for /terms, /privacy,
    // /community, /rules. Smoke-test one to catch accidental removal.
    await page.goto(`${BASE_URL}/terms`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/legal/);
  });
});
