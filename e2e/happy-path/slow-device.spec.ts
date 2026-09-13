import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  mockTable,
  mockRpc,
} from "./fixtures";
import { findErrorScreen, detectStuckOrBlank } from "../errorScreens";
import { SEED_JOBS, SEED_MESSAGES } from "./seedData";

/**
 * "SLOW, CHEAP PHONE" (owner, 2026-09-12): every core flow, on the profile a
 * real budget Android or an older iPhone actually gets — CPU throttled 6x
 * and network capped to a slow-4G connection, both applied through the same
 * CDP session `zz-senior-probe.spec.ts` already uses for reduced-transparency
 * emulation (`context.newCDPSession(page)` → `Emulation.setCPUThrottlingRate`
 * / `Network.emulateNetworkConditions`).
 *
 * Two numbers per screen, both with a hard budget:
 *   - time-to-usable: content present, no skeletons/spinners, no error
 *     screen. Budget 8s (fails via `findErrorScreen`/`detectStuckOrBlank`,
 *     the ONE shared list every harness in this repo uses).
 *   - tap responsiveness: elapsed time from a click to the first visible DOM
 *     change (a disabled/aria-busy/class flip, a spinner, new content).
 *     Budget 300ms.
 * Plus: a submit control must not be double-fireable while its own request
 * is still in flight, and no error screen may appear anywhere in the run.
 *
 * Runs against the same mocked-Supabase happy-path harness as the rest of
 * this directory — the throttling is real (CDP), the backend is not.
 */

// Chrome DevTools' "Slow 4G" preset (also Lighthouse's mobile default):
// ~1.6 Mbps down / 750 Kbps up, 150ms RTT. Values in bytes/sec + ms.
const SLOW_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
} as const;

const CPU_SLOWDOWN_RATE = 6;

const TIME_TO_USABLE_BUDGET_MS = 8_000;
const TAP_FEEDBACK_BUDGET_MS = 300;

interface ScreenResult {
  screen: string;
  timeToUsableMs: number;
  tapFeedbackMs: number | null;
}

const RESULTS: ScreenResult[] = [];

async function throttle(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", SLOW_4G);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN_RATE });
}

/**
 * Poll until the page is "usable" (real content, no skeleton, no error) or
 * the budget expires. Throws with a screen-scoped message either way it
 * fails, so a report failure names the screen it happened on.
 */
async function measureTimeToUsable(page: Page, screen: string): Promise<number> {
  const start = Date.now();
  let lastStuck: string | null = "no successful check yet";
  while (Date.now() - start < TIME_TO_USABLE_BUDGET_MS) {
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    const err = findErrorScreen(bodyText);
    if (err) {
      throw new Error(`${screen}: error screen appeared — [${err.name}] "${err.excerpt}"`);
    }
    lastStuck = await page.evaluate(detectStuckOrBlank);
    if (!lastStuck) return Date.now() - start;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `${screen}: not usable within ${TIME_TO_USABLE_BUDGET_MS}ms on slow-4G (last state: ${lastStuck})`,
  );
}

/**
 * Elapsed time from `act()` (assumed to fire the tap) to the first visible
 * DOM mutation anywhere on the page — a pressed/disabled state, a spinner
 * mounting, new content. A MutationObserver is the most generic definition
 * of "the tap showed feedback" that doesn't assume any one component's
 * loading-state convention.
 */
async function measureTapFeedback(page: Page, act: () => Promise<void>): Promise<number | null> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__tapFeedbackAt = null;
    const obs = new MutationObserver(() => {
      if (w.__tapFeedbackAt == null) w.__tapFeedbackAt = performance.now();
    });
    obs.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "aria-busy", "disabled", "aria-pressed", "style", "data-state"],
    });
    w.__tapObserver = obs;
    w.__tapStartAt = performance.now();
  });

  await act();

  await page
    .waitForFunction(() => (window as unknown as Record<string, unknown>).__tapFeedbackAt != null, undefined, {
      timeout: 2_000,
    })
    .catch(() => {
      /* handled below — null elapsed means "no feedback observed" */
    });

  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    (w.__tapObserver as MutationObserver | undefined)?.disconnect();
    const start = w.__tapStartAt as number | undefined;
    const at = w.__tapFeedbackAt as number | undefined;
    return start != null && at != null ? at - start : null;
  });
}

function record(screen: string, timeToUsableMs: number, tapFeedbackMs: number | null) {
  RESULTS.push({ screen, timeToUsableMs, tapFeedbackMs });
}

