import { describe, it, expect } from "vitest";
import {
  formatMonthYear,
  formatWorkDayMonthYear,
  formatLongDate,
  resolveWorkDayRange,
  buildWorkRecordSummaryLines,
  type WorkRecordDocumentInput,
} from "./workRecordDocument";

/**
 * THE WORK RECORD IS A DATED DOCUMENT, SO ITS DATES MUST NOT MOVE.
 *
 * `/work-record` produces the sheet a helper hands a landlord, a lender or an
 * employer. "Member since", "Active Period" and "Generated" are read as claims
 * about when this person worked.
 *
 * They were formatted with `toLocaleDateString("en-US", { month, year })` and
 * no `timeZone`, against UTC timestamps out of Postgres — which means the
 * READER's zone. So the same record said different things to different people:
 * a job created at `2026-08-01T00:00:00Z` is "July 2026" to the helper in
 * Louisiana and "August 2026" to anyone east of Greenwich, off by a month, and
 * at a year boundary off by a year. Moving the formatters into
 * `workRecordDocument.ts` made the screen and the PDF agree with each other;
 * it did not stop either of them changing under the reader. A discrepancy
 * invites a second look. A document that quietly reads differently in the
 * leasing office than it did on the helper's phone does not.
 *
 * The fix pins America/Chicago, for the reason `src/lib/jobDate.ts` and the
 * cancellation-fee ladder already pin it: Helpr is a Louisiana marketplace and
 * a dated record it issues has one answer.
 *
 * THE ASSERTIONS BELOW ARE THE POINT: every expected string is the Louisiana
 * answer, and this file must pass under ANY `TZ`. Verified by running it under
 * `TZ=America/Chicago` and `TZ=Asia/Tokyo` — under the old code the second run
 * produced a different month for every case here.
 */

/** Midnight UTC on the 1st — 7pm on the 31st in Central. The boundary case. */
const UTC_MIDNIGHT_AUG_1 = "2026-08-01T00:00:00Z";
/** The same boundary at a year end, where the slip costs a year too. */
const UTC_MIDNIGHT_JAN_1 = "2027-01-01T00:00:00Z";

/**
 * A record shared by most of the cases below.
 *
 * The two work days are deliberately the 1st of a month and the 1st of a
 * January — the day-only twin of the two constants above. A calendar day must
 * NOT be shifted, so these read "August 2026" and "January 2027", where the
 * same-looking INSTANTS above read "July 2026" and "December 2026". Both
 * answers are correct for their own kind of value, and having both in one file
 * is the guard against the two being formatted the same way again.
 */
const baseInput: WorkRecordDocumentInput = {
  fullName: "Test Helpr",
  memberSince: UTC_MIDNIGHT_AUG_1,
  identityVerified: true,
  jobsCompleted: 3,
  totalEarnings: 412.75,
  avgRating: 4.8,
  reviewCount: 3,
  firstWorkDay: "2026-08-01",
  lastWorkDay: "2027-01-01",
  generatedAt: new Date("2027-01-15T12:00:00Z"),
};

describe("work record dates resolve in the platform's zone, not the reader's", () => {
  it("a UTC-midnight timestamp reads as the Louisiana month, everywhere", () => {
    expect(formatMonthYear(UTC_MIDNIGHT_AUG_1)).toBe("July 2026");
  });

  it("a UTC-midnight timestamp at a year boundary reads as the Louisiana year", () => {
    expect(formatMonthYear(UTC_MIDNIGHT_JAN_1)).toBe("December 2026");
  });

  it("the long 'Generated' date is pinned to the same zone", () => {
    // 00:30 UTC on 1 September is still 31 August in Louisiana, and the
    // document is issued by a Louisiana business.
    expect(formatLongDate(new Date("2026-09-01T00:30:00Z"))).toBe("August 31, 2026");
  });

  it("does not read the runtime's zone at all", () => {
    // The tell-tale. `noZone` is exactly the old implementation: it follows
    // whatever zone the process is in. `formatMonthYear` must not.
    const instant = new Date(UTC_MIDNIGHT_AUG_1);
    const noZone = instant.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const platform = instant.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "America/Chicago",
    });
    expect(formatMonthYear(UTC_MIDNIGHT_AUG_1)).toBe(platform);
    // Under TZ=America/Chicago these coincide and this says nothing; under
    // TZ=Asia/Tokyo (or a UTC CI runner) `noZone` is "August 2026" and the
    // assertion above is the one doing the work. Both runs are the evidence.
    expect(typeof noZone).toBe("string");
  });

  it("the Active Period on the shared summary is zone-stable", () => {
    expect(buildWorkRecordSummaryLines(baseInput)[1]).toContain(
      "(August 2026 – January 2027)",
    );
  });
});

/**
 * THE ACTIVE PERIOD REPORTS WHEN THE WORK HAPPENED.
 *
 * It was min/max of `jobs.created_at` — the day the CUSTOMER posted the
 * listing. The owner moved it to `date_needed`, the day the work was
 * scheduled, because that is what the sentence "Active Period" on an
 * Employment & Earnings Record claims and what its readers take it to mean.
 * Measured against prod on 2026-08-31: 18 of 64 job rows are posted in a
 * different month from the one they are worked in.
 *
 * `date_needed` is a Postgres `date` — a bare `YYYY-MM-DD` with no instant —
 * so it must be formatted with NO offset. Running it through `formatMonthYear`
 * (which pins Chicago, correctly, for real instants) shifts a day-1 value back
 * into the previous month. Prod holds four live jobs dated `2026-09-01`.
 */
