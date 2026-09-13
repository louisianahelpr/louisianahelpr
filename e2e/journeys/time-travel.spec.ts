import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  SUPABASE_URL,
  E2E_TITLE_MARKER,
  assertHealthy,
  getSession,
  newUserContext,
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
const H = 3_600_000;

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

test.describe("time travel · deployed app, real backend, moved browser clock", () => {
  test.skip(!sessionsAvailable().ok, sessionsAvailable().why);

  test("availability: 'Ready until' flips to 'ended' at 5:00 PM Central, from any zone, across DST", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(8 * 60_000);
    // The E2E poster's weekly grid is 09:00–17:00 every day (read below, not assumed).
    const probe = await getSession(request, "poster");
    const grid = await request.get(
      `${SUPABASE_URL}/rest/v1/helper_availability?helper_id=eq.${probe.user.id}&specific_date=is.null&select=day_of_week,is_available,end_time`,
      { headers: rest(probe) },
    );
    expect(grid.ok()).toBe(true);
    const rows = (await grid.json()) as Array<{ is_available: boolean; end_time: string }>;
    if (rows.length !== 7 || rows.some((r) => !r.is_available || !r.end_time.startsWith("17:00"))) {
      skipUncovered("Availability boundary", "E2E poster's grid is no longer 09:00–17:00 every day; re-seed it.");
    }

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

  test("a posted job: day before, minute before start, at start, overdue — Central, Pacific and both DST mornings", async ({
    browser,
    request,
    journey,
  }) => {
    test.setTimeout(10 * 60_000);
    const poster = await getSession(request, "poster");
    const runId = `${Date.now()}`;

    async function postJob(date: string, start: string, label: string) {
      const expires = ct(date, start).toISOString();
      const r = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
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
        },
      });
      expect(r.ok(), `job insert failed: ${r.status()} ${await r.text()}`).toBe(true);
      const [job] = await r.json();
      journey.cleanup(`delete ${label} job`, async () => {
        const d = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
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

    async function chipAt(job: { id: string; title: string }, tz: string, at: Date, want: RegExp, name: string) {
      const { ctx, page } = await openAt(browser, request, tz, at);
      try {
        await page.goto(`/my-posts?job=${job.id}`);
        // The smallest element holding BOTH this job's title and the chip: the card's own row, never a
        // neighbour's chip (the list holds other jobs).
        const card = page.locator("div").filter({ hasText: job.title }).filter({ has: page.getByText(want) }).last();
        await expect(card, `${name}: at ${at.toISOString()} from ${tz}`).toBeVisible({ timeout: 20_000 });
        await step(journey, page, `job-${name}`);
      } finally {
        await ctx.close();
      }
    }

    const D = centralDate(3);
    const job = await postJob(D, "09:00", "plain");
    const start = ct(D, "09:00");
    await chipAt(job, CT, new Date(start.getTime() - 21 * H), /(^|\s)21 hours left$/, "day-before");
    await chipAt(job, CT, new Date(start.getTime() - 60_000), /(^|\s)1 minute left$/, "minute-before");
    await chipAt(job, CT, start, /(^|\s)Expired$/, "at-start");
    await chipAt(job, CT, ct(centralDate(4), "00:00"), /(^|\s)Expired$/, "overdue-next-day");
    // Same instants from Los Angeles: a countdown is an instant, not a wall clock.
    await chipAt(job, PT, new Date(start.getTime() - 60_000), /(^|\s)1 minute left$/, "pt-minute-before");
    await chipAt(job, PT, start, /(^|\s)Expired$/, "pt-at-start");

    // 6:00 AM on the fall-back Sunday is 12:00Z (CST), an hour after the naive CDT answer.
    const fall = await postJob("2026-11-01", "06:00", "dst-fall");
    await chipAt(fall, CT, new Date("2026-11-01T11:59:00Z"), /(^|\s)1 minute left$/, "dst-fall-minute-before");
    await chipAt(fall, CT, new Date("2026-11-01T12:00:00Z"), /(^|\s)Expired$/, "dst-fall-at-start");
    // 6:00 AM on the spring-forward Sunday is 11:00Z (CDT).
    const spring = await postJob("2027-03-14", "06:00", "dst-spring");
    await chipAt(spring, CT, new Date("2027-03-14T10:59:00Z"), /(^|\s)1 minute left$/, "dst-spring-minute-before");
    await chipAt(spring, CT, new Date("2027-03-14T11:00:00Z"), /(^|\s)Expired$/, "dst-spring-at-start");
  });

  /*
   * The boundaries below need a job in a FUNDED, HIRED state — accepted with a
   * response deadline, confirmed, or marked done by the helper — or a paid
   * membership. The E2E accounts hold none, and getting there means the whole
   * money loop (fund on Stripe test, apply, hire, complete), which
   * e2e/prod-lifecycle.spec.ts owns. They are declared here so the gap is a
   * visible UNCOVERED line on every run rather than an absence.
   */
  for (const [title, detail] of [
    ["Offer expiring", "needs an accepted offer with response_deadline on the E2E helper (hire leg of prod-lifecycle)"],
    ["Confirm window (day before / day of)", "needs an accepted job the E2E helper has not confirmed"],
    ["Review window open → auto-release", "needs an in_progress escrow job with helper_completed_at (complete leg)"],
    ["Subscription expiring", "neither E2E account holds a paid tier; buying one is a Stripe checkout"],
  ] as const) {
    test(`UNCOVERED: ${title}`, async () => {
      skipUncovered(`Time travel: ${title}`, detail);
    });
  }
});
