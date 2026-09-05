import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// Produces the App Store review screenshot for the twelve in-app purchase
// products.
//
// Apple requires one per product: an image showing WHERE the purchase appears
// in the app. Every other requirement (name, description, price, availability)
// is set by scripts/asc/create.mjs; this is the only remaining reason all
// twelve sit in MISSING_METADATA — which blocks sandbox testing too, not just
// submission, because StoreKit does not return a product that never reached
// Ready to Submit.
//
// It rides the happy-path fixtures deliberately. Those stub every Supabase call
// and pre-seed an authed session, so this needs no live backend and no real
// credentials — it renders the actual SubscriptionTab, with the real tier cards
// built from TIER_PERKS, which is exactly the surface Apple is asking to see.
//
// Written as a spec rather than a standalone script so it inherits the same
// mocking, viewport and bundle-freshness guarantees the rest of the suite has.
// Run it on demand: `npx playwright test iap-review-screenshot`.
// `helperPage` — not `page`. The bare page fixture has no session, so
// /profile bounces to Log In; that is what the first run screenshotted.
test("capture the membership screen for App Store review", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, { user: FAKE_HELPER, rules: [] });
  // The onboarding tour renders a modal that would sit over the tier cards.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  // Apple requires the review screenshot to be at least 640x920. A 430x932
  // viewport is the true iPhone CSS width but produces a 430px-wide PNG at this
  // project's deviceScaleFactor of 1 — under the minimum, and rejected. The
  // viewport is therefore sized to clear the floor directly rather than
  // upscaling afterwards, which would be fake resolution rather than more
  // detail. It stays phone-proportioned (~2.1:1) so the layout Apple sees is
  // the phone layout a real buyer sees.
  await page.setViewportSize({ width: 720, height: 1520 });
  await page.goto("/profile?tab=subscription");

  // Wait for the tier cards themselves, not just the route — the tab is lazy
  // and a screenshot of the Suspense fallback would be worse than none.
  await expect(page.getByText("Elite", { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Plus", { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600); // let the entrance animation settle

  await page.screenshot({
    path: "e2e-artifacts/iap-review-screenshot.png",
    fullPage: false,
  });
});
