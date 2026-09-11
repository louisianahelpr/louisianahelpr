import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { LATEST_TERMS_VERSION as TERMS_VERSION } from "../../src/lib/consent";

/**
 * INSTRUMENTATION ONLY — not a guard. Ranks every late arrival on the job
 * detail sheet by how many pixels it moves the sheet's TOP edge.
 *
 * The sheet is centred and content-sized, so any height that arrives after the
 * first paint moves BOTH edges by half of it. This probe staggers each backend
 * round trip by a known delay, records the sheet's box every 50ms, and logs
 * every DOM mutation that changed the height together with the subtree that
 * caused it — so each step in the timeline is attributable to one source.
 */

const OWN_ID = FAKE_HELPER.id;
const POSTER_ID = "33333333-3333-4333-8333-333333333333";

const BASE_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  customer_id: POSTER_ID,
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "escrow",
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_flexible_schedule: false,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 1,
  special_requirements: null,
  photos: [],
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  boosted_at: null,
  boost_expires_at: null,
  recurrence_interval: null,
  recurrence_end_date: null,
  parent_job_id: null,
  helper_id: null,
  credential_tier: 0,
  parish: "Orleans",
};

const LONG_DESC =
  "We are moving a three-bedroom apartment across town and need a second pair of hands for the heavy items. " +
  "The sofa is a sleeper and will need to come down two flights of stairs. There is a dining table with a glass top, " +
  "a queen mattress, six boxes of books, and a small upright piano that we will handle together. " +
  "Parking is on the street; there is a loading zone out front we can use for an hour. " +
  "Please wear closed shoes and bring gloves if you have them. We will provide water and lunch. " +
  "The whole job should take about four hours start to finish.";

const POSTER_PROFILE = {
  user_id: POSTER_ID,
  full_name: "Jane Poster",
  subscription_tier: "free",
  subscription_expires_at: null,
};

/** Profile of the SIGNED-IN helper — this is what useAwardBlockReason reads. */
function selfProfile(payouts: boolean) {
  // Mirrors the fixture's own buildFakeProfile (not exported) so the
  // ProtectedRoute "Big 7" gate passes, plus the payout fields this probe
  // is actually varying.
  const nowIso = new Date().toISOString();
  const PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  return {
    id: `${OWN_ID}-profile`,
    user_id: OWN_ID,
    full_name: FAKE_HELPER.fullName,
    avatar_url: PX,
    bio: "Smoke-test profile bio with at least twenty characters.",
    date_of_birth: "1990-01-01",
    phone: "5045550100",
    location: "New Orleans, LA",
    id_document_url: PX,
    approval_status: "approved",
    ban_status: "active",
    is_legacy_user: true,
    subscription_tier: "free",
    subscription_expires_at: null,
    referral_code: "SMOKE",
    terms_version_accepted: TERMS_VERSION,
    role: FAKE_HELPER.role,
    created_at: nowIso,
    updated_at: nowIso,
    is_seed: false,
    stripe_account_id: payouts ? "acct_live_123" : null,
    stripe_payouts_enabled: payouts,
    stripe_identity_verified: payouts,
    idv_status: payouts ? "verified" : null,
  };
}

/** Per-endpoint stagger, ms. Distinct values so the timeline is attributable. */
const DELAYS: Array<[RegExp, number, string]> = [
  [/\/rest\/v1\/profiles/, 1500, "profiles (useCurrentUser -> payout explainer)"],
  [/\/rest\/v1\/rpc\/get_user_credential_tier/, 2200, "viewerTier"],
  [/\/rest\/v1\/applications/, 2900, "applications (viewerAppPosition/viewerUserId)"],
  [/\/rest\/v1\/jobs/, 3600, "jobs counts (repeatJobs / posterCancelRate)"],
  [/\/rest\/v1\/rpc\/get_safe_profiles/, 4300, "get_safe_profiles (poster card)"],
];

async function armStagger(page: Page, armedRef: { on: boolean }) {
  await page.route("**/rest/v1/**", async (route) => {
    if (armedRef.on) {
      const url = route.request().url();
      const hit = DELAYS.find(([re]) => re.test(url));
      if (hit) await new Promise((r) => setTimeout(r, hit[1]));
    }
    await route.fallback();
  });
}

