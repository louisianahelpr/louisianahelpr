/**
 * Two pure helpers pulled out of edge functions whose handlers call
 * `Deno.serve` at module load (so vitest cannot import the handlers):
 *
 *   supabase/functions/send-push-notification/category.ts
 *   supabase/functions/str-ical-sync/dates.ts
 *
 * Both existed as inline logic that read perfectly and was wrong, and in both
 * cases the wrongness is decidable from data rather than from wiring — which
 * is exactly what a unit test is for.
 */
import { describe, it, expect } from "vitest";

/**
 * Loaded through NON-LITERAL specifiers, for the same reason
 * `str-ical-safeFetch.test.ts` does it: `tsconfig.app.json` enumerates the
 * handful of `supabase/functions/*` modules the app compiles and these are not
 * among them, so a static import fails with TS6307. Both modules ARE
 * typechecked, by `npm run typecheck:edge`.
 */
const CATEGORY_PATH = "../../../supabase/functions/send-push-notification/category.ts";
const DATES_PATH = "../../../supabase/functions/str-ical-sync/dates.ts";

const { inferCategoryFromLink } = (await import(/* @vite-ignore */ CATEGORY_PATH)) as {
  inferCategoryFromLink(link: string | null | undefined): string | undefined;
};
const { parseIcalDate, utcDay, lookAheadWindow, isInLookAhead } = (await import(
  /* @vite-ignore */ DATES_PATH
)) as {
  parseIcalDate(icalDate: string): Date;
  utcDay(instant: Date): Date;
  lookAheadWindow(now: Date, days?: number): { from: Date; to: Date };
  isInLookAhead(checkoutDate: Date, now: Date, days?: number): boolean;
};

describe("inferCategoryFromLink", () => {
  it("maps chat links to MESSAGE", () => {
    expect(inferCategoryFromLink("/messages")).toBe("MESSAGE");
    expect(inferCategoryFromLink("/messages/abc-123")).toBe("MESSAGE");
    expect(inferCategoryFromLink("/Messages?thread=9")).toBe("MESSAGE");
  });

  it("gives a job you ALREADY HOLD the Message/View pair, not Apply/Save", () => {
    // These are the 226 live rows that were either mis-labelled JOB_APPLY
    // (/jobs/:id) or given no category at all (/posts, /jobs).
    for (const link of [
      "/jobs/5eed0827-0000-4000-8000-000000000020", // "Starting soon"
      "/jobs/db21c20d-82ad-4016-9c7e-5a79051b4c8f", // "Has your helpr arrived?"
      "/posts", // "Payment secured in escrow"
      "/posts?job=44444444-4444-4444-8444-444444444444", // dispute counterparty
      "/jobs", // "Job completed!"
      "/jobs?job=44444444-4444-4444-8444-444444444444",
    ]) {
      expect(inferCategoryFromLink(link), link).toBe("JOB_ACCEPTED");
    }
  });

  it("makes JOB_ACCEPTED reachable at all, which it never was", () => {
    // The old rule was `link.includes('/jobs/') && link.includes('accepted')`.
    // ZERO of the 1,709 production notification links contain "accepted" —
    // the notification titled "Application accepted!" links to /home —
    // so no push has ever carried this category.
    const everReachable = [
      "/jobs/abc",
      "/posts",
      "/jobs",
      "/home",
      "/messages",
    ].some((l) => inferCategoryFromLink(l) === "JOB_ACCEPTED");
    expect(everReachable).toBe(true);
  });

  it("gives an OPPORTUNITY the Apply/Save pair", () => {
    expect(inferCategoryFromLink("/home")).toBe("JOB_APPLY"); // job_match feed
    expect(inferCategoryFromLink("/home?job=1")).toBe("JOB_APPLY");
  });

  it("leaves links with no honest button pair uncategorised", () => {
    for (const link of [
      "/admin", // 627 rows — ops alerts
      "/admin?view=disputes",
      "/profile?tab=earnings", // "Payout released"
      "/profile",
      "/post-job", // "Job auto-cancelled"
      "/support",
      "/profile?tab=warnings",
      "/rules",
      "/account-banned",
      "",
      null,
      undefined,
    ]) {
      expect(inferCategoryFromLink(link), String(link)).toBeUndefined();
    }
  });

  it("does not confuse a path that merely CONTAINS a known segment", () => {
    // The old rule used `includes('/jobs/')`, which would fire on anything.
    expect(inferCategoryFromLink("/admin/jobs/123")).toBeUndefined();
  });
});

