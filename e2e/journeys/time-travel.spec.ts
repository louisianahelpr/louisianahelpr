import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  SUPABASE_URL,
  E2E_TITLE_MARKER,
  assertHealthy,
  getSession,
  newUserContext,
  payCheckoutUrlInChromium,
  rest,
  sessionsAvailable,
  skipUncovered,
  stripeModeFromCheckoutUrl,
  type Session,
} from "./fixtures";
import { skipLivePay } from "../prod-audit/fundedOpenJob";
import { fitJobTitle } from "../../scripts/lib/jobTextBounds.mjs";
import { serviceKey } from "./throwaway";
import { srFetch } from "../serviceRoleFetch";

/**
 * TIME TRAVEL — what a real user sees days later, on the deployed app and the
 * real backend, with only the BROWSER's clock moved (page.clock). The server's
 * clock is not moved and cannot be: anything the backend decides on time (the
 * crons) is covered at its boundaries by unit tests and the PGlite probe
 * scripts/probes/offer-expiry.probe.mjs — see docs/audit/time-inventory.md.
 *
 * Every boundary is walked BEFORE / AT / AFTER, in Louisiana's own zone AND
 * from a viewer in another zone, including both DST switch nights, and every
 * step runs the error-screen and stuck-or-blank checks.
 *
 * Data: the shared E2E poster account. The only rows this creates are unfunded
 * jobs carrying E2E_TITLE_MARKER, parish null (no fan-out) — deleted in cleanup
 * under `Customers can delete their own jobs`, and swept by
 * scripts/e2e/prod-lifecycle-sweeper.mjs if a run dies first.
 *
 * ONE session per run, shared by every context: minting is a magic link and
 * GoTrue answers 429 after a couple of dozen. Sharing is safe only because the
 * stored expiry is restated against the moved clock (see openAt), so no
 * context ever refreshes — a refresh rotates the token under the others.
 */

const CT = "America/Chicago";
const PT = "America/Los_Angeles";

/**
 * A wall-clock time in Louisiana, as an absolute instant. Written out here on
 * purpose rather than imported from the app's resolver: a spec that computes
 * its expectation with the code under test agrees with that code by
 * construction. Two passes, so the offset is the one in force AT the instant.
 */
function ct(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: CT, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}

function centralDate(offsetDays: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CT, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}

async function openAt(
  browser: import("@playwright/test").Browser,
  api: APIRequestContext,
  timezoneId: string,
  at: Date,
  role: "poster" | "helper" = "poster",
): Promise<{ ctx: BrowserContext; page: Page; session: Session }> {
  const minted = await getSession(api, role);
  // supabase-js decides whether to refresh from the STORED `expires_at`, read
  // against the browser clock. With that clock days ahead it refreshes on load
  // and again on its ticker, and two overlapping refreshes of one rotating
  // token signed the context out on 2 of 3 runs ("That page needs an account").
  // That is the harness, not the app: restate the expiry relative to the moved
  // clock. The server still validates the JWT's real `exp`, which is an hour
  // of real time, far longer than a step.
  const session = { ...minted, expires_at: Math.floor(at.getTime() / 1000) + 3600 };
  const ctx = await newUserContext(browser, session, { timezoneId });
  // FIXED, not installed-and-running: a countdown floors to whole units, so a clock
  // that drifts even one second during page load turns "21 hours left" into 20.
  await ctx.clock.setFixedTime(at);
  const page = await ctx.newPage();
  return { ctx, page, session };
}

async function step(
  journey: { milestone: (p: Page, n: string) => Promise<void>; track: (n: string, p: Page) => Page },
  page: Page,
  name: string,
) {
  journey.track(name, page);
  await assertHealthy(page, name);
  await journey.milestone(page, name);
}

