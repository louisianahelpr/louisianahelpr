import { test, expect, FAKE_HELPER, installSupabaseMocks, type MockRule } from "./fixtures";
import { DATE } from "./seedData";

// Real-looking Louisiana work. `seed: true` alone does NOT populate the browse
// feed — it reads `open_jobs_browse`, which needs an explicit rule (the same
// thing browse-feed-completeness does). Without this the first attempt produced
// "0 jobs / Nothing today", which is the empty-state equivalent of the login
// screen Apple rejected: a screenshot that shows the app doing nothing.
/*
 * DATES ARE RELATIVE, AND MUST STAY RELATIVE.
 *
 * These four were hardcoded 2026-09-10..14. `useDashboardFilters.ts` drops any
 * job whose `date_needed` is before today, so on 2026-09-15 they began
 * vanishing one by one and by 2026-09-21 the feed was empty — and this spec
 * kept PASSING, because an empty state renders perfectly well. It was
 * capturing App Store screenshots of an app doing nothing: exactly the failure
 * the note above says Apple already rejected once.
 *
 * `DATE(n)` is days from now, and `seedData.ts` exports it with its own warning
 * about this precise trap. The offsets below preserve the original stagger.
 */
/*
 * `created_at` MUST BE IN THE PAST, AND BY MORE THAN 20 MINUTES.
 *
 * These four carried `created_at: new Date().toISOString()` — i.e. zero
 * seconds old — and that emptied the feed just as thoroughly as the expired
 * `date_needed` literals above, for a completely different reason.
 *
 * `useDashboardFilters.ts` applies the subscription "early access" perk
 * CLIENT-SIDE, as a predicate over the rows already returned:
 *
 *     const jobAge = Date.now() - new Date(job.created_at).getTime();
 *     if (jobAge < earlyAccessDelayMs(earlyAccessTier)) return false;
 *
 * FAKE_HELPER has no subscription tier, so `earlyAccessDelayMs` resolves to
 * the free-tier `MAX_EARLY_ACCESS_DELAY_MINUTES` = 20 minutes
 * (`src/lib/earlyAccess.ts`). A brand-new job is therefore invisible to this
 * viewer for its first 20 minutes, and every one of these was 0 minutes old.
 *
 * This is NOT something the mock can absorb. `FEED_RULES` matches on pathname
 * alone, so it happily ignores the server-side `.lte("created_at", cutoff)`
 * that `useDashboardData.ts` attaches — but the filter that actually removed
 * these rows runs in the browser, on the response body, after the mock has
 * already answered. A mock can decide what the server says; it cannot decide
 * what the app does with it. The fixture has to describe a world the app
 * still has, which means jobs old enough to have cleared the perk window.
 *
 * `AGO(n)` is minutes ago, staggered so the `created_at desc` ordering has
 * something real to sort and the feed reads like a live one.
 */
const AGO = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const FEED_JOBS = [
  { id: "aa000000-0000-4000-8000-000000000001", title: "Mow and edge a corner lot", category: "lawn_care",
    budget: 85, parish: "East Baton Rouge", location: "Baton Rouge, LA", latitude: 30.4515, longitude: -91.1871,
    date_needed: DATE(3), start_time: "09:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Front and back, about a quarter acre. Bagging preferred.",
    customer_id: "cc000000-0000-4000-8000-000000000001", created_at: AGO(95) },
  { id: "aa000000-0000-4000-8000-000000000002", title: "Deep clean before move-out", category: "cleaning",
    budget: 220, parish: "Orleans", location: "New Orleans, LA", latitude: 29.9511, longitude: -90.0715,
    date_needed: DATE(1), start_time: "13:00:00", status: "open", payment_status: "escrow",
    is_urgent: true, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Two bedroom shotgun. Kitchen, bath, floors, windows inside.",
    customer_id: "cc000000-0000-4000-8000-000000000002", created_at: AGO(45) },
  { id: "aa000000-0000-4000-8000-000000000003", title: "Help unloading a moving truck", category: "moving",
    budget: 140, parish: "Lafayette", location: "Lafayette, LA", latitude: 30.2241, longitude: -92.0198,
    date_needed: DATE(5), start_time: "08:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: true, helpers_needed: 2, credential_tier: 0, is_seed: false,
    description: "26-foot truck, second floor apartment. About three hours.",
    customer_id: "cc000000-0000-4000-8000-000000000003", created_at: AGO(150) },
  { id: "aa000000-0000-4000-8000-000000000004", title: "Fix a leaking kitchen faucet", category: "handyman",
    budget: 110, parish: "Jefferson", location: "Metairie, LA", latitude: 29.9841, longitude: -90.1529,
    date_needed: DATE(2), start_time: "10:30:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Dripping at the base. Parts already bought.",
    customer_id: "cc000000-0000-4000-8000-000000000004", created_at: AGO(70) },
  // Four was enough to satisfy the "not empty" assertion and still left the
  // bottom 40% of a 430x932 viewport as blank canvas — a product-page shot of
  // a feed that runs out. These fill the fold, so the screenshot shows a
  // marketplace with work on it rather than a list that ends.
  { id: "aa000000-0000-4000-8000-000000000005", title: "Pressure wash a driveway", category: "cleaning",
    budget: 95, parish: "Ascension", location: "Gonzales, LA", latitude: 30.2383, longitude: -90.9201,
    date_needed: DATE(4), start_time: "11:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Concrete drive and front walk. Mildew on the shaded side.",
    customer_id: "cc000000-0000-4000-8000-000000000005", created_at: AGO(115) },
  { id: "aa000000-0000-4000-8000-000000000006", title: "Assemble a nursery crib and dresser", category: "handyman",
    budget: 120, parish: "St. Tammany", location: "Mandeville, LA", latitude: 30.3580, longitude: -90.0653,
    date_needed: DATE(6), start_time: "14:00:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Both boxed, instructions inside. Haul the cardboard out after.",
    customer_id: "cc000000-0000-4000-8000-000000000006", created_at: AGO(200) },
  { id: "aa000000-0000-4000-8000-000000000007", title: "Trim two live oaks in the back yard", category: "lawn_care",
    budget: 260, parish: "Caddo", location: "Shreveport, LA", latitude: 32.5252, longitude: -93.7502,
    date_needed: DATE(8), start_time: "07:30:00", status: "open", payment_status: "escrow",
    is_urgent: false, is_group_job: false, helpers_needed: 1, credential_tier: 0, is_seed: false,
    description: "Low limbs over the shed. Bring your own pole saw.",
    customer_id: "cc000000-0000-4000-8000-000000000007", created_at: AGO(260) },
];