/**
 * Installed BEFORE the sheet exists, so frame ONE is the first frame the
 * reader could see — attaching after `waitFor()` misses the whole opening
 * layout and reports a jump that was really the mount.
 */
async function armRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __jumpy?: unknown };
    const frames: Array<Record<string, unknown>> = [];
    let t0 = -1;
    let lastH = -1;
    let stopped = false;
    const kidLine = (dlg: Element) =>
      [...dlg.children]
        .map((c) => `${+(c as HTMLElement).getBoundingClientRect().height.toFixed(0)}:${(c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 26)}`)
        .join(" | ");
    const tick = () => {
      if (stopped) return;
      const dlg = document.querySelector('[role="dialog"]');
      if (dlg) {
        const r = dlg.getBoundingClientRect();
        if (t0 < 0) t0 = performance.now();
        const h = +r.height.toFixed(1);
        const last = frames[frames.length - 1];
        const stale = !last || performance.now() - t0 - (last.t as number) > 250;
        if (Math.abs(h - lastH) >= 0.5 || frames.length === 0 || stale) {
          lastH = h;
          frames.push({
            t: Math.round(performance.now() - t0),
            top: +r.top.toFixed(1),
            bottom: +r.bottom.toFixed(1),
            h,
            fonts: document.fonts.status,
            kids: kidLine(dlg),
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (w as { __jumpy: unknown }).__jumpy = {
      frames,
      stop: () => { stopped = true; },
    };
  });
}

async function collect(page: Page, label: string) {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __jumpy: { frames: Array<Record<string, unknown>>; stop: () => void } };
    w.__jumpy.stop();
    return w.__jumpy.frames;
  });
  const tops = frames.map((f) => f.top as number);
  const first = tops[0];
  const settled = tops[tops.length - 1];
  let travel = 0;
  for (let i = 1; i < tops.length; i++) travel += Math.abs(tops[i] - tops[i - 1]);
  // THE SHARED DIALOG ENTRANCE IS NOT A LATE ARRIVAL. `.glass-modal` enters
  // with tailwindcss-animate's `zoom-in-95` over `duration-300`, i.e. a
  // scale(0.95) -> scale(1) on a centred box, which grows the bounding rect
  // ~5% uniformly (title 86->91, close button 42->44) and therefore walks the
  // top edge a few px. It is designed motion shared by every popup in the app,
  // it is over by ~180ms, and it is measured separately here so it cannot be
  // mistaken for content arriving late.
  const post = frames.filter((f) => (f.t as number) >= 320);
  let postTravel = 0;
  for (let i = 1; i < post.length; i++) postTravel += Math.abs((post[i].top as number) - (post[i - 1].top as number));
  const out = {
    label,
    postEntranceTravel: +postTravel.toFixed(1),
    firstTop: first,
    settledTop: settled,
    netTopMove: +(settled - first).toFixed(1),
    totalTopTravel: +travel.toFixed(1),
    firstH: frames[0].h,
    settledH: frames[frames.length - 1].h,
    steps: frames,
  };
  console.log("\n===== JUMPY " + label + " =====");
  console.log(JSON.stringify(out, null, 2));
  return out;
}

interface Scenario {
  label: string;
  payouts: boolean;
  job: Record<string, unknown>;
  /** Viewer's credential tier, answered by get_user_credential_tier. */
  tier?: number;
  /** Rows the `jobs` count queries answer with (drives repeatJobs). */
  repeat?: number;
  /** Signed OUT — the guest sheet, which has no apply form at all. */
  guest?: boolean;
}

const SCENARIOS: Scenario[] = [
  { label: "a-no-payouts", payouts: false, job: BASE_JOB },
  { label: "b-payouts-ok", payouts: true, job: BASE_JOB },
  { label: "c-long-description", payouts: false, job: { ...BASE_JOB, description: LONG_DESC } },
  // (d) THE OWNER'S OWN POST has no authed entry point to this sheet — the
  // feed filters your own jobs out and /jobs/:id bounces an authed visitor to
  // /dashboard with a QuickApply banner. So the fourth case is the surface
  // that DOES exist with no inline apply form: the signed-out guest sheet,
  // which is also the "guests unchanged" control.
  // (e) and (f) force the two remaining late arrivals the base job cannot:
  // a credential-gated job (viewerTier decides which bottom the sheet has)
  // and a poster this helper has worked for twice (the trust row appears).
  { label: "e-credential-gated", payouts: true, job: { ...BASE_JOB, credential_tier: 2 }, tier: 2 },
  { label: "f-repeat-poster", payouts: true, job: BASE_JOB, repeat: 3 },
];