// Shown able to fail on the exact thing nowInZone's comment promises: it reads
// the clock through `Intl` with an explicit zone "so a helper in another zone
// (or with a wrong device clock) still resolves against Louisiana's calendar".
// Dropping the zone pins it to the device instead, which is what this spec's
// Pacific cases exist to catch — at 3:00 PM in Los Angeles it is 5:00 PM in
// Louisiana and today's hours HAVE ended, and at 11:30 PM in LA it is 1:30 AM
// in Louisiana and they have not.
// @mutate src/components/profile/AvailabilityTab.tsx | timeZone: ZONE, | timeZone: undefined,
// Q413's two legs, each shown able to fail on the app (2026-10-07, a mutated
// build: both red, "open-morning" and the membership "Ends" line not found):
// @mutate supabase/functions/_shared/confirmDeadline.ts | export const CONFIRM_WINDOW_HOURS = 12; | export const CONFIRM_WINDOW_HOURS = 13;
// @mutate src/lib/subscriptionRenewalLabel.ts |   if (cancelAtPeriodEnd === true) return "Ends"; |   if (cancelAtPeriodEnd === true) return "Renews";


test.describe("time travel · deployed app, real backend, moved browser clock", () => {
  test.skip(!sessionsAvailable().ok, sessionsAvailable().why);

  test("availability: 'Ready until' flips to 'ended' at 5:00 PM Central, from any zone, across DST", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(8 * 60_000);
    /**
     * THE PRECONDITIONS ARE WRITTEN HERE, NOT HOPED FOR (Q280, e2e-journeys
     * run 35905284660, both engines). This test reads the screen's OFF-state
     * copy, which depends on two pieces of the SHARED poster account's state
     * that other runs change:
     *
     *  1. `profiles.available_until`. A press-every-control run turned the
     *     poster's "Available now" switch on at 05:34:15Z (edge_logs), which
     *     stored 22:00:15Z, i.e. 5:00 PM Central that day. At the moved clock
     *     of 4:59 PM the app then CORRECTLY rendered "Available now · Until
     *     5:00 PM" instead of "Ready until 5:00 PM", and the spec failed in
     *     Chromium and WebKit. Cleared here through the app's own RPC.
     *  2. The weekly grid. press-every-control's end-of-run cleanup deletes
     *     every `helper_availability` row created since the run began, and a
     *     save replaces the whole week, so it left the poster with NO hours
     *     (this read found 0 rows on 2026-09-23 at 22:54Z; the DELETEs were at 21:07Z). The old check turned that
     *     into an UNJUSTIFIED skip. The account is test-owned and this test is
     *     what depends on the shape, so it writes the 9-5 week and puts a
     *     non-empty previous week back afterwards.
     */
    const probe = await getSession(request, "poster");
    const readWeek = async () => {
      const res = await request.get(
        `${SUPABASE_URL}/rest/v1/helper_availability?helper_id=eq.${probe.user.id}&specific_date=is.null&select=day_of_week,is_available,start_time,end_time&order=day_of_week`,
        { headers: rest(probe) },
      );
      expect(res.ok(), `reading the poster's weekly hours: ${res.status()}`).toBe(true);
      return (await res.json()) as Array<{ day_of_week: number; is_available: boolean; start_time: string; end_time: string }>;
    };
    const writeWeek = async (slots: Array<{ day_of_week: number; is_available: boolean; start_time: string; end_time: string }>) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/save_weekly_availability`, {
        headers: rest(probe),
        data: { p_slots: slots.map(({ day_of_week, is_available, start_time, end_time }) => ({ day_of_week, is_available, start_time, end_time })) },
      });
      expect(res.ok(), `writing the poster's weekly hours: ${res.status()} ${await res.text()}`).toBe(true);
    };
    const NINE_TO_FIVE = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
      day_of_week,
      is_available: true,
      start_time: "09:00:00",
      end_time: "17:00:00",
    }));
    const before = await readWeek();
    const isNineToFive = (rows: typeof before) =>
      rows.length === 7 && rows.every((r) => r.is_available && r.start_time.startsWith("09:00") && r.end_time.startsWith("17:00"));
    if (!isNineToFive(before)) {
      test.info().annotations.push({ type: "seeded", description: `poster's week was ${before.length} rows, not 9-5 x7; wrote 9-5` });
      await writeWeek(NINE_TO_FIVE);
      journey.cleanup("restore the poster's weekly hours", async () => {
        // An empty week is not restored: it is the damage, not a choice.
        if (before.length) await writeWeek(before);
      });
    }
    expect(isNineToFive(await readWeek()), "the poster's weekly hours are not 09:00-17:00 every day").toBe(true);

    const cleared = await request.post(`${SUPABASE_URL}/rest/v1/rpc/clear_available_now`, { headers: rest(probe), data: {} });
    expect(cleared.ok(), `clear_available_now: ${cleared.status()} ${await cleared.text()}`).toBe(true);
    const status = await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${probe.user.id}&select=available_until`, {
      headers: rest(probe),
    });
    expect(status.ok()).toBe(true);
    const [{ available_until }] = (await status.json()) as Array<{ available_until: string | null }>;
    // Any stored value, past or future in REAL time, can be in the future of a
    // moved clock (the DST cases run months ahead, the others minutes).
    expect(available_until, "the poster's 'Available now' signal is still set").toBeNull();

    const today = centralDate(0);
    const cases: Array<[string, string, Date, RegExp]> = [
      ["ct-1659", CT, ct(today, "16:59"), /Ready until 5:00 PM/],
      ["ct-1700", CT, ct(today, "17:00"), /Today's hours ended at 5:00 PM/],
      // 2:59 PM in Los Angeles is 4:59 PM in Louisiana: still inside today's hours.
      ["pt-1459", PT, ct(today, "16:59"), /Ready until 5:00 PM/],
      ["pt-1500", PT, ct(today, "17:00"), /Today's hours ended at 5:00 PM/],
      // 11:30 PM in LA is 1:30 AM the NEXT day in Louisiana: still "ready", not "ended".
      // (Every day of this grid ends at 17:00, so this proves the zone, not the weekday.)
      ["pt-2330-previous-day", PT, ct(centralDate(1), "01:30"), /Ready until 5:00 PM/],
      // Fall-back Sunday (clocks 2→1 AM): 5 PM is 23:00Z, not 22:00Z.
      ["dst-fall-1659", CT, new Date("2026-11-01T22:59:00Z"), /Ready until 5:00 PM/],
      ["dst-fall-1700", CT, new Date("2026-11-01T23:00:00Z"), /Today's hours ended at 5:00 PM/],
      // Spring-forward Sunday 2027-03-14: 5 PM CDT is 22:00Z.
      ["dst-spring-1659", CT, new Date("2027-03-14T21:59:00Z"), /Ready until 5:00 PM/],
      ["dst-spring-1700", CT, new Date("2027-03-14T22:00:00Z"), /Today's hours ended at 5:00 PM/],
    ];
    for (const [name, tz, at, want] of cases) {
      const { ctx, page } = await openAt(browser, request, tz, at);
      try {
        await page.goto("/profile?tab=availability");
        await expect(page.getByText(want), `${name}: at ${at.toISOString()} viewed from ${tz}`).toBeVisible({
          timeout: 20_000,
        });
        await step(journey, page, `availability-${name}`);
      } finally {
        await ctx.close();
      }
    }
  });

  test("an unfunded job: its expiry instant is stored in Louisiana's zone across both DST mornings, and it is filed as a DRAFT, not a post", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(10 * 60_000);
    const poster = await getSession(request, "poster");
    // Non-numeric: the jobs contact-leak reject trigger reads a bare digit run
    // in a title as a phone number, so use base36 with a letter prefix.
    const runId = `r${Date.now().toString(36)}`;

    const LEG_CODE: Record<string, string> = { plain: "tp", "dst-fall": "tf", "dst-spring": "ts" };
    async function postJob(date: string, start: string, label: string) {
      const expires = ct(date, start).toISOString();
      // `expires_at` is read back below, so name it (plus `id` for cleanup).
      // Bare return=representation is RETURNING * and 42501s on jobs since
      // 20260915045110 — authenticated has no table-level SELECT there.
      const r = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,title,expires_at`, {
        headers: { ...rest(poster), Prefer: "return=representation" },
        data: {
          customer_id: poster.user.id,
          // jobs_title_length caps a title at 32 (Q782): marker (19) + a
          // 2-char leg code + runId (9); the leg's name is in the description.
          title: fitJobTitle(`${E2E_TITLE_MARKER} ${LEG_CODE[label] ?? label} ${runId}`),
          description: `Automated time-travel test row (${label}). Not a real job; deleted when the run ends.`,
          category: "cleaning",
          budget: 25,
          location: "4412 Highland Rd, Baton Rouge, LA 70808",
          date_needed: date,
          start_time: start,
          expires_at: expires,
          status: "open",
          payment_status: "unpaid",
          pricing_mode: "set_price",
          parish: null,
          // Intent only: enforce_jobs_insert_column_lock derives is_seed from
          // the poster's profiles.is_seed on a signed-in insert (Q46).
          is_seed: true,
        },
      });
      expect(r.ok(), `job insert failed: ${r.status()} ${await r.text()}`).toBe(true);
      const [job] = await r.json();
      journey.cleanup(`delete ${label} job`, async () => {
        const d = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=id`, {
          headers: { ...rest(poster), Prefer: "return=representation" },
        });
        expect(d.ok(), `cleanup delete ${d.status()}`).toBe(true);
        // A DELETE matching zero rows is still a 200; the row count is the proof.
        expect(await d.json(), `cleanup: ${label} job was not deleted`).toHaveLength(1);
      });
      // The stored expiry must be the Louisiana start, not the runner's zone.
      expect(Date.parse(job.expires_at), `${label}: stored expires_at`).toBe(ct(date, start).getTime());
      return job as { id: string; title: string };
    }

    /*
     * THE EXPIRY INSTANT, which is the half of this leg that does not need a
     * card on screen. `postJob` asserts the stored `expires_at` IS
     * `ct(date, start)` — the Louisiana wall clock resolved to an absolute
     * instant — and the two DST dates are why: 6:00 AM on the fall-back
     * Sunday is 12:00Z (CST), an hour after the naive CDT answer, and 6:00 AM
     * on the spring-forward Sunday is 11:00Z (CDT). A resolver that read the
     * runner's own zone, or that used a single fixed offset, lands on a
     * different instant for at least one of these three rows.
     */
    const D = centralDate(3);
    const job = await postJob(D, "09:00", "plain");
    await postJob("2026-11-01", "06:00", "dst-fall");
    await postJob("2027-03-14", "06:00", "dst-spring");

    /*
     * AN UNPAID JOB SHOWS NOWHERE (owner, 2026-09-27): "Unpaid jobs should not
     * show in post anywhere. Even hidden." and "Finish paying should not even
     * be a thing." (It was a "Finish Paying" draft row in Post a Job from
     * 2026-09-21, 8fdee80ca, until then.)
     *
     * This is the same unfunded fixture the countdown leg below had to stop using, and
     * it is asserted here rather than left implicit, because the rule is what
     * takes that leg away. `jobIsUnfundedDraft` (src/components/job-card/
     * activityFilters.ts) drops payment_status unpaid/abandoned/failed, in
     * every status, out of `postedJobs` at the source — list AND tab counts —
     * and Post a Job offers no row for it either. Every job this
     * spec can create is in exactly that state and cannot leave it: the live
     * `enforce_jobs_insert_column_lock` forces `payment_status := 'unpaid'`
     * and `status := 'open'` on a poster INSERT, and `payment_status` is in
     * `enforce_poster_jobs_money_lock`'s `locked_always` on UPDATE.
     *
     * Real clock, not a moved one: where a row is filed is not a time question.
     */
    await test.step("an unfunded job shows neither in Post a Job nor in My Posts", async () => {
      const { ctx, page } = await openAt(browser, request, CT, new Date());
      try {
        await page.goto("/post-job");
        // Wait for the entry column to paint (it holds a skeleton until its
        // data rows settle), so the absence below is not a loading screen.
        await expect(page.getByText("Start Fresh", { exact: true }), "Post a Job never painted its entry choices").toBeVisible({ timeout: 45_000 });
        await expect(
          page.getByText(job.title),
          "an unpaid job is offered in Post a Job — the owner removed Finish Paying (2026-09-27)",
        ).toHaveCount(0);
        await step(journey, page, "unfunded-not-in-post-a-job");

        await page.goto(`/posts?job=${job.id}`);
        await expect(page.getByRole("heading", { name: "My Posts", level: 1 })).toBeVisible({ timeout: 45_000 });
        // `?job=` is the app's OWN "take me to this job" link (Activity.tsx):
        // when the id is in `postedJobs` it sets the status filter to that
        // job's live bucket and highlights the card, so the row would be on
        // screen whichever tab it belongs to. That is what makes this absence
        // an assertion rather than a tautology about the tab we happen to land
        // on — the app was asked for the job and had nothing to show.
        //
        // Wait for the list to have SETTLED first. Without this the absence
        // would also pass against a still-loading screen (ActivityPageSkeleton
        // carries no heading and no empty-state title). Settled is EITHER a
        // card (each card's title is an h2) OR ActivityEmptyState's own
        // title. It used to wait for a card only, on the belief that "this
        // shared account has a hundred-odd posts" — but every job the poster
        // owns can be unfunded (prod 2026-10-01: 40 jobs, all payment_status
        // unpaid/abandoned), `jobIsUnfundedDraft` drops every one of them, and
        // the correct screen is "Nothing posted yet" with no h2 at all
        // (nightly-red #1719, run 36923486825). A failed fetch is a separate
        // branch of ActivityEmptyState with neither title, so it still fails.
        const card = page.getByRole("heading", { level: 2 }).first();
        const emptyTitle = page.getByText(/^(Nothing posted yet|No jobs in this view)$/).first();
        await expect(card.or(emptyTitle), "My Posts never settled on a card or its empty state").toBeVisible({ timeout: 45_000 });
        await expect(
          page.getByText(job.title),
          "an unfunded job is still listed as a post — no Helpr can see it, so it is a card for a job that cannot move",
        ).toHaveCount(0);
        await step(journey, page, "unfunded-not-in-posts");
      } finally {
        await ctx.close();
      }
    });
  });

  /*
   * THE COUNTDOWN CHIP UNDER A MOVED CLOCK, on a FUNDED job. "21 hours left" /
   * "1 minute left" / "Expired" on the poster's own card, in Central and from
   * Pacific. It ran on an unfunded job until 2026-09-22, when
   * `jobIsUnfundedDraft` (owner: an unpaid job is a draft, not a post) took
   * every unfunded job off My Posts, and it then sat here as an unconditional
   * UNCOVERED skip that turned e2e-journeys red every night (#1719).
   *
   * So this leg funds its own job the way a poster does — create-payment
   * `escrow` mints the Checkout Session, Stripe TEST mode takes 4242, the
   * webhook (never this file) moves payment_status to escrow — and hands it
   * back through the app's own door afterwards: `cancel_escrow` refunds an
   * open, unhired job and cancels it. The title carries E2E_TITLE_MARKER, so
   * scripts/e2e/prod-lifecycle-sweeper.mjs unwinds it the same way if a run
   * dies first. The Checkout page is paid in Chromium from either engine
   * (payCheckoutUrlInChromium: the app never shows Stripe in its WKWebView).
   */
  test("a funded job's countdown chip: day before, minute before, at start, overdue — Central and Pacific", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(10 * 60_000);
    const poster = await getSession(request, "poster");
    const runId = `f${Date.now().toString(36)}`;
    const D = centralDate(3);
    const start = ct(D, "09:00");
    // marker (19) + "tt" + runId (9) = 32, jobs_title_length's cap (Q782).
    const title = fitJobTitle(`${E2E_TITLE_MARKER} tt ${runId}`);
    const ins = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,title,expires_at`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        title,
        description: "Automated time-travel test row. Not a real job; refunded and cancelled when the run ends.",
        category: "cleaning",
        budget: 25,
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        date_needed: D,
        start_time: "09:00",
        expires_at: start.toISOString(),
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
        parish: null,
      },
    });
    expect(ins.ok(), `job insert failed: ${ins.status()} ${await ins.text()}`).toBe(true);
    const [job] = (await ins.json()) as Array<{ id: string; title: string; expires_at: string }>;
    expect(Date.parse(job.expires_at), "stored expires_at").toBe(start.getTime());
    const read = async () => {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=status,payment_status`, { headers: rest(poster) });
      expect(r.ok(), `reading ${job.id}: ${r.status()}`).toBe(true);
      const rows = (await r.json()) as Array<{ status: string; payment_status: string }>;
      expect(rows, `${job.id} is not readable by its poster`).toHaveLength(1);
      return rows[0];
    };
    journey.cleanup("refund and cancel the funded job", async () => {
      const now = await read();
      if (now.status === "cancelled") return;
      if (now.payment_status === "unpaid") {
        /* NOT a DELETE. The jobs DELETE policy lets a poster delete an unpaid
           job only while `stripe_session_id IS NULL`, and create-payment escrow
           stamps the session the moment it mints a Checkout. In live mode the
           pay step is skipped after that, so the DELETE matched zero rows (run
           36561180641: "the unfunded job was not deleted"). The poster's own
           cancel RPC works with or without a session; an unpaid job moves no
           money and records no strike (no committed Helpr). */
        const c = await request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {
          headers: rest(poster),
          data: { p_job_id: job.id, p_reason: "E2E time-travel teardown" },
        });
        expect(c.ok(), `cleanup: poster_cancel_job ${c.status()} ${(await c.text()).slice(0, 200)}`).toBe(true);
        expect((await read()).status, "cleanup: poster_cancel_job answered but the unfunded job is not cancelled").toBe("cancelled");
        return;
      }
      const c = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "cancel_escrow", jobId: job.id },
      });
      expect(c.ok(), `cleanup: cancel_escrow ${c.status()} ${(await c.text()).slice(0, 200)}`).toBe(true);
      // A 200 is a claim; the row is the fact.
      expect((await read()).status, "cleanup: cancel_escrow answered but the job is not cancelled").toBe("cancelled");
    });

    await test.step("fund it on Stripe TEST mode", async () => {
      const esc = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "escrow", jobId: job.id },
        timeout: 60_000,
      });
      const body = (await esc.json().catch(() => ({}))) as { url?: string };
      expect(esc.ok() && typeof body.url === "string", `create-payment escrow refused: ${esc.status()}`).toBe(true);
      // Live Stripe: the owner's 2026-09-27 decision, the one justified skip
      // (e2e/prod-audit/fundedOpenJob.ts). The live page is never opened.
      const mode = stripeModeFromCheckoutUrl(body.url!);
      expect(mode, `create-payment escrow answered a URL with no Checkout Session id: ${body.url}`).not.toBe("unknown");
      if (mode === "live") skipLivePay(`time-travel funded countdown: create-payment minted a live Checkout Session for ${job.id}`);
      await payCheckoutUrlInChromium(body.url!);
      await expect
        .poll(async () => (await read()).payment_status, { timeout: 90_000, message: "the webhook never funded the job" })
        .toBe("escrow");
    });

    async function chipAt(tz: string, at: Date, want: RegExp, name: string) {
      const { ctx, page } = await openAt(browser, request, tz, at);
      try {
        // `?job=` is the app's own "take me to this job" link: it opens the
        // job's bucket, so the card is on screen whichever tab it is filed in.
        await page.goto(`/posts?job=${job.id}`);
        // The smallest element holding BOTH this job's title and the chip:
        // the card's own row, never a neighbour's chip (the list holds others).
        const card = page.locator("div").filter({ hasText: job.title }).filter({ has: page.getByText(want) }).last();
        await expect(card, `${name}: at ${at.toISOString()} from ${tz}`).toBeVisible({ timeout: 45_000 });
        await step(journey, page, `funded-${name}`);
      } finally {
        await ctx.close();
      }
    }

    const H = 3_600_000;
    await chipAt(CT, new Date(start.getTime() - 21 * H), /(^|\s)21 hours left$/, "day-before");
    await chipAt(CT, new Date(start.getTime() - 60_000), /(^|\s)1 minute left$/, "minute-before");
    await chipAt(CT, start, /(^|\s)Expired$/, "at-start");
    await chipAt(CT, ct(centralDate(4), "00:00"), /(^|\s)Expired$/, "overdue-next-day");
    // Same instants from Los Angeles: a countdown is an instant, not a wall clock.
    await chipAt(PT, new Date(start.getTime() - 60_000), /(^|\s)1 minute left$/, "pt-minute-before");
    await chipAt(PT, start, /(^|\s)Expired$/, "pt-at-start");
  });

  /*
   * "Offer expiring" and "Review window open → auto-release" are not declared
   * here: they run in e2e/journeys/02-marketplace.spec.ts ("time travel: …"
   * steps), at the moments that chain holds exactly the funded, offered and
   * marked-done job they need.
   *
   * The two below were UNCONDITIONAL placeholders until 2026-10-07 (Q413; owner
   * decided 2026-10-03: build both). Neither state can be reached through the
   * app on prod without a payment (an accept needs a funded job; a membership
   * is a Stripe checkout), and Stripe is LIVE. So the run WRITES the state with
   * the service role, test-owned and is_seed, and removes it in cleanup: no
   * money moves, no strike (nobody cancels a hired job), and the app reads the
   * row exactly as it would read one the webhook wrote.
   */
  test("confirm window: the Helpr's day-before 'I'm Still On' opens, counts down, then is past due", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(8 * 60_000);
    const key = serviceKey();
    if (!key) skipUncovered("Time travel: Confirm window (day before / day of)", "no SUPABASE_SERVICE_ROLE_KEY to write the accepted fixture");
    const poster = await getSession(request, "poster");
    const helper = await getSession(request, "helper");
    const date = centralDate(3);
    const title = fitJobTitle(`${E2E_TITLE_MARKER} confirm`);
    // Accepted days ago: `helper_confirmed_at` is the ACCEPT, more than a day
    // before the start, so it is not itself a day-of answer (JobConfirmation
    // helperDayOfConfirmation) and the day-before ask applies.
    const acceptedAt = new Date(Date.now() - 3_600_000).toISOString();
    const ins = await srFetch(key!, "POST", `${SUPABASE_URL}/rest/v1/jobs?select=id`, {
      extra: { Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        helper_id: helper.user.id,
        title,
        description: "E2E time-travel fixture: an accepted job the Helpr has not confirmed for the day. Written and removed by the run.",
        category: "cleaning",
        budget: 25,
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        date_needed: date,
        start_time: "10:00",
        estimated_hours: 2,
        status: "accepted",
        payment_status: "escrow",
        pricing_mode: "set_price",
        parish: null,
        "is_seed": true,
        helper_confirmed_at: acceptedAt,
        poster_confirmed_at: acceptedAt,
      },
    });
    expect(ins.ok(), `fixture job insert: ${ins.status()} ${(await ins.text()).slice(0, 200)}`).toBe(true);
    const [job] = (await ins.json()) as Array<{ id: string }>;
    journey.cleanup("delete the confirm-window fixture (application, then job)", async () => {
      const app = await srFetch(key!, "DELETE", `${SUPABASE_URL}/rest/v1/applications?job_id=eq.${job.id}&helper_id=eq.${helper.user.id}`);
      expect(app.ok(), `cleanup: application delete ${app.status()}`).toBe(true);
      const del = await srFetch(key!, "DELETE", `${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&is_seed=eq.true&select=id`, {
        extra: { Prefer: "return=representation" },
      });
      // A null error is not a delete: the row must come back.
      expect(((await del.json()) as unknown[]).length, `cleanup: fixture job ${job.id} was not deleted`).toBe(1);
    });
    const app = await srFetch(key!, "POST", `${SUPABASE_URL}/rest/v1/applications`, {
      data: { job_id: job.id, helper_id: helper.user.id, status: "accepted" },
    });
    expect(app.ok(), `fixture application insert: ${app.status()} ${(await app.text()).slice(0, 200)}`).toBe(true);

    const dayBefore = new Intl.DateTimeFormat("en-CA", { timeZone: CT, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(ct(date, "12:00").getTime() - 86_400_000),
    );
    // The window opens at midnight Central the day before and runs 12 hours
    // (CONFIRM_OPENS_HOURS_BEFORE / CONFIRM_WINDOW_HOURS): confirm by noon.
    async function helperAt(tz: string, at: Date, want: RegExp, button: boolean, name: string) {
      const { ctx, page } = await openAt(browser, request, tz, at, "helper");
      try {
        await page.goto(`/jobs?job=${job.id}`);
        await page.getByText(title).first().click();
        await expect(page.getByText(want).first(), `${name}: at ${at.toISOString()} from ${tz}`).toBeVisible({ timeout: 45_000 });
        const still = page.getByRole("button", { name: /I'm Still On/ });
        if (button) await expect(still, `${name}: the day-before answer is offered`).toBeVisible();
        else await expect(still, `${name}: no answer before the window opens`).toHaveCount(0);
        await step(journey, page, `confirm-${name}`);
      } finally {
        await ctx.close();
      }
    }
    await helperAt(CT, new Date(ct(dayBefore, "00:00").getTime() - 4 * 3_600_000), /4h 0m until confirmation opens/, false, "before-open"); // the clock panel since Q1399 (#2609)
    await helperAt(CT, ct(dayBefore, "09:00"), /Confirm by .* 12:00 PM \(3h left\)/, true, "open-morning");
    await helperAt(CT, ct(dayBefore, "13:00"), /Confirmation is past due/, true, "past-deadline");
    await helperAt(CT, ct(date, "07:00"), /Confirmation is past due/, true, "day-of");
    // An instant, not a wall clock: 9:00 AM Central is 7:00 AM in Los Angeles.
    await helperAt(PT, ct(dayBefore, "09:00"), /\(3h left\)/, true, "pt-open-morning");
  });

  test("membership: a Pro plan that will not renew says when it ends, then the account is on Free", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(6 * 60_000);
    const key = serviceKey();
    if (!key) skipUncovered("Time travel: Subscription expiring", "no SUPABASE_SERVICE_ROLE_KEY to write the membership fixture");
    const helper = await getSession(request, "helper");
    const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${helper.user.id}`;
    const COLS = "subscription_tier,subscription_expires_at,subscription_billing_cycle,subscription_cancel_at_period_end,stripe_subscription_id,subscription_source";
    const before = await srFetch(key!, "GET", `${profileUrl}&select=${COLS}`);
    expect(before.ok(), `reading the helper's membership: ${before.status()}`).toBe(true);
    const [was] = (await before.json()) as Array<Record<string, unknown>>;
    // Only a FREE account is borrowed: a real membership on the shared helper
    // (bought by another suite) is never overwritten.
    expect(was?.subscription_tier ?? null, "the shared helper already holds a membership; refusing to overwrite it").toBeNull();
    journey.cleanup("restore the helper's free membership", async () => {
      const r = await srFetch(key!, "PATCH", `${profileUrl}&select=user_id`, {
        extra: { Prefer: "return=representation" },
        data: {
          subscription_tier: null,
          subscription_expires_at: null,
          subscription_billing_cycle: null,
          subscription_cancel_at_period_end: false,
        },
      });
      expect(((await r.json()) as unknown[]).length, "cleanup: the helper's membership was not restored").toBe(1);
    });
    const ends = ct(centralDate(3), "12:00");
    const set = await srFetch(key!, "PATCH", `${profileUrl}&select=user_id`, {
      extra: { Prefer: "return=representation" },
      data: {
        subscription_tier: "pro",
        subscription_expires_at: ends.toISOString(),
        subscription_billing_cycle: "monthly",
        subscription_cancel_at_period_end: true,
      },
    });
    expect(((await set.json()) as unknown[]).length, "the membership fixture was not written").toBe(1);
    const endsLabel = `Ends ${ends.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: CT })}`;

    async function planAt(at: Date, name: string, check: (page: Page) => Promise<void>) {
      const { ctx, page } = await openAt(browser, request, CT, at, "helper");
      try {
        await page.goto("/profile?tab=subscription");
        await check(page);
        await step(journey, page, `membership-${name}`);
      } finally {
        await ctx.close();
      }
    }
    await planAt(new Date(ends.getTime() - 20 * 3_600_000), "day-before-end", async (page) => {
      await expect(page.getByText("YOUR PLAN").first(), "the Pro card is marked as the member's plan").toBeVisible({ timeout: 45_000 });
      // A cancelled monthly plan ENDS; it must never claim it renews.
      await expect(page.getByText(endsLabel).first()).toBeVisible();
      await expect(page.getByText(/^Renews/)).toHaveCount(0);
    });
    await planAt(new Date(ends.getTime() + 3_600_000), "after-end", async (page) => {
      await expect(page.getByText("Current").first(), "after the end the account is on the free plan").toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("YOUR PLAN"), "no plan claims the member after it ended").toHaveCount(0);
    });
  });
});
