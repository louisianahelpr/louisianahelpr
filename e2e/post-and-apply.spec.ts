import { test, expect } from "@playwright/test";

// Baseline e2e for the two highest-leverage marketplace paths: post a
// job (customer side) and apply to a job (helper side). Authenticated
// flows are skipped here — that requires fixtures + a test customer
// account whose credentials would live in CI secrets. What this spec
// catches today:
//
//   1. /post-job loads without JS errors when an anonymous user lands
//      on it (auth-gated route → should redirect, not crash)
//   2. /browse loads the public job feed without JS errors
//   3. The "Browse Local Jobs" CTA on the homepage actually routes to
//      a real page with content (regression on today's CTA fix)
//
// When we add a test-customer fixture, extend this file with the full
// happy-path: post → checkout (Stripe test mode) → apply → accept →
// complete → review reveal.

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.VERCEL_URL ||
  "https://www.louisianahelpr.com";

async function expectClean(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("post + apply baseline", () => {
  test("/post-job redirects anonymous to a valid surface (no crash)", async ({ page }) => {
    const errors = await expectClean(page);
    await page.goto(`${BASE_URL}/post-job`, { waitUntil: "domcontentloaded" });

    // ProtectedRoute should bounce to /login or /signup; either is fine
    // as long as the page renders something with at least one input.
    await page.locator("input").first().waitFor({ timeout: 10_000 });

    expect(
      errors,
      "Uncaught JS errors on /post-job redirect path:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("/browse renders the public guest dashboard", async ({ page }) => {
    const errors = await expectClean(page);
    await page.goto(`${BASE_URL}/browse`, { waitUntil: "domcontentloaded" });

    // Guest dashboard renders the marketing copy + jobs list. We don't
    // assert specific job content (depends on prod state) — just that
    // SOMETHING renders without crashing.
    await page.locator("h1, h2").first().waitFor({ timeout: 10_000 });

    expect(
      errors,
      "Uncaught JS errors on /browse:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("homepage 'Browse Local Jobs' CTA routes to /browse for anon", async ({ page }) => {
    const errors = await expectClean(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    // Wait for the hero render. The CTA text is exactly "Browse Local
    // Jobs" — sourced from HeroSection.tsx.
    const cta = page.getByRole("button", { name: /browse local jobs/i });
    await cta.waitFor({ timeout: 10_000 });

    // Click and verify we land on /browse (not /signup, which was the
    // pre-fix bug today).
    await cta.click();
    await page.waitForURL("**/browse", { timeout: 10_000 });

    expect(page.url()).toContain("/browse");
    expect(
      errors,
      "Uncaught JS errors during CTA navigation:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });
});
