import { test, expect, type BrowserContext, type Page } from "./prodTest";

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
/* Same defaults as e2e/journeys/fixtures.ts, restated rather than imported: this
   spec is in the `chromium` project and that module pulls the journeys fixture
   chain with it. */
const SUPABASE_URL = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";

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

    /* ── Helper: find the job, answer the day-before question ──
       DEEP-LINKED BY JOB ID, not just "/my-jobs". The page opens on its default
       tab — "Needs You" — and a confirmed booking whose day is still ahead sits
       under "Scheduled", so this looked for the button on a tab that could
       never show it. Diagnosed from the failure screenshot: Needs You 11,
       Waiting 4, Scheduled 8, and the seeded job in the third of those.
       `?job=` is the app's own highlight link (the one every notification
       uses), so product code brings the card into view rather than this spec
       guessing a tab name or scrolling a list whose shape it would have to
       know. Same technique as prod-lifecycle.spec.ts. */
    await helper.goto(BASE + `/my-jobs?job=${jobId}`);
    /* EXPAND THE CARD. The collapsed card carries only its status strip — the
       screenshot showed the seeded job first under Scheduled, reading
       "You're confirmed", with no control on it at all. `JobConfirmation`
       (and so "I'm Still On") renders in the EXPANDED body, so the deep link
       gets the reader to the card and this opens it.
       Clicked by the card's own title rather than anywhere on the card: a tap
       on the body can hit the location chip, which is its own defect the owner
       reported the same day. */
    const card = helper.locator("div.liquid-glass").filter({ hasText: "[E2E DO NOT ACCEPT]" }).first();
    await expect(card, `the helper's Scheduled tab never rendered job ${jobId}`).toBeVisible({
      timeout: 30_000,
    });
    await card.getByRole("heading").first().click();
    const stillOn = helper.getByRole("button", { name: /I'm Still On/i });
    await expect(stillOn, "day-of confirm card must be visible inside the 24h window").toBeVisible({ timeout: 15_000 });
    await stillOn.click();
    await helper.getByRole("button", { name: /Yes, I Confirm/i }).click();
    /* THE SUCCESS STATE FOR A HELPER IS THE CONTROL LEAVING, and asserting
       "You: Confirmed" here could never have passed.
       That chip lives in JobConfirmation's STANDALONE-CARD variant. The Helpr's
       control portals into their step card's single action row instead (the
       component says so: a permanent inert box would occupy the primary slot
       the tracker's own next-step CTA needs), and in that variant `rowCta`
       becomes `null` once confirmed — the labelled "Confirmed" button is
       `isOwner` only. So the Helpr sees the control go, not a chip arrive.
       This spec had never executed in any environment, so nobody found that.
       PROVEN POSITIVE, not just absent: the write is read back from the row
       itself. A control that vanished because the write 403'd — the 2026-08-24
       regression this spec exists for — leaves the stamp NULL, so the stamp is
       what the assertion rests on, and the disappearance is the corroboration
       rather than the proof. */
    await expect(stillOn, "the day-of control should leave once it is answered").toBeHidden({
      timeout: 15_000,
    });
    const stamped = await helper.evaluate(
      async ([url, anon, id]) => {
        const raw = localStorage.getItem("sb-fncmgoasalhdgfwzhsqa-auth-token");
        const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : "";
        const r = await fetch(`${url}/rest/v1/jobs?id=eq.${id}&select=helper_dayof_confirmed_at`, {
          headers: { apikey: anon, Authorization: `Bearer ${token}` },
        });
        return (await r.json()) as { helper_dayof_confirmed_at: string | null }[];
      },
      [SUPABASE_URL, SUPABASE_ANON, jobId] as const,
    );
    expect(
      stamped[0]?.helper_dayof_confirmed_at,
      "the day-of confirm did not land — this is the 403 regression of 2026-08-24, " +
        "not a rendering problem",
    ).toBeTruthy();

    // ── Poster: sees the mutual confirm without reloading ──
    await poster.goto(BASE + `/my-posts?job=${jobId}`);
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

// SHOWN ABLE TO FAIL 2026-09-22 — by hand, because the gate cannot stage it.
//
// @mutate-exempt Needs PLAYWRIGHT_TWO_ROLE=1 plus two minted SESSIONS and a job in a specific lifecycle state, which the vacuity gate cannot supply: sessions expire in an hour and the job id is fixture-specific, so a registered mutation would return SURVIVED for an environment reason and convict a working spec. SHOWN ABLE TO FAIL INSTEAD, 2026-09-22, by re-introducing the exact regression this spec was written for — JobConfirmation's `const field = isOwner ? "poster_confirmed_at" : "helper_dayof_confirmed_at"` changed back to `helper_confirmed_at` (the 2026-08-24 bug: that column is stamped at ACCEPT time, possibly days early, so re-writing it makes the day-of card a no-op). RED with the mutation, GREEN without, source restored and `git status` verified clean. Until 2026-09-22 this spec had NEVER executed in any environment — `skipped` in every scheduled run from 2026-09-13 — and running it found FOUR stale preconditions, every one of which read like a product bug: it cleared the wrong column, navigated to a tab that cannot show the card, left the card collapsed when the control is in the expanded body, and asserted "You: Confirmed", a chip that exists only in the POSTER's variant (the Helpr's control portals into their step row, where it becomes null once confirmed). REPRODUCIBLE STAGE, so the next person need not rediscover it: mint both sessions with `node scripts/test-signin-link.mjs <poster|helper>-e2e --session --json` and read `.value`; take a seed job that is `accepted`/`escrow` between the two test accounts, set `date_needed`/`start_time` 2–24h out, `helper_confirmed_at` NOT NULL, and `helper_dayof_confirmed_at` NULL. What would close the exemption is CI holding a seeded stage, not a mutation.
