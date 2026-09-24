import { test, expect } from "./prodTest";
import { LOCAL_BASE_URL } from "./localBase";

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

// This checkout's local build, never the deployed site (e2e/localBase.ts).
const BASE_URL = LOCAL_BASE_URL;

// Helper: assert page rendered without JS errors. Captures pageerror
// events; some Sentry/PostHog console warnings are acceptable but a
// thrown JS error means the bundle is broken.
async function expectClean(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Shown able to fail on the contract this file states most precisely: /terms,
// /privacy and /rules became their own <Legal> routes on 2026-09-11 because the
// old <Navigate> hop cost a full extra routing round-trip on the coldest path
// there is — a fresh tab opened from the signup consent checkboxes. Putting the
// redirect back moves the URL to /legal and reds `toHaveURL(/\/terms$/)`.
// @mutate src/App.tsx | <Route path="/terms" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} /> | <Route path="/terms" element={<Navigate to="/legal?tab=terms" replace />} />

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

  test("Apple JWT generator is NOT served (BR-007)", async ({ page }) => {
    // The generator asks for a .p8 private key, so it lives in tools/ and is
    // opened as a local file; the public site must not serve it.
    await page.goto(`${BASE_URL}/tools/apple-jwt.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#p8")).toHaveCount(0);
  });

  test("/terms renders Legal directly, no redirect hop", async ({ page }) => {
    // As of 2026-09-11, /terms, /privacy and /rules are their own <Legal>
    // routes (App.tsx) instead of <Navigate> redirects to /legal?tab=… — the
    // hop was a full extra routing round-trip on the coldest possible path
    // (a fresh tab from the signup consent checkboxes). Smoke-test that the
    // URL stays put and only one navigation occurs.
    await page.goto(`${BASE_URL}/terms`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/terms$/);
    const navCount = await page.evaluate(
      () => performance.getEntriesByType("navigation").length,
    );
    expect(navCount).toBe(1);
  });
});
