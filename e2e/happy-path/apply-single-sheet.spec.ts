import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// APPLYING HAPPENS ON ONE SURFACE, ANCHORED TO ONE EDGE.
//
// Owner, 2026-08-28: "I don't like how one opens at the bottom then the next is
// in the middle." Tapping Apply used to close the job-detail bottom sheet and
// open ApplyConfirmDialog — a CENTRED AlertDialog — so one continuous act
// played as three motions across two anchors: the sheet dropped away, the
// screen went bare, and a card faded in mid-viewport.
//
// The apply UI is now the second STEP of the detail sheet itself. This spec
// pins the three properties that make that true, all of which a screenshot
// diff would miss:
//
//   1. No second dialog is created — the same element stays mounted.
//   2. The surface never leaves the bottom edge.
//   3. Back returns to the job, rather than out of the sheet entirely.

const BASE_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  // Must not be FAKE_HELPER.id or the feed filters the card out as "your own job".
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "paid",
  // Older than the 20-minute free-tier "early access" delay, or the feed hides it.
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
  user_id: BASE_JOB.customer_id,
  full_name: "Jane Poster",
  subscription_tier: "free",
  subscription_expires_at: null,
};

test("applying stays on ONE bottom-anchored sheet", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [POSTER_PROFILE]),
      mockTable("open_jobs_browse", [BASE_JOB]),
      mockTable("helper_availability", []),
      mockTable("applications", []),
      mockTable("user_blocks", []),
      mockTable("saved_jobs", []),
      mockTable("saved_searches", []),
      mockTable("reviews", []),
    ],
  });
  // The onboarding tour renders a modal over the feed and swallows the taps
  // that open the job detail sheet.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard");

  const card = page.getByText(BASE_JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();

  const sheet = page.locator('[role="dialog"]').last();
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const rectOf = async () => await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), vh: window.innerHeight };
  });

  // DETAIL STEP — the sheet is anchored to the bottom edge.
  const detailRect = await rectOf();
  expect(detailRect.bottom).toBeCloseTo(detailRect.vh, 0);
  // The apply step's own submit button is not on screen yet.
  await expect(sheet.getByRole("button", { name: /^back to job$/i })).toHaveCount(0);

  const applyBtn = sheet.getByRole("button", { name: /^(apply|book|continue)\b/i }).first();
  await applyBtn.click();
  await sheet.getByRole("button", { name: /^back to job$/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  // 1. NO SECOND SURFACE. Exactly one dialog is open — the apply UI is a step
  //    of this one, not a modal stacked over it.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(1);

  // 2. STILL ANCHORED TO THE BOTTOM. This is the regression that started it:
  //    the replaced AlertDialog was vertically centred, so its bottom sat
  //    hundreds of pixels above the viewport floor.
  const applyRect = await rectOf();
  expect(applyRect.bottom).toBeCloseTo(applyRect.vh, 0);

  // 3. The apply step really is showing.
  await expect(sheet.getByRole("button", { name: /^(apply now|book now)$/i })).toBeVisible();
  await expect(sheet.getByText("You earn")).toBeVisible();

  // 4. BACK GOES TO THE JOB, not out of the sheet.
  await sheet.getByRole("button", { name: /^back to job$/i }).click();
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^back to job$/i })).toHaveCount(0);
  await expect(sheet.getByText(BASE_JOB.description)).toBeVisible();
});

test("dismissing from the apply step abandons the apply", async ({ helperPage: page }) => {
  // The pending-apply id outlives the sheet unless the close handler clears
  // it, and the standalone deep-link sheet renders on exactly that id — so a
  // stale one pops the apply form straight back up over the bare feed.
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [POSTER_PROFILE]),
      mockTable("open_jobs_browse", [BASE_JOB]),
      mockTable("helper_availability", []),
      mockTable("applications", []),
      mockTable("user_blocks", []),
      mockTable("saved_jobs", []),
      mockTable("saved_searches", []),
      mockTable("reviews", []),
    ],
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard");

  const card = page.getByText(BASE_JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  await sheet.getByRole("button", { name: /^(apply|book|continue)\b/i }).first().click();
  await sheet.getByRole("button", { name: /^back to job$/i }).waitFor({ timeout: 10_000 });

  await sheet.getByRole("button", { name: /^close$/i }).click();
  await page.waitForTimeout(800);

  // Nothing is left on screen — no sheet, and crucially no resurrected
  // standalone apply form.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(0);
  await expect(page.getByRole("button", { name: /^apply now$/i })).toHaveCount(0);
});