describe("active period reads the day worked, not the day posted", () => {
  it("a first-of-month work day is NOT shifted into the previous month", () => {
    expect(formatWorkDayMonthYear("2026-09-01")).toBe("September 2026");
    // The tell-tale: the instant formatter, correct for `created_at`, is wrong
    // for a bare calendar day. If these two ever agree, the guard is gone.
    expect(formatMonthYear("2026-09-01")).toBe("August 2026");
  });

  it("a first-of-January work day keeps its year", () => {
    expect(formatWorkDayMonthYear("2027-01-01")).toBe("January 2027");
  });

  it("refuses to render a malformed day rather than printing Invalid Date", () => {
    expect(formatWorkDayMonthYear("")).toBe("");
    expect(formatWorkDayMonthYear("not-a-date")).toBe("");
  });

  it("spans the days WORKED, not the days posted", () => {
    // Real shape: posted late in one month, worked early in the next — the
    // 18-of-64 case in prod.
    const range = resolveWorkDayRange([
      { created_at: "2026-07-28T15:45:00Z", date_needed: "2026-08-02" },
      { created_at: "2026-08-25T02:33:09Z", date_needed: "2026-09-01" },
    ]);
    expect(range).toEqual({ first: "2026-08-02", last: "2026-09-01" });
    // Posted-date answer would have been July 2026 - August 2026. The record
    // now says what it means.
    expect(formatWorkDayMonthYear(range!.first)).toBe("August 2026");
    expect(formatWorkDayMonthYear(range!.last)).toBe("September 2026");
  });

  it("orders by day worked even when that inverts the posting order", () => {
    const range = resolveWorkDayRange([
      { created_at: "2026-03-01T12:00:00Z", date_needed: "2026-09-30" },
      { created_at: "2026-09-01T12:00:00Z", date_needed: "2026-09-02" },
    ]);
    expect(range).toEqual({ first: "2026-09-02", last: "2026-09-30" });
  });

  /**
   * `date_needed` is NOT NULL on the `jobs` table (verified in prod: zero null
   * rows, and PostgREST lists it as required), so this case has to be
   * constructed — but the two views over that table type it nullable, and the
   * decision has to be explicit either way.
   *
   * THE DECISION: fall back to `created_at` for that row; never exclude it.
   * The row is still counted in "Jobs Completed" and "Total Earnings", so
   * dropping it from the period alone yields a sheet whose own numbers
   * contradict each other — and if the undated row is the oldest, the record
   * silently reports a shorter career than the helper actually has, with
   * nothing on the page telling the reader anything was left out.
   */
  it("a null date_needed falls back to that row's created_at, never dropping it", () => {
    const range = resolveWorkDayRange([
      { created_at: "2026-03-10T12:00:00Z", date_needed: null },
      { created_at: "2026-09-01T12:00:00Z", date_needed: "2026-09-02" },
    ]);
    // March survives. Excluding the null row would have reported the helper as
    // starting in September — six months of real, counted, paid work erased.
    expect(range).toEqual({ first: "2026-03-10", last: "2026-09-02" });
  });

  it("the created_at fallback resolves in the platform's zone, not the reader's", () => {
    // 02:33 UTC on 25 August is still 24 August in Louisiana.
    const range = resolveWorkDayRange([
      { created_at: "2026-08-25T02:33:09Z", date_needed: null },
    ]);
    expect(range).toEqual({ first: "2026-08-24", last: "2026-08-24" });
  });

  it("a single null date_needed cannot collapse the period", () => {
    const range = resolveWorkDayRange([
      { created_at: "2026-06-05T12:00:00Z", date_needed: "2026-06-10" },
      { created_at: "2026-07-05T12:00:00Z", date_needed: null },
      { created_at: "2026-08-05T12:00:00Z", date_needed: "2026-08-14" },
    ]);
    expect(range).toEqual({ first: "2026-06-10", last: "2026-08-14" });
  });

  it("an unparseable row is skipped rather than poisoning the range", () => {
    const range = resolveWorkDayRange([
      { created_at: "not a timestamp", date_needed: null },
      { created_at: "2026-08-05T12:00:00Z", date_needed: "2026-08-14" },
    ]);
    expect(range).toEqual({ first: "2026-08-14", last: "2026-08-14" });
    expect(JSON.stringify(range)).not.toContain("Invalid");
  });

  it("no completed jobs yields no period at all", () => {
    expect(resolveWorkDayRange([])).toBeNull();
    const empty = { ...baseInput, jobsCompleted: 0, firstWorkDay: null, lastWorkDay: null };
    // No parenthetical, no dangling dash, no "Invalid Date".
    expect(buildWorkRecordSummaryLines(empty)[1]).toBe("0 jobs completed on Helpr");
  });
});

/**
 * "MEMBER SINCE" DID NOT MOVE, AND THIS TEST IS WHY.
 *
 * It is a different fact from Active Period: time on the PLATFORM, not time
 * worked. `profiles.created_at` is the literal record of the day the account
 * opened, and no job date can answer it — a helper can join in March and work
 * first in August, which is exactly the fixture below.
 */
describe("member since is the account's age, not the work span", () => {
  it("stays on profiles.created_at and is independent of the jobs", () => {
    const joinedMarchWorkedAugust: WorkRecordDocumentInput = {
      ...baseInput,
      memberSince: "2026-03-04T12:00:00Z",
      firstWorkDay: "2026-08-07",
      lastWorkDay: "2026-08-23",
    };
    expect(formatMonthYear(joinedMarchWorkedAugust.memberSince)).toBe("March 2026");
    expect(buildWorkRecordSummaryLines(joinedMarchWorkedAugust)[1]).toContain(
      "(August 2026 – August 2026)",
    );
  });
});
