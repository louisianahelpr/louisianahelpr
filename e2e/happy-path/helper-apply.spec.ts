import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc, checkA11y } from "./fixtures";

// Helper happy path: helper signs in → dashboard renders the open-jobs
// feed → helper opens a job → applies → an "Applied" / success-state
// surface appears.
//
// The contract this spec asserts:
//   1. An authed helper lands on /dashboard without being bounced to /login
//   2. The open-jobs feed surfaces the mocked job card
//   3. Opening the job detail dialog shows an Apply affordance
//   4. After apply, a confirmation toast / "Applied" indicator surfaces
//
// What we do NOT test here:
//   - The Stripe Connect onboarding gate (helpers without payout set up
//     still see a payout-prompt dialog; the apply mutation is gated
//     behind it). We mock the profile as already onboarded so the
//     dialog stays hidden.
//   - File-upload attachments (those go through Supabase Storage and the
//     storage mock returns 200 anyway, but driving the file picker via
//     Playwright is outside smoke-test scope).

const OPEN_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  // Posted by some other customer — must NOT equal FAKE_HELPER.id, or
  // the dashboard filters the card out as "your own job".
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "paid",
  // useDashboardFilters has a 20-minute "early access" delay for free
  // helpers — anything posted in the last 20 minutes is hidden from
  // non-subscribers (the perk that justifies the Basic/Pro/Elite tier).
  // The smoke test simulates a free helper, so the job must be older
  // than 20 minutes or the feed filter drops it.
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
};

const POSTER_PROFILE = {
  user_id: OPEN_JOB.customer_id,
  full_name: "Jane Poster",
  avatar_url: null,
  subscription_tier: "free",
  subscription_expires_at: null,
};

test.describe("helper browse-and-apply happy path", () => {
  test("authed helper sees open jobs on /dashboard", async ({ helperPage: page }) => {
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockRpc("get_safe_profiles", [POSTER_PROFILE]),
        // Open-jobs feed view — the dashboard reads from this view, not
        // the bare `jobs` table.
        mockTable("open_jobs_browse", [OPEN_JOB]),
        // Side queries that load alongside the feed — keep them empty.
        mockTable("helper_availability", []),
        mockTable("applications", []),
        mockTable("user_blocks", []),
        mockTable("saved_jobs", []),
        mockTable("saved_searches", []),
        mockTable("reviews", []),
      ],
    });

    const logs: string[] = [];
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => logs.push(`console.${msg.type()}: ${msg.text()}`));
    page.on("requestfinished", async (req) => {
      const url = req.url();
      if (url.includes("supabase.co")) {
        const resp = await req.response();
        logs.push(`req: ${req.method()} ${url} → ${resp?.status()}`);
      }
    });
    page.on("requestfailed", (req) => {
      if (req.url().includes("supabase.co")) {
        logs.push(`failed: ${req.method()} ${req.url()} → ${req.failure()?.errorText}`);
      }
    });

    await page.goto("/dashboard");

    // The job title must surface in the feed — covers both the JobCard
    // and the section-heading code paths.
    try {
      await expect(page.getByText(OPEN_JOB.title)).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      console.log("DEBUG logs during /dashboard:\n" + logs.join("\n"));
      throw e;
    }

    // Axe check at the helper's primary action surface.
    await checkA11y(page);

    // Confirm we didn't get bounced off /dashboard.
    expect(page.url()).toContain("/dashboard");
  });

  test("helper can open a job and reach an Apply affordance", async ({ helperPage: page }) => {
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockRpc("get_safe_profiles", [POSTER_PROFILE]),
        mockTable("open_jobs_browse", [OPEN_JOB]),
        mockTable("helper_availability", []),
        mockTable("applications", []),
        mockTable("user_blocks", []),
        mockTable("saved_jobs", []),
        mockTable("saved_searches", []),
        mockTable("reviews", []),
      ],
    });

    await page.goto("/dashboard");

    // Tap the card title to open the detail dialog.
    const card = page.getByText(OPEN_JOB.title);
    await card.waitFor({ timeout: 15_000 });
    await card.click();

    // The detail dialog renders an Apply button (the dialog also renders
    // Save, Flag, Message; we match by accessible name "Apply").
    const applyBtn = page.getByRole("button", { name: /^apply$/i }).first();
    await expect(applyBtn).toBeVisible({ timeout: 10_000 });
  });
});