describe("str-ical look-ahead window", () => {
  it("parses an iCal date to UTC midnight of that day", () => {
    expect(parseIcalDate("20260902").toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(parseIcalDate("20260902T110000Z").toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("floors an instant to UTC midnight", () => {
    expect(utcDay(new Date("2026-09-02T18:44:00Z")).toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(utcDay(new Date("2026-09-02T00:00:00Z")).toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("KEEPS today's checkout at every hour the cron actually fires", () => {
    // THE DEFECT. checkoutDate is UTC midnight; `now` was an instant; the cron
    // runs at :44 past 00, 06, 12 and 18 UTC, so `checkoutDate < now` was true
    // on every single run and today's turnover — the most urgent cleaning job
    // there is — was dropped every time.
    const today = parseIcalDate("20260902");
    for (const hour of ["00:44", "06:44", "12:44", "18:44", "23:59"]) {
      const now = new Date(`2026-09-02T${hour}:00Z`);
      expect(today < now, `sanity: midnight is behind ${hour}`).toBe(true);
      expect(isInLookAhead(today, now), hour).toBe(true);
    }
  });

  it("still drops yesterday's checkout", () => {
    // 12:44 UTC is 07:44 CDT: the Louisiana and UTC days agree.
    const now = new Date("2026-09-02T12:44:00Z");
    expect(isInLookAhead(parseIcalDate("20260901"), now)).toBe(false);
    expect(isInLookAhead(parseIcalDate("20260830"), now)).toBe(false);
  });

  // Q1265: the window opens on the LOUISIANA day. The 00:44 UTC run is 19:44
  // CDT the evening before; that evening's checkout is still today there.
  // @mutate supabase/functions/str-ical-sync/dates.ts |   const from = parseIcalDate(louisianaToday(now).replace(/-/g, '')); |   const from = utcDay(now);
  it("keeps the Louisiana day's checkout on the evening runs (Q1265)", () => {
    const evening = new Date("2026-10-02T00:44:00Z"); // 19:44 CDT, Oct 1
    expect(isInLookAhead(parseIcalDate("20261001"), evening)).toBe(true);
    expect(isInLookAhead(parseIcalDate("20260930"), evening)).toBe(false);
    const winter = new Date("2026-12-02T00:44:00Z"); // 18:44 CST, Dec 1
    expect(isInLookAhead(parseIcalDate("20261201"), winter)).toBe(true);
    expect(lookAheadWindow(evening).from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps a whole 7 days of look-ahead and drops day 8", () => {
    const now = new Date("2026-09-02T18:44:00Z");
    expect(isInLookAhead(parseIcalDate("20260909"), now)).toBe(true); // +7
    expect(isInLookAhead(parseIcalDate("20260910"), now)).toBe(false); // +8
  });

  it("does not slide the far edge with the time of day the cron fires", () => {
    // The old `Date.now() + 7d` far edge moved with the clock: a 00:44 run and
    // an 18:44 run on the same date disagreed about whether day +7 was in.
    // (06:44 UTC, not 00:44: the 00:44 run is the evening before in
    // Louisiana, which is the Louisiana day the window opens on, Q1265.)
    const early = lookAheadWindow(new Date("2026-09-02T06:44:00Z"));
    const late = lookAheadWindow(new Date("2026-09-02T18:44:00Z"));
    expect(early.from.toISOString()).toBe(late.from.toISOString());
    expect(early.to.toISOString()).toBe(late.to.toISOString());
    expect(early.to.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });
});

// @mutate supabase/functions/str-ical-sync/dates.ts | const from = parseIcalDate(louisianaToday(now).replace(/-/g, '')); | const from = now;
// @mutate supabase/functions/send-push-notification/category.ts | path.startsWith('/jobs')) { | path.includes('accepted')) {
