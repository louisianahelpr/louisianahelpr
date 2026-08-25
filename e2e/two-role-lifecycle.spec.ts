import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Two-role lifecycle E2E — the gap payment-lifecycle.spec.ts documents
// ("accept → in_progress → complete needs a SECOND account plus seeded job
// state; out of scope for a single-browser run"). It is NOT out of scope for
// two browser contexts: Playwright gives each context isolated storage, so a
// poster session and a helper session run side by side in one test — the
// exact technique of the 2026-08-24 manual audit (which caught, live: the
// day-of confirm 403, the tracker's ungated Done, and the fee-preview race).
//
// GATED, not skipped-silently: this spec drives REAL backend state, so it
// only runs when the operator provides a seeded stage via env:
//
//   PLAYWRIGHT_TWO_ROLE=1
//   PLAYWRIGHT_POSTER_SESSION / PLAYWRIGHT_HELPER_SESSION
//       — JSON supabase session objects (access+refresh token, user), seeded
//         into localStorage. Mint the helper's with
//         scripts/e2e/mint-helper-login.sh; see scripts/e2e/README.md.
//   PLAYWRIGHT_LIFECYCLE_JOB_ID
//       — an ACCEPTED job between those two accounts, scheduled today with a
//         start_time 2–24h out (so the day-of window is open and the T-2h
//         action gate is closed → this spec asserts the gate, then moves the
//         clock's side of the bargain by asserting the day-of confirm).
//
// What it asserts, cross-role:
//   1. Helper sees the day-before "Still on?" card and confirms — the write
//      must SUCCEED (regression: the column-whitelist 403 of 2026-08-24).
//   2. Poster's card reflects the mutual confirm (tracker reaches Confirmed)
//      without a reload — the realtime channel is part of the contract.
//   3. The tracker's next action is gated until T-2h ("Actions unlock at…").
//
// The money legs (fund → approve → payout) stay in src/test/edge/ unit tests
// plus the operator-run sandbox procedure in scripts/e2e/ — a CI browser must
// never hold a Stripe key.

const RUN = process.env.PLAYWRIGHT_TWO_ROLE === "1";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080";
const STORAGE_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";

async function seededPage(ctx: BrowserContext, sessionJson: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, sessionJson] as const,
  );
  return page;
}

test.describe("two-role lifecycle", () => {
  test.skip(!RUN, "set PLAYWRIGHT_TWO_ROLE=1 with seeded sessions + job (see scripts/e2e/README.md)");

  test("day-of confirm crosses roles and the action gate holds", async ({ browser }) => {
    const posterSession = process.env.PLAYWRIGHT_POSTER_SESSION!;
    const helperSession = process.env.PLAYWRIGHT_HELPER_SESSION!;
    const jobId = process.env.PLAYWRIGHT_LIFECYCLE_JOB_ID!;
    expect(posterSession && helperSession && jobId, "all three env inputs are required").toBeTruthy();

    const posterCtx = await browser.newContext();
    const helperCtx = await browser.newContext();
    const poster = await seededPage(posterCtx, posterSession);
    const helper = await seededPage(helperCtx, helperSession);

    // ── Helper: find the job, answer the day-before question ──
    await helper.goto(BASE + "/my-jobs");
    const stillOn = helper.getByRole("button", { name: /I'm Still On/i });
    await expect(stillOn, "day-of confirm card must be visible inside the 24h window").toBeVisible({ timeout: 15_000 });
    await stillOn.click();
    await helper.getByRole("button", { name: /Yes, I Confirm/i }).click();
    // The 2026-08-24 regression surfaced here: the write 403'd and the chip
    // stayed Pending. Assert the SUCCESS state, not just dialog closure.
    await expect(helper.getByText(/You:\s*Confirmed/i)).toBeVisible({ timeout: 15_000 });

    // ── Poster: sees the mutual confirm without reloading ──
    await poster.goto(BASE + "/my-posts");
    await expect(
      poster.getByText(/Confirmed/i).first(),
      "poster's tracker must reflect the helper's confirm (realtime)",
    ).toBeVisible({ timeout: 20_000 });

    // ── Helper: the next tracker action stays gated until T-2h ──
    await expect(
      helper.getByText(/Actions unlock at|Actions available on/i),
      "tracker actions must be time-gated before T-2h",
    ).toBeVisible({ timeout: 15_000 });

    await posterCtx.close();
    await helperCtx.close();
  });
});
