import { test, expect } from "./prodTest";
import { LOCAL_BASE_URL } from "./localBase";

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

// This checkout's local build, never the deployed site (e2e/localBase.ts).
const BASE_URL = LOCAL_BASE_URL;

async function expectClean(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// ⚠ NOT RUN BY CI as of 2026-09-21. `playwright test --project=chromium --list`
// collects ten specs; every workflow that runs that project names its files
// explicitly, and five of the ten — this one, smoke, a11y,
// visual-audit/desktop-fill and visual-audit/responsive — are named by no
// workflow and no npm script. Running all five locally takes 2.6 minutes and
// found four real failures, including the stale locator below. Reported to the
// orchestrator for a wiring decision rather than wired here unilaterally.

// Shown able to fail on the regression it was written for. The header of the
// third test names it: the CTA used to route to /signup, and "not /signup,
// which was the pre-fix bug today" is the whole reason that test exists.
// Sending the hero's Browse CTA back to /signup reproduces it exactly.
// @mutate src/components/landing/HeroSection.tsx | <Link to={loggedIn ? "/home" : "/browse"}> | <Link to={loggedIn ? "/home" : "/signup"}>

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

    // Wait for the hero render. The label is "Browse Jobs"
    // (src/components/landing/HeroSection.tsx) — it was "Browse Local Jobs"
    // when this was written, and this line still said so on 2026-09-21, so the
    // test had been failing on a locator timeout rather than on the behaviour
    // it names. It went unnoticed because NOTHING RUNS THIS SPEC: the chromium
    // project is only ever invoked with an explicit file list
    // (e2e-real-backend.yml) and this file is in none of them.
    const cta = page.getByRole("link", { name: /browse jobs/i }).first();
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