const FEED_RULES: MockRule[] = [
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/open_jobs_browse",
    handle: () => ({ status: 200, body: FEED_JOBS }) },
  { match: (u, m) => m === "POST" && u.pathname === "/rest/v1/rpc/get_safe_profiles",
    handle: () => ({ status: 200, body: FEED_JOBS.map((j, i) => ({
      user_id: j.customer_id, full_name: ["Camille R.", "Tre B.", "Marie H.", "Eli T.", "Danielle P.", "Andre S.", "Renee G."][i],
      avatar_url: null, location: j.location })) }) },
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
  { slug: "1-browse", url: "/home", wait: "job" },
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

        // POPULATED, not merely NON-EMPTY — and this is the assertion that was
        // missing.
        //
        // The two checks above were the spec's ONLY content assertions, and the
        // dashboard's EMPTY state clears both: "0 jobs · Nothing today" plus the
        // nav, filter chips and header runs far past 80 characters, and it is
        // obviously not a login form. So when the four hardcoded `date_needed`
        // literals expired and `useDashboardFilters.ts` began dropping every job
        // as past-dated, this spec kept PASSING on a feed with nothing in it —
        // for six days — which is exactly the "app doing nothing" screenshot
        // Apple rejected v1.0 for under 2.3.3. Making the dates relative
        // (`DATE(n)`) stopped the feed from emptying; it gave the spec no way to
        // NOTICE if it empties again. This does.
        //
        // `shot.wait` was declared per-shot for precisely this job and then read
        // by nothing — dead data shaped like a guard. It is read now.
        if (shot.wait) {
          await expect(
            page.getByText(shot.wait, { exact: false }).first(),
            `${shot.slug} never rendered its required content (${JSON.stringify(shot.wait)})`,
          ).toBeVisible({ timeout: 10_000 });
        }
        if (shot.url === "/home") {
          const shown = FEED_JOBS.filter((j) => text.includes(j.title));
          expect(
            shown.length,
            `${shot.slug} captured an EMPTY FEED: none of the ${FEED_JOBS.length} seeded job ` +
              `titles rendered. A product-page screenshot of the empty state IS the 2.3.3 ` +
              `rejection, not a picture of the app. Check every FEED_JOBS date_needed is ` +
              `still in the future — DATE(n), never a literal.`,
          ).toBeGreaterThan(0);
        }

        await page.screenshot({
          path: `e2e-artifacts/appstore/${device.key}/${shot.slug}.png`,
          fullPage: false,
        });
      });
    }
  });
}

// Proof this spec can fail. The defect it exists to catch is a feed that
// silently EMPTIES while the spec stays green — which is what happened for six
// days when the FEED_JOBS `date_needed` literals expired and
// `useDashboardFilters.ts` culled every one of them as past-dated.
//
// So the mutation is that exact cull, inverted: with `<` flipped to `>` the
// filter drops every FUTURE-dated job instead of every past-dated one, and all
// seven fixtures are DATE(1)..DATE(8). The dashboard renders its empty state,
// the product-page screenshot becomes a picture of the app doing nothing, and
// the `shown.length` assertion below is what notices.
// @mutate src/hooks/useDashboardFilters.ts | job.date_needed.slice(0, 10) < todayLocalDate | job.date_needed.slice(0, 10) > todayLocalDate
