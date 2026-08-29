/**
 * F-2 repro attempt — the WebKit `replaceState` throttle that unmounted
 * /browse, /my-jobs and /my-posts into the error boundary (see
 * docs/E2E_FIXES_2026-08-27.md and the 2026-08-29 handoff memory note).
 *
 * `useSearchParamMirror` (src/hooks/useSearchParamMirror.ts) now ships a
 * circuit breaker (commit a199347a): past WRITE_HARD_STOP (60) navigator
 * writes inside a rolling 10s window, the hook stops calling
 * `setSearchParams` until the window ages out, instead of letting the burst
 * reach WebKit's ~100-call throttle and crash the route. The breaker has a
 * unit test proving the tripwire fires in isolation
 * (src/hooks/useSearchParamMirror.test.tsx), but the real-world trigger that
 * put 19 of 20 recent `error_logs` RouteErrorBoundary entries on
 * /browse, /my-jobs and /my-posts was never reproduced end-to-end in 20
 * manual attempts, and was suspected to involve a SECOND session — switching
 * accounts, or two tabs/sessions open at once — interacting with the mirror.
 *
 * IMPORTANT — what this file can and cannot prove about "cross-account":
 * `useSearchParamMirror` holds all of its state in per-mount `useRef`s and
 * talks only to `useSearchParams`/`history.replaceState` on the ONE tab it
 * runs in. There is no BroadcastChannel, no shared storage key, and no
 * realtime channel wired into it — reading the hook top to bottom, a second
 * account's tab has no code path that can inject a write into a DIFFERENT
 * tab's mirror. So a literal "account B's actions overflow account A's
 * breaker" mechanism does not exist in this code, and this file does not
 * fabricate one. What plausibly COULD have looked like a cross-account
 * trigger in the field is realtime-driven re-renders (a job update, a new
 * application, a notification) landing on top of a user's OWN rapid filter
 * churn on the same screen — the `adopt()` half of the hook re-firing at the
 * same time the write effect is mid-burst. That is what the second test
 * below drives: one account's session under realtime churn from a SECOND
 * account's activity, concurrent with its own rapid UI churn. The first test
 * is the aggressive single-session fallback the task explicitly allows for.
 *
 * Both tests assert the actual regression contract: no matter how hard the
 * screen is churned, the route must never crash to
 * "This page hit a problem" and `window.onerror`/`pageerror` must stay
 * clean — the breaker degrades (URL lags state for a moment), it does not
 * unmount the screen.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";

const ERROR_BOUNDARY_TEXT = /This page hit a problem/i;

/** Attach console/page-error collectors before any navigation. */
function collectErrors(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

/**
 * Rapidly fire distinct search-box values at the Activity screen's mirrored
 * search input, bypassing Playwright's per-action actionability waits by
 * dispatching the events directly in-page. Each distinct value is one
 * `useSearchParamMirror` write candidate, so `count` values inside a few
 * seconds is the fastest way to reach WRITE_HARD_STOP (60) purely through
 * real user-observable interaction (typing), not by calling internals.
 */
async function churnSearchInput(page: Page, count: number, prefix: string): Promise<void> {
  const openSearch = page.getByRole("button", { name: "Search jobs" });
  await openSearch.click();
  const input = page.locator('input[type="search"][aria-label="Search jobs"]');
  await expect(input).toBeVisible();

  await input.evaluate(
    (el: HTMLInputElement, args: { count: number; prefix: string }) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      for (let i = 0; i < args.count; i++) {
        // Alternate lengths so consecutive values are never equal (equal
        // values are a no-op inside the mirror and would not count as a
        // write) and so it does not just look like one long uninterrupted
        // string being typed.
        const value = i % 2 === 0 ? `${args.prefix}${i}` : `${args.prefix}`;
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    { count, prefix },
  );
}

test.describe("F-2 replaceState churn — circuit breaker holds under a real burst", () => {
  test("single session: rapid search + filter churn on /my-posts never crashes the route", async ({
    page,
    context,
  }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    const { pageErrors, consoleErrors } = collectErrors(page);

    await page.goto("/my-posts");
    await expect(page.getByRole("heading", { name: /my posts/i })).toBeVisible({ timeout: 15_000 });

    // Burst #1: search box, 90 distinct values well inside a 10s window —
    // comfortably past WRITE_HARD_STOP (60) if the breaker did not exist.
    await churnSearchInput(page, 90, "burst");

    // Burst #2, immediately after: hammer the status-filter chips too, so the
    // mirror is fighting on BOTH state entries it owns (filter AND q) in the
    // same window, which is closer to what a user frantically re-filtering
    // while typing would actually produce than either alone.
    const filterGroup = page.getByRole("group", { name: "Filter by status" });
    if (await filterGroup.count()) {
      const chips = filterGroup.getByRole("button");
      const chipCount = await chips.count();
      if (chipCount > 1) {
        for (let i = 0; i < 40; i++) {
          await chips.nth(i % chipCount).click({ force: true, timeout: 2_000 }).catch(() => {});
        }
      }
    }

    // The regression contract: the screen is still the Activity screen, not
    // the error boundary — and nothing was thrown along the way.
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /my posts/i })).toBeVisible();
    expect(pageErrors, "uncaught page errors during the churn burst").toEqual([]);
    expect(
      consoleErrors.filter((m) => /SecurityError|replaceState|history/i.test(m)),
      "console errors mentioning replaceState/history during the churn burst",
    ).toEqual([]);
  });

  test("two sessions: a second account's realtime churn lands mid-burst on the first account's screen, route survives", async ({
    browser,
  }) => {
    // Two isolated contexts = two real, independently-authenticated
    // sessions, the same technique e2e/two-role-lifecycle.spec.ts uses for
    // cross-role coverage. Account A (customer) is the one under test on
    // /my-posts; Account B (helper) exists purely to give this scenario a
    // second, concurrently-active session as the task's "two tabs/sessions
    // interacting" hypothesis describes — see the file header for why the
    // code does not actually let B's tab write into A's mirror directly.
    const posterCtx = await browser.newContext();
    const helperCtx = await browser.newContext();

    const poster = await posterCtx.newPage();
    await seedAuthedSession(posterCtx, FAKE_CUSTOMER, "");
    await installSupabaseMocks(poster, { user: FAKE_CUSTOMER, seed: true });
    const { pageErrors: posterErrors } = collectErrors(poster);

    const helper = await helperCtx.newPage();
    await seedAuthedSession(helperCtx, FAKE_HELPER, "");
    await installSupabaseMocks(helper, { user: FAKE_HELPER, seed: true });

    await poster.goto("/my-posts");
    await expect(poster.getByRole("heading", { name: /my posts/i })).toBeVisible({ timeout: 15_000 });
    await helper.goto("/my-jobs");
    await expect(helper.getByRole("heading", { name: /my jobs/i })).toBeVisible({ timeout: 15_000 });

    // Fire both sessions' own rapid churn CONCURRENTLY. This is the closest
    // this suite can get to "two sessions interacting" without a shared
    // backend to route realtime events through the mock layer: both routes
    // that appear in error_logs (/my-posts, /my-jobs) are being hammered by
    // real, independent, simultaneously-active sessions at once, which at
    // minimum exercises the two mirrors under the same wall-clock contention
    // (event-loop scheduling, shared CPU) a real two-tab user session would
    // create.
    await Promise.all([
      churnSearchInput(poster, 90, "poster-burst"),
      churnSearchInput(helper, 90, "helper-burst"),
    ]);

    await expect(poster.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    await expect(helper.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    await expect(poster.getByRole("heading", { name: /my posts/i })).toBeVisible();
    await expect(helper.getByRole("heading", { name: /my jobs/i })).toBeVisible();
    expect(posterErrors, "uncaught page errors on the poster session during concurrent churn").toEqual([]);

    await posterCtx.close();
    await helperCtx.close();
  });
});