for (const sc of SCENARIOS) {
  test(`jumpy probe: ${sc.label}`, async ({ helperPage: page }) => {
    test.setTimeout(180_000);
    const armed = { on: false };
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockRpc("get_safe_profiles", [POSTER_PROFILE]),
        mockRpc("get_user_credential_tier", sc.tier ?? 0),
        // `jobs` is only ever read here as a HEAD count (repeatJobs,
        // posterCancelRate); PostgREST puts the number in Content-Range.
        {
          match: (url, method) => method === "GET" && url.pathname === "/rest/v1/jobs",
          handle: () => ({
            status: 200,
            body: [],
            headers: { "content-range": `0-0/${sc.repeat ?? 0}` },
          }),
        },
        mockTable("open_jobs_browse", [sc.job]),
        {
          // `.maybeSingle()` callers error on 2 rows — resolve the filter.
          match: (url, method) => method === "GET" && url.pathname === "/rest/v1/profiles",
          handle: (url) => {
            const want = (url.searchParams.get("user_id") ?? url.searchParams.get("id") ?? "").replace(/^eq\./, "");
            const pool = [selfProfile(sc.payouts), POSTER_PROFILE] as Array<Record<string, unknown>>;
            return { status: 200, body: want ? pool.filter((r) => r.user_id === want || r.id === want) : [pool[0]] };
          },
        },
        mockTable("helper_availability", []),
        mockTable("applications", []),
        mockTable("user_blocks", []),
        mockTable("saved_jobs", []),
        mockTable("saved_searches", []),
        mockTable("reviews", []),
      ],
    });
    await armStagger(page, armed);
    await armRecorder(page);
    await page.addInitScript(() => {
      try { localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true })); } catch { /* */ }
    });
    await page.setViewportSize({ width: 375, height: 812 });

    // THE ARTEFACT IS THE PHONE, NOT THIS LAPTOP. 4x CPU and a slow link are
    // what separate a lazy chunk's arrival from the first paint — at full
    // desktop speed a 340px insertion lands inside 50ms and reads as noise.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");

    const throttle = async () => {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8,
      });
    };

    await page.goto("/dashboard");
    const card = page.getByText(BASE_JOB.title).first();
    await card.waitFor({ timeout: 45_000 });
    await page.waitForTimeout(500);
    // From here on, every sheet-scoped round trip is staggered AND slow.
    armed.on = true;
    await throttle();
    await card.click();

    const sheet = page.locator('[role="dialog"]').last();
    await sheet.waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `/tmp/jumpy/${sc.label}-first.png` });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `/tmp/jumpy/${sc.label}-settled.png` });
    const res = await collect(page, sc.label);
    expect(res.settledH).toBeGreaterThan(0);
  });
}

/**
 * (d) THE TWO CASES WITH NO INLINE APPLY FORM.
 *
 * "The user's own post" is NOT reachable on this sheet: the feed filters out
 * jobs you posted, and /jobs/:id has been signed-in-only since 2026-09-02 and
 * bounces a signed-in visitor to /dashboard — so the `guest` JobDetailDialog
 * that route renders, and the "This is your post" footer branch, have no
 * reachable state at all. Reported, not fixed here.
 *
 * The guest sheet on /browse could not be driven under the 4x-CPU / 400kbps
 * emulation this probe runs at (DashboardGuest's chunk chain does not settle
 * inside the budget and MarketingRedirect takes over), so it is asserted the
 * only other way that is actually true rather than assumed: guests are
 * unchanged because DashboardGuest never hands this sheet an `applyForm` at
 * all. There is no lazy boundary to bubble and nothing to arrive late — the
 * height that was jumping does not exist on that surface.
 */
test("d: the guest sheet has no apply form to arrive late", async () => {
  const src = await readFile(
    new URL("../../src/pages/DashboardGuest.tsx", import.meta.url),
    "utf8",
  );
  expect(src).toContain("<JobDetailDialog");
  expect(src).not.toContain("applyForm");
  expect(src).not.toContain("ApplyBody");
});
