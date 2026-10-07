/**
 * TEMPORARY evidence generator for Q1399 (not committed): the offer card on
 * both sides, before/after, route-mocked fixture rows (never the owner's job).
 * Run: Q1399_PHASE=before|after npx playwright test --project=happy-path zz-q1399-shots
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Page } from "@playwright/test";
import {
  test,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  buildFakeProfile,
  installSupabaseMocks,
  mockTable,
  mockRpc,
  seedAuthedSession,
  type FakeUser,
} from "./fixtures";

const PHASE = process.env.Q1399_PHASE || "after";
const OUT = resolve(homedir(), ".lh-shots", "q1399", PHASE);
mkdirSync(OUT, { recursive: true });

const H = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const dateOnly = (ms: number) => new Date(Date.now() + ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#b9a27a"/><rect x="40" y="40" width="320" height="220" fill="#e8dcc2"/><text x="200" y="160" font-size="28" text-anchor="middle" fill="#5b4a2c">room photo</text></svg>',
  );

const JOB_ID = "10000000-0000-4000-8000-00000000a399";
function job(accepted: boolean): Record<string, unknown> {
  return {
    id: JOB_ID,
    customer_id: FAKE_CUSTOMER.id,
    helper_id: FAKE_HELPER.id,
    title: "clean",
    description: "Clean my room: vacuum, dust, and wipe the windows.",
    category: "cleaning",
    status: "accepted",
    budget: 80,
    location: "1103 Center St, Lafayette, LA 70501",
    latitude: 30.22,
    longitude: -92.02,
    date_needed: dateOnly(64 * H),
    start_time: "14:00:00",
    photos: [PHOTO],
    payment_status: "escrow",
    is_group_job: false,
    helpers_needed: 1,
    is_recurring: false,
    accepted_at: iso(-2 * H),
    helper_confirmed_at: accepted ? iso(-1 * H) : null,
    response_deadline: accepted ? null : iso(18 * H + 9 * 60_000),
    direct_offer_status: null,
    offered_to_helper_id: null,
    created_at: iso(-30 * H),
    updated_at: iso(-2 * H),
  };
}
const app = (j: Record<string, unknown>) => ({
  id: "20000000-0000-4000-8000-00000000a399",
  job_id: JOB_ID,
  helper_id: FAKE_HELPER.id,
  status: "accepted",
  message: "I can do it.",
  created_at: iso(-20 * H),
  updated_at: iso(-2 * H),
  offer_message: null,
  job: j,
});

async function prep(page: Page, user: FakeUser, j: Record<string, unknown>, theme: "light" | "dark", width: number, pending: boolean) {
  await seedAuthedSession(page.context(), user, "");
  await page.context().addInitScript(
    ({ theme }) => {
      localStorage.setItem("helpr-theme", theme);
      localStorage.setItem("helpr_welcomed", "1");
      localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      localStorage.setItem("push-nudge-dismissed-at", String(Date.now()));
    },
    { theme },
  );
  await page.setViewportSize({ width, height: width > 1000 ? 1300 : 1500 });
  const helperProfile = { ...buildFakeProfile(FAKE_HELPER), full_name: "Lexi Lombas", stripe_account_id: null, stripe_payouts_enabled: false, stripe_identity_verified: false, idv_status: null };
  const posterProfile = { ...buildFakeProfile(FAKE_CUSTOMER), full_name: "Pierre Broussard" };
  await installSupabaseMocks(page, {
    user,
    seed: false,
    rules: [
      mockTable("profiles", [user.id === FAKE_HELPER.id ? helperProfile : posterProfile]),
      mockTable("jobs", [j]),
      mockRpc("get_jobs_for_my_applications", [j]),
      mockTable("applications", [app(j)]),
      mockTable("job_accept_pending", pending ? [{ job_id: JOB_ID }] : []),
      mockRpc("get_safe_profiles", [
        { user_id: FAKE_HELPER.id, id: "hp", full_name: "Lexi Lombas", avatar_url: null, location: "Lafayette, LA", ban_status: "active" },
        { user_id: FAKE_CUSTOMER.id, id: "cp", full_name: "Pierre Broussard", avatar_url: null, location: "Lafayette, LA", ban_status: "active" },
      ]),
      mockRpc("get_my_pending_direct_offers", []),
      mockRpc("accept_job_offer", { state: "pending_setup", missing: ["payout_setup", "stripe_id"] }),
      mockTable("user_violations", []),
      mockTable("group_job_helpers", []),
      mockTable("job_tracking", []),
      mockTable("schedule_change_requests", []),
    ],
  });
}

async function expand(page: Page) {
  const t = page.locator("button[aria-expanded]").filter({ hasText: "Expand Job Details" }).first();
  await t.waitFor({ state: "attached", timeout: 10_000 }).catch(() => undefined);
  if (await t.count()) await t.dispatchEvent("click");
  await page.waitForTimeout(700);
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(900);
  const card = page.locator("[data-job-card], article").first();
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  const fit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  console.log(`SHOT ${path} fits=${fit} cards=${await card.count()}`);
}

type Shot = { name: string; who: "helper" | "poster"; accepted: boolean; pending?: boolean; expanded: boolean; theme: "light" | "dark"; width: number; tapAccept?: boolean };
const SHOTS: Shot[] = [];
for (const who of ["helper", "poster"] as const) {
  for (const expanded of [false, true]) {
    SHOTS.push({ name: `${who}-offer-${expanded ? "expanded" : "collapsed"}-375-light`, who, accepted: false, expanded, theme: "light", width: 375 });
    SHOTS.push({ name: `${who}-offer-${expanded ? "expanded" : "collapsed"}-375-dark`, who, accepted: false, expanded, theme: "dark", width: 375 });
    SHOTS.push({ name: `${who}-offer-${expanded ? "expanded" : "collapsed"}-1440-light`, who, accepted: false, expanded, theme: "light", width: 1440 });
    SHOTS.push({ name: `${who}-accepted-${expanded ? "expanded" : "collapsed"}-375-light`, who, accepted: true, expanded, theme: "light", width: 375 });
  }
  SHOTS.push({ name: `${who}-accepted-expanded-1440-light`, who, accepted: true, expanded: true, theme: "light", width: 1440 });
}
SHOTS.push({ name: "helper-pending-expanded-375-light", who: "helper", accepted: false, pending: true, expanded: true, theme: "light", width: 375 });
SHOTS.push({ name: "helper-pending-expanded-375-dark", who: "helper", accepted: false, pending: true, expanded: true, theme: "dark", width: 375 });
SHOTS.push({ name: "helper-offer-tapped-accept-375-light", who: "helper", accepted: false, expanded: true, theme: "light", width: 375, tapAccept: true });

for (const s of SHOTS) {
  test(`q1399 ${PHASE} ${s.name}`, async ({ page }) => {
    test.skip(!process.env.Q1399_PHASE, "evidence generator; set Q1399_PHASE");
    const user = s.who === "helper" ? FAKE_HELPER : FAKE_CUSTOMER;
    await prep(page, user, job(s.accepted), s.theme, s.width, !!s.pending);
    await page.goto(s.who === "helper" ? "/jobs?filter=all" : "/posts?filter=all");
    await page.getByText("clean", { exact: true }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    if (s.expanded) await expand(page);
    if (s.tapAccept) {
      await page.getByRole("button", { name: /Accept Job|Set Up Payouts|Finish Stripe Setup/ }).first().click();
      await page.waitForTimeout(1200);
    }
    await shoot(page, s.name);
  });
}
