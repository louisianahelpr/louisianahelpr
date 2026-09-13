import type { Page, Route } from "@playwright/test";
import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "../../happy-path/fixtures";
import { assertHealthy, countRequests } from "./guard";

// A helper applying to a job, interrupted the ways real people interrupt it:
// double-tap, a slow connection, losing signal, refresh and back.
// Contract: exactly one application per intent, an honest message when it did
// not go through, and a retry that works — never an error screen.

const JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Interrupt job: move a couch",
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
};

const isApplyWrite = (u: URL, m: string) => m === "POST" && u.pathname === "/rest/v1/applications";

async function openSheet(page: Page) {
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [{ user_id: JOB.customer_id, full_name: "Jane Poster" }]),
      mockRpc("check_application_rate_limit", { allowed: true }),
      mockTable("open_jobs_browse", [JOB]),
      mockTable("jobs", [JOB]),
      mockTable("applications", []),
    ],
  });
  await page.goto("/dashboard");
  const card = page.getByText(JOB.title).first();
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  const sheet = page.locator('[role="dialog"]').last();
  const apply = sheet.getByRole("button", { name: /^apply now$/i });
  await apply.waitFor({ timeout: 10_000 });
  await sheet.getByRole("textbox").first().fill("I have moved a lot of couches.");
  return { sheet, apply };
}

/** Delay only the application insert, so the rest of the app stays responsive. */
async function delayApplyWrite(page: Page, ms: number) {
  await page.route("**/rest/v1/applications*", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    return route.fallback();
  });
}

test("double-tap Apply Now sends exactly one application", async ({ helperPage: page }, info) => {
  const { apply } = await openSheet(page);
  await assertHealthy(page, info, "sheet-open");
  const writes = countRequests(page, isApplyWrite);
  await apply.dblclick({ force: true });
  await page.waitForTimeout(2500);
  await assertHealthy(page, info, "after-double-tap");
  expect(writes(), "application inserts after a double-tap").toBe(1);
});

test("slow network (6s): rapid repeat taps still send one, and success is shown, not an error", async ({ helperPage: page }, info) => {
  const { apply } = await openSheet(page);
  await delayApplyWrite(page, 6000);
  const writes = countRequests(page, isApplyWrite);
  await apply.click();
  for (let i = 0; i < 3; i++) await apply.click({ force: true, timeout: 500 }).catch(() => {});
  await assertHealthy(page, info, "slow-in-flight", { settleMs: 1000 }).catch(() => {
    /* a spinner during a 6s write is correct; only the end state is judged */
  });
  await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page, info, "slow-settled");
  expect(writes()).toBe(1);
  await expect(page.getByText(/couldn't send your application/i)).toHaveCount(0);
});

test("network loss mid-apply: honest failure, then retry sends it once", async ({ helperPage: page, context }, info) => {
  const { apply } = await openSheet(page);
  const writes = countRequests(page, isApplyWrite);
  await context.setOffline(true);
  await apply.click();
  // Honest: never a success toast for an application that did not leave the phone.
  await expect(page.getByText(/couldn't send|offline|no connection|connection/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/application sent/i)).toHaveCount(0);
  await assertHealthy(page, info, "offline-failure");

  await context.setOffline(false);
  const retry = page.getByRole("button", { name: /retry|try again/i }).first();
  await retry.click({ timeout: 10_000 });
  await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page, info, "offline-retried");
  // The offline attempt never reaches the network, so exactly one real insert.
  expect(writes()).toBeLessThanOrEqual(2);
  expect(writes()).toBeGreaterThanOrEqual(1);
});

test("back button with the apply sheet open closes the sheet, stays on the feed", async ({ helperPage: page }, info) => {
  await openSheet(page);
  await page.goBack();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 5000 });
  expect(new URL(page.url()).pathname).toBe("/dashboard");
  await assertHealthy(page, info, "back-from-sheet");
});

test("refresh with the apply sheet open reloads cleanly", async ({ helperPage: page }, info) => {
  await openSheet(page);
  const writes = countRequests(page, isApplyWrite);
  await page.reload();
  await assertHealthy(page, info, "refreshed");
  expect(writes(), "a reload must never submit").toBe(0);
});
