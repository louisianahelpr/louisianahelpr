import { test, expect, FAKE_HELPER, installSupabaseMocks, type MockRule } from "./fixtures";

// Real-looking Louisiana work. `seed: true` alone does NOT populate the browse
// feed — it reads `open_jobs_browse`, which needs an explicit rule (the same
// thing browse-feed-completeness does). Without this the first attempt produced
// "0 jobs / Nothing today", which is the empty-state equivalent of the login
// screen Apple rejected: a screenshot that shows the app doing nothing.
const FEED_JOBS = [
  { id: "aa000000-0000-4000-8000-000000000001", title: "Mow and edge a corner lot", category: "lawn_care",
    budget: 85, parish: "East Baton Rouge", location: "Baton Rouge, LA", latitude: 30.4515, longitude: -91.1871,
    date_needed: "2026-09-12", start_time: "09:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Front and back, about a quarter acre. Bagging preferred.",
    customer_id: "cc000000-0000-4000-8000-000000000001", created_at: new Date().toISOString() },
  { id: "aa000000-0000-4000-8000-000000000002", title: "Deep clean before move-out", category: "cleaning",
    budget: 220, parish: "Orleans", location: "New Orleans, LA", latitude: 29.9511, longitude: -90.0715,
    date_needed: "2026-09-10", start_time: "13:00:00", status: "open", payment_status: "escrow",
    is_urgent: true, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Two bedroom shotgun. Kitchen, bath, floors, windows inside.",
    customer_id: "cc000000-0000-4000-8000-000000000002", created_at: new Date().toISOString() },
  { id: "aa000000-0000-4000-8000-000000000003", title: "Help unloading a moving truck", category: "moving",
    budget: 140, parish: "Lafayette", location: "Lafayette, LA", latitude: 30.2241, longitude: -92.0198,
    date_needed: "2026-09-14", start_time: "08:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: true, helpers_needed: 2, credential_tier: 0, is_seed: false,
    description: "26-foot truck, second floor apartment. About three hours.",
    customer_id: "cc000000-0000-4000-8000-000000000003", created_at: new Date().toISOString() },
  { id: "aa000000-0000-4000-8000-000000000004", title: "Fix a leaking kitchen faucet", category: "handyman",
    budget: 110, parish: "Jefferson", location: "Metairie, LA", latitude: 29.9841, longitude: -90.1529,
    date_needed: "2026-09-11", start_time: "10:30:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Dripping at the base. Parts already bought.",
    customer_id: "cc000000-0000-4000-8000-000000000004", created_at: new Date().toISOString() },
];

const FEED_RULES: MockRule[] = [
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/open_jobs_browse",
    handle: () => ({ status: 200, body: FEED_JOBS }) },
  { match: (u, m) => m === "POST" && u.pathname === "/rest/v1/rpc/get_safe_profiles",
    handle: () => ({ status: 200, body: FEED_JOBS.map((j, i) => ({
      user_id: j.customer_id, full_name: ["Camille R.", "Tre B.", "Marie H.", "Eli T."][i],
      avatar_url: null, is_verified: true, location: j.location })) }) },
];

// App Store product-page screenshots, generated from the real app.
//
// App Review rejected version 1.0 under 2.3.3: "The 13-inch iPad screenshots
// only display a login screen. Screenshots should highlight the app's core
// concept." Apple is explicit that splash and login screens do not count as
// showing the app in use.
//
// So these drive the ACTUAL signed-in app through the happy-path fixtures —
// which stub Supabase and seed real jobs — and capture the screens that show
// what Helpr does. No marketing mockups: Apple's guidance also rules those out.
//
// SIZES ARE NOT NEGOTIABLE. Apple accepts a fixed set of device resolutions,
// and the IAP review screenshot was rejected earlier today for exactly this
// (IMAGE_INCORRECT_DIMENSIONS) before landing on a real one. Both below are
// produced from genuine pixels — CSS size x deviceScaleFactor — never upscaled:
//   iPhone 6.9"  430 x 932  @3 = 1290 x 2796
//   iPad 13"    1032 x 1376 @2 = 2064 x 2752
const SHOTS = [
  { slug: "1-browse", url: "/dashboard", wait: "job" },
  { slug: "2-post", url: "/post-job", wait: "" },
  { slug: "3-messages", url: "/messages", wait: "" },
  { slug: "4-membership", url: "/profile?tab=subscription", wait: "Plus" },
  { slug: "5-earnings", url: "/profile?tab=earnings", wait: "" },
];

// OPT-IN, not part of CI. Two reasons, and the second is the important one:
//
//   1. It currently fails on iPad — MapKit JS cannot load in this offline
//      harness, so the browse panel renders "The map isn't available right
//      now". The guard that catches that is doing its job; it just means the
//      iPad browse shot is not producible here yet.
//   2. Screenshots should be generated from the FINISHED app (owner, 2026-09-06).
//      Capturing them now would pin the product page to a half-fixed state.
//
// Run on demand once the app is ready:
//   RUN_APPSTORE_SHOTS=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path -g "screenshot "
const RUN = process.env.RUN_APPSTORE_SHOTS === "1";

const DEVICES = [
  { key: "iphone-6.9", css: { width: 430, height: 932 }, scale: 3 },
  { key: "ipad-13", css: { width: 1032, height: 1376 }, scale: 2 },
];

for (const device of DEVICES) {
  test.describe(`${device.key}`, () => {
    test.use({ deviceScaleFactor: device.scale });

    for (const shot of SHOTS) {
      test(`screenshot ${shot.slug}`, async ({ helperPage: page }) => {
        test.skip(!RUN, "opt-in: set RUN_APPSTORE_SHOTS=1 (see the note above)");
        // seed: true is what puts real jobs on the feed. Without it the
        // dashboard renders its empty state, which is the same "nothing to see"
        // problem as a login screen.
        await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true, rules: FEED_RULES });
        await page.addInitScript(() => {
          try {
            localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
            localStorage.setItem("helpr_welcomed", "1");
          } catch { /* no-storage guard */ }
        });
        await page.setViewportSize(device.css);
        await page.goto(shot.url);
        await page.waitForTimeout(2500);

        // MapKit JS cannot load in this offline harness, so the map panel
        // renders "The map isn't available right now" — an error banner is the
        // last thing that belongs on a product page. Switch to the list view if
        // the toggle is present.
        const listToggle = page.getByRole("button", { name: /list view|show list/i }).first();
        if (await listToggle.isVisible().catch(() => false)) {
          await listToggle.click().catch(() => {});
          await page.waitForTimeout(1200);
        }
        // And never ship a shot with a visible failure message on it.
        const bodyNow = (await page.textContent("body")) ?? "";
        expect(bodyNow, `${shot.slug} shows an error banner`).not.toMatch(/isn't available right now|something went wrong/i);

        const text = (await page.textContent("body")) ?? "";
        // Guard against shipping the very thing Apple rejected: a screen with
        // nothing on it, or a login form.
        expect(text.trim().length, `${shot.slug} rendered almost nothing`).toBeGreaterThan(80);
        expect(text, `${shot.slug} is a login screen`).not.toMatch(/Forgot Password\?/i);

        await page.screenshot({
          path: `e2e-artifacts/appstore/${device.key}/${shot.slug}.png`,
          fullPage: false,
        });
      });
    }
  });
}
