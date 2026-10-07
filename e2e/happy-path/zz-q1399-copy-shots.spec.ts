/** TEMPORARY evidence generator for Q1399 spec 12 (not committed). */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { test, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

const PHASE = process.env.Q1399_PHASE || "after";
const OUT = resolve(homedir(), ".lh-shots", "q1399", PHASE);
mkdirSync(OUT, { recursive: true });

const JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving", budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00", location: "New Orleans, LA", status: "open", payment_status: "escrow",
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(), updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_urgent: false, urgent_fee: 0, is_flexible_schedule: false, is_recurring: false, is_group_job: false, helpers_needed: 1,
  photos: [], expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), helper_id: null, parent_job_id: null,
};

for (const theme of ["light", "dark"] as const) {
  test(`q1399 copy ${PHASE} profile ${theme}`, async ({ helperPage: page }) => {
    test.skip(!process.env.Q1399_PHASE, "evidence generator");
    await page.addInitScript((t) => { localStorage.setItem("helpr-theme", t); localStorage.setItem("push-nudge-dismissed-at", String(Date.now())); }, theme);
    await page.route("**/functions/v1/stripe-connect", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: false, details_submitted: false, payouts_enabled: false }) }));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/profile");
    await page.getByText(/Finish setting up/).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(OUT, `profile-banner-375-${theme}.png`) });
  });
}

test(`q1399 copy ${PHASE} apply notice`, async ({ helperPage: page }) => {
  test.skip(!process.env.Q1399_PHASE, "evidence generator");
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [{ user_id: JOB.customer_id, full_name: "Jane Poster", avatar_url: null }]),
      mockTable("open_jobs_browse", [JOB]),
      mockTable("helper_availability", []), mockTable("applications", []), mockTable("user_blocks", []),
      mockTable("saved_jobs", []), mockTable("saved_searches", []), mockTable("reviews", []),
    ],
  });
  await page.addInitScript(() => { localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true })); localStorage.setItem("push-nudge-dismissed-at", String(Date.now())); });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/home");
  const card = page.getByText(JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  await page.locator('[role="dialog"]').last().getByRole("button", { name: /^(apply now|book now)$/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700);
  const notice = page.locator('[role="dialog"] [role="status"]').last();
  await notice.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.screenshot({ path: resolve(OUT, `apply-notice-375-light.png`) });
});
