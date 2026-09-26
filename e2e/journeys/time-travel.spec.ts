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
  type Session,
} from "./fixtures";

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
): Promise<{ ctx: BrowserContext; page: Page; session: Session }> {
  const minted = await getSession(api, "poster");
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

    async function postJob(date: string, start: string, label: string) {
      const expires = ct(date, start).toISOString();
      // `expires_at` is read back below, so name it (plus `id` for cleanup).
      // Bare return=representation is RETURNING * and 42501s on jobs since
      // 20260915045110 — authenticated has no table-level SELECT there.
      const r = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,title,expires_at`, {
        headers: { ...rest(poster), Prefer: "return=representation" },
        data: {
          customer_id: poster.user.id,
          title: `${E2E_TITLE_MARKER} time travel ${label} ${runId}`,
          description: "Automated time-travel test row. Not a real job; deleted when the run ends.",
          category: "cleaning",
          budget: 25,
          location: "Baton Rouge, LA",
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
     * AN UNFUNDED JOB IS A DRAFT, NOT A POST (owner, 2026-09-21; shipped in
     * 8fdee80ca): "a job can never be posted if it was enver paid for … It
     * would be in post a job, drafts."
     *
     * This is the same unfunded fixture the countdown leg below had to stop using, and
     * it is asserted here rather than left implicit, because the rule is what
     * takes that leg away. `jobIsUnfundedDraft` (src/components/job-card/
     * activityFilters.ts) drops payment_status unpaid/abandoned/failed on an
     * OPEN job out of `postedJobs` at the source — list AND tab counts — and
     * `useUnpaidJobDrafts` is the route back to paying for it. Every job this
     * spec can create is in exactly that state and cannot leave it: the live
     * `enforce_jobs_insert_column_lock` forces `payment_status := 'unpaid'`
     * and `status := 'open'` on a poster INSERT, and `payment_status` is in
     * `enforce_poster_jobs_money_lock`'s `locked_always` on UPDATE.
     *
     * Real clock, not a moved one: where a row is filed is not a time question.
     */
    await test.step("an unfunded job is a draft in Post a Job, and is not a post in My Posts", async () => {
      const { ctx, page } = await openAt(browser, request, CT, new Date());
      try {
        await page.goto("/post-job");
        const draft = page.locator(`[data-unpaid-draft="${job.id}"]`);
        await expect(draft, "an unfunded job is not offered as a draft in Post a Job — an abandoned checkout with no route back to paying for it").toBeVisible({
          timeout: 45_000,
        });
        await expect(draft, "the draft row does not name the job it belongs to").toContainText(job.title);
        await step(journey, page, "unfunded-is-a-draft");

        await page.goto(`/posts?job=${job.id}`);
        await expect(page.getByRole("heading", { name: "My Posts", level: 1 })).toBeVisible({ timeout: 45_000 });
        // `?job=` is the app's OWN "take me to this job" link (Activity.tsx):
        // when the id is in `postedJobs` it sets the status filter to that
        // job's live bucket and highlights the card, so the row would be on
        // screen whichever tab it belongs to. That is what makes this absence
        // an assertion rather than a tautology about the tab we happen to land
        // on — the app was asked for the job and had nothing to show.
        //
        // Wait for the list to have PAINTED first. Without this the absence
        // would also pass against a still-loading screen; this shared account
        // has a hundred-odd posts, so some card always renders.
        await expect(page.getByRole("heading", { level: 2 }).first(), "My Posts never painted a card").toBeVisible({ timeout: 45_000 });
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
    const title = `${E2E_TITLE_MARKER} time travel funded ${runId}`;
    const ins = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,title,expires_at`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        title,
        description: "Automated time-travel test row. Not a real job; refunded and cancelled when the run ends.",
        category: "cleaning",
        budget: 25,
        location: "Baton Rouge, LA",
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
      if (now.payment_status === "unpaid") {
        const d = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=id`, {
          headers: { ...rest(poster), Prefer: "return=representation" },
        });
        expect(await d.json(), "cleanup: the unfunded job was not deleted").toHaveLength(1);
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
   * "Offer expiring" and "Review window open → auto-release" are no longer
   * declared here: they run in e2e/journeys/02-marketplace.spec.ts ("time
   * travel: …" steps), at the moments that chain holds exactly the funded,
   * offered and marked-done job they need.
   *
   * The two below still need a state no journey makes: an accepted job the
   * Helpr has not confirmed (the accept must land more than a day before the
   * start, and a hired, funded job days out cannot be unwound without a
   * cancellation strike on a shared account), and a paid membership (a
   * test-mode subscription the harness would then have to cancel through
   * Stripe's billing portal). docs/OPEN.md carries both.
   */
  for (const [title, detail] of [
    ["Confirm window (day before / day of)", "needs an accepted job the E2E helper has not confirmed"],
    ["Subscription expiring", "neither E2E account holds a paid tier; buying one is a Stripe checkout"],
  ] as const) {
    test(`UNCOVERED: ${title}`, async () => {
      skipUncovered(`Time travel: ${title}`, detail);
    });
  }
});