test.afterAll(() => {
   
  // per-screen number report; console is the channel the runner shows it on.
  console.log(
    "\n[slow-device] time-to-usable / tap-feedback on slow-4G + CPU×6:\n" +
      RESULTS.map(
        (r) =>
          `  ${r.screen.padEnd(28)} usable=${r.timeToUsableMs}ms  tap=${
            r.tapFeedbackMs == null ? "n/a" : `${Math.round(r.tapFeedbackMs)}ms`
          }`,
      ).join("\n"),
  );
});

const OPEN_JOB = {
  id: "44444444-4444-4444-8444-444444444444",
  customer_id: "55555555-5555-4555-8555-555555555555",
  title: "Slow-device probe: fix a leaky faucet",
  description: "Kitchen faucet drips constantly. Parts on hand.",
  category: "handyman",
  budget: 90,
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

const POSTER_PROFILE = {
  user_id: OPEN_JOB.customer_id,
  full_name: "Slow Device Poster",
  avatar_url: null,
  subscription_tier: "free",
  subscription_expires_at: null,
};

test.describe("slow, cheap phone — happy-path screens under real throttle", () => {
  test.slow(); // CPU×6 + slow-4G triples wall-clock; give this file its own budget.

  test("dashboard: time-to-usable + tap feedback on a job card", async ({ helperPage: page }) => {
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
    await throttle(page);

    await page.goto("/dashboard");
    // Screenshot mid-load — before the throttled network/CPU has let the
    // feed paint — so a skeleton (if any) is caught looking intentional.
    await page.screenshot({ path: "test-results/slow-device/dashboard-mid-load.png" }).catch(() => {});

    const timeToUsable = await measureTimeToUsable(page, "dashboard");
    await expect(page.getByText(OPEN_JOB.title)).toBeVisible();
    await page.screenshot({ path: "test-results/slow-device/dashboard-usable.png" }).catch(() => {});

    const card = page.getByText(OPEN_JOB.title);
    const tapFeedback = await measureTapFeedback(page, () => card.click());

    record("dashboard", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    expect(tapFeedback, "tap on job card produced no visible feedback within budget").not.toBeNull();
    expect(tapFeedback ?? Infinity).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
  });

  test("browse and filter: time-to-usable + tap feedback on a filter control", async ({ helperPage: page }) => {
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
    await throttle(page);

    await page.goto("/dashboard");
    const timeToUsable = await measureTimeToUsable(page, "browse-and-filter");
    await expect(page.getByText(OPEN_JOB.title)).toBeVisible();

    // Any control that narrows the feed — a category chip, a search box, a
    // sort/filter button. Match broadly since the exact control is a
    // product-owned surface, not something this spec should hard-pin.
    const filterControl = page
      .getByRole("button", { name: /filter|categor|sort|search/i })
      .first();
    let tapFeedback: number | null = null;
    if (await filterControl.isVisible().catch(() => false)) {
      tapFeedback = await measureTapFeedback(page, () => filterControl.click());
    }

    record("browse-and-filter", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    if (tapFeedback != null) {
      expect(tapFeedback).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
    }
  });

  test("job detail: opening the dialog is usable within budget, with tap feedback", async ({ helperPage: page }) => {
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
    await throttle(page);

    await page.goto("/dashboard");
    await measureTimeToUsable(page, "dashboard (pre-detail)");
    const card = page.getByText(OPEN_JOB.title);
    await card.waitFor();

    const start = Date.now();
    const tapFeedback = await measureTapFeedback(page, () => card.click());
    const applyBtn = page.getByRole("button", { name: /^(apply|continue|book)\b/i }).first();
    await expect(applyBtn).toBeVisible({ timeout: TIME_TO_USABLE_BUDGET_MS });
    const timeToUsable = Date.now() - start;

    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    expect(findErrorScreen(bodyText)).toBeNull();

    record("job-detail", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    expect(tapFeedback, "opening the job dialog produced no visible feedback within budget").not.toBeNull();
    expect(tapFeedback ?? Infinity).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
  });

  test("apply: tap feedback on Apply, and the button cannot be double-fired mid-flight", async ({
    helperPage: page,
  }) => {
    let applicationPosts = 0;
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
    await throttle(page);

    // Count writes to `applications` regardless of the mock's own response —
    // the assertion is about how many requests the CLIENT fired, not what
    // the mock answered.
    await page.route("**/rest/v1/applications*", async (route) => {
      if (route.request().method() === "POST") applicationPosts += 1;
      // Deliberately slow (throttled network already adds latency, this
      // makes the in-flight window long enough to reliably double-click
      // into) — respond after a short delay so a second click during the
      // first request's flight is actually exercised.
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 201, body: JSON.stringify([{ id: "app-1" }]) });
    });

    await page.goto("/dashboard");
    await measureTimeToUsable(page, "dashboard (pre-apply)");
    const card = page.getByText(OPEN_JOB.title);
    await card.click();

    const applyBtn = page.getByRole("button", { name: /^(apply|continue|book)\b/i }).first();
    await expect(applyBtn).toBeVisible({ timeout: TIME_TO_USABLE_BUDGET_MS });

    const tapFeedback = await measureTapFeedback(page, () => applyBtn.click());

    // Immediately fire a second click at the same target while the first
    // request is presumed in flight (300ms artificial delay above, plus
    // slow-4G latency). A correctly-guarded submit either disables the
    // control or ignores the second tap; either way exactly one write
    // should reach the network — never two.
    await applyBtn.click({ force: true }).catch(() => {
      /* button may already be disabled/gone by the time this fires —
         that IS the guard working, not a test failure */
    });
    await page.waitForTimeout(1_000);

    record("apply", 0, tapFeedback);
    expect(tapFeedback, "Apply produced no visible feedback within budget").not.toBeNull();
    expect(tapFeedback ?? Infinity).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
    expect(
      applicationPosts,
      `Apply fired ${applicationPosts} POSTs to /applications from two rapid taps — a double-fire`,
    ).toBeLessThanOrEqual(1);
  });

  test("post a job: entry landing is usable, Start fresh gives tap feedback", async ({ customerPage: page }) => {
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockTable("jobs", []),
      ],
    });
    await throttle(page);

    await page.goto("/post-job");
    await page.screenshot({ path: "test-results/slow-device/post-job-mid-load.png" }).catch(() => {});

    const timeToUsable = await measureTimeToUsable(page, "post-job");
    const heading = page.getByRole("heading", { name: /post a job/i });
    await expect(heading).toBeVisible();
    await page.screenshot({ path: "test-results/slow-device/post-job-usable.png" }).catch(() => {});

    const startFresh = page.getByRole("button", { name: /start fresh/i });
    const tapFeedback = await measureTapFeedback(page, () => startFresh.click());
    await expect(page.getByRole("heading", { name: /job details/i })).toBeVisible({
      timeout: TIME_TO_USABLE_BUDGET_MS,
    });

    record("post-job", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    expect(tapFeedback, "Start fresh produced no visible feedback within budget").not.toBeNull();
    expect(tapFeedback ?? Infinity).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
  });

  test("messages: list is usable, opening a thread gives tap feedback", async ({ customerPage: page }) => {
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await throttle(page);

    await page.goto("/messages");
    const timeToUsable = await measureTimeToUsable(page, "messages");
    expect(SEED_MESSAGES.length).toBeGreaterThan(0);

    const row = page
      .locator("button")
      .filter({ hasText: SEED_JOBS[1].title.slice(0, 40) })
      .first();
    await row.waitFor({ timeout: TIME_TO_USABLE_BUDGET_MS });

    const tapFeedback = await measureTapFeedback(page, () => row.click());
    await expect(page.locator(".glass-dock")).toBeVisible({ timeout: TIME_TO_USABLE_BUDGET_MS });

    record("messages", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    expect(tapFeedback, "opening a thread produced no visible feedback within budget").not.toBeNull();
    expect(tapFeedback ?? Infinity).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
  });

  test("profile tabs: landing is usable, switching tabs gives tap feedback", async ({ customerPage: page }) => {
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await throttle(page);

    await page.goto("/profile");
    const timeToUsable = await measureTimeToUsable(page, "profile");

    const tabLink = page.getByRole("link", { name: /earnings|settings|payment/i }).first();
    const tabButton = page.getByRole("button", { name: /earnings|settings|payment/i }).first();
    const target = (await tabLink.isVisible().catch(() => false)) ? tabLink : tabButton;

    let tapFeedback: number | null = null;
    if (await target.isVisible().catch(() => false)) {
      tapFeedback = await measureTapFeedback(page, () => target.click());
    }

    record("profile-tabs", timeToUsable, tapFeedback);
    expect(timeToUsable).toBeLessThan(TIME_TO_USABLE_BUDGET_MS);
    if (tapFeedback != null) {
      expect(tapFeedback).toBeLessThan(TAP_FEEDBACK_BUDGET_MS);
    }

    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    expect(findErrorScreen(bodyText)).toBeNull();
  });
});
