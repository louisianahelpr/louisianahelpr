import { test as base, expect } from "@playwright/test";
import {
  FAKE_HELPER,
  installSupabaseMocks,
  mockRpc,
  mockTable,
  seedAuthedSession,
} from "../../happy-path/fixtures";
import { assertHealthy } from "./guard";

// DEEP LINKS a real person taps from a push, an email or a text — signed in and
// signed out, including a job that no longer exists. Each must land on a real
// screen (or sign-in that returns them there), never an error screen or a 404.

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const GONE_ID = "99999999-9999-4999-8999-999999999999";
const POSTER_ID = "33333333-3333-4333-8333-333333333333";

const OPEN_JOB = {
  id: JOB_ID,
  customer_id: POSTER_ID,
  title: "Deep link job: fence repair",
  description: "Two panels of cedar fence came down in the storm.",
  category: "handyman",
  budget: 120,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "10:00",
  location: "Baton Rouge, LA",
  status: "open",
  payment_status: "escrow",
  created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 2,
  special_requirements: null,
  photos: [],
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  boost_expires_at: null,
  helper_id: null,
};

const rules = [
  mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
  mockRpc("get_safe_profiles", [{ user_id: POSTER_ID, full_name: "Pat Poster", avatar_url: null }]),
  mockTable("open_jobs_browse", [OPEN_JOB], { honorFilters: true }),
  mockTable("jobs", [OPEN_JOB], { honorFilters: true }),
];

const signedOut = base;

signedOut.describe("deep links — signed out", () => {
  for (const [from, intended] of [
    [`/jobs/${JOB_ID}`, `/jobs/${JOB_ID}`],
    [`/j/${JOB_ID}`, `/jobs/${JOB_ID}`],
    [`/messages/${JOB_ID}`, `/messages?jobId=${JOB_ID}`],
    [`/u/${POSTER_ID}`, `/user/${POSTER_ID}`],
    ["/profile?tab=earnings", "/profile?tab=earnings"],
    [`/jobs/${GONE_ID}`, `/jobs/${GONE_ID}`],
  ] as const) {
    signedOut(`${from} → sign in, remembering where they were headed`, async ({ page }, info) => {
      await installSupabaseMocks(page, { rules });
      await page.goto(from);
      await page.waitForURL(/\/login\?redirect=/, { timeout: 15_000 });
      const redirect = new URL(page.url()).searchParams.get("redirect");
      expect(redirect, `redirect param after ${from}`).toBe(intended);
      await assertHealthy(page, info, "signed-out-landing");
    });
  }
});

const signedIn = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, rules });
    await use(page);
  },
});

signedIn.describe("deep links — signed in", () => {
  signedIn("/jobs/:id from a notification opens that job", async ({ page }, info) => {
    await page.goto(`/jobs/${JOB_ID}`);
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByText(OPEN_JOB.title).first()).toBeVisible({ timeout: 15_000 });
    await assertHealthy(page, info, "job-open");
  });

  signedIn("/j/:id share link opens that job", async ({ page }, info) => {
    await page.goto(`/j/${JOB_ID}`);
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByText(OPEN_JOB.title).first()).toBeVisible({ timeout: 15_000 });
    await assertHealthy(page, info, "share-open");
  });

  signedIn("/jobs/:id for a job that is gone says so, and does not crash", async ({ page }, info) => {
    await page.goto(`/jobs/${GONE_ID}`);
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await assertHealthy(page, info, "gone-job");
  });

  signedIn("/messages/:id opens the inbox", async ({ page }, info) => {
    await page.goto(`/messages/${JOB_ID}`);
    await page.waitForURL(/\/messages/, { timeout: 15_000 });
    await assertHealthy(page, info, "messages");
  });

  signedIn("/u/:id opens the profile", async ({ page }, info) => {
    await page.goto(`/u/${POSTER_ID}`);
    await page.waitForURL(new RegExp(`/user/${POSTER_ID}`), { timeout: 15_000 });
    await assertHealthy(page, info, "user");
  });

  for (const tab of ["earnings", "notifications", "reviews", "security", "not-a-real-tab"]) {
    signedIn(`/profile?tab=${tab}`, async ({ page }, info) => {
      await page.goto(`/profile?tab=${tab}`);
      await expect(page).toHaveURL(/\/profile/);
      await assertHealthy(page, info, `profile-${tab}`);
    });
  }
});
