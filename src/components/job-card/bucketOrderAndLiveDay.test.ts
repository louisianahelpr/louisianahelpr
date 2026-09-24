/**
 * OWNER, 2026-09-19: "wouldnt the correct order for post and jobs be needs you
 * waiting scheduled done cancelled?"
 *
 * Yes — with one correction they spotted themselves in the same breath ("yes it
 * needs you but its also scheduled??"). The old order put Scheduled SECOND
 * precisely because it also held today's work and work already underway, so
 * demoting it below Waiting would have ranked a job starting in an hour beneath
 * a bucket that by definition needs nothing from the reader.
 *
 * So the swap and the live-day rule are ONE change, and this file exists to
 * stop them being half-undone. Reordering without `jobIsLive` buries today's
 * jobs; `jobIsLive` without the reorder is a behaviour change nobody asked for.
 *
 * Both halves are asserted through the PUBLIC surface (the exported filter list
 * and the exported bucket functions), never by re-declaring the expected order
 * next to the code that produces it — a list checked against itself cannot
 * fail.
 */
import { describe, expect, it } from "vitest";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  postedActivityBucket,
  appliedActivityBucket,
} from "./activityFilters";
import type { AppliedApp } from "@/components/job-card/activityConstants";

/** Platform-zone date, the same way activityFilters resolves one. */
const day = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));

describe("bucket order + the live-day rule are one change", () => {
  it("both tabs run Needs You · Waiting · Scheduled · Done · Cancelled", () => {
    const order = ["needs_you", "waiting", "scheduled", "done", "cancelled"];
    expect(POSTED_STATUS_FILTERS.map((f) => f.key)).toEqual(order);
    // The two tabs must never diverge — a reader moving between them would be
    // learning two different orders for the same five words.
    expect(APPLIED_STATUS_FILTERS.map((f) => f.key)).toEqual(
      POSTED_STATUS_FILTERS.map((f) => f.key),
    );
    // Floor: if the list ever came back empty, toEqual above would still need
    // five entries, but assert it plainly so the intent survives a refactor.
    expect(POSTED_STATUS_FILTERS).toHaveLength(5);
  });

  it("Waiting outranks Scheduled — the whole point of the reorder", () => {
    const keys = POSTED_STATUS_FILTERS.map((f) => f.key);
    expect(keys.indexOf("waiting")).toBeLessThan(keys.indexOf("scheduled"));
  });

  it("a job happening TODAY is never filed under the demoted bucket", () => {
    // This is the assertion that makes the reorder safe. If someone deletes
    // jobIsLive, today's work falls back into Scheduled — now the fourth thing
    // a reader sees — and the owner's objection comes true.
    expect(postedActivityBucket({ status: "in_progress", date_needed: day(0) })).toBe("needs_you");
    expect(
      postedActivityBucket({
        status: "accepted",
        helper_confirmed_at: "2026-08-01T00:00:00Z",
        date_needed: day(0),
      }),
    ).toBe("needs_you");
  });

  it("Scheduled still means agreed and AHEAD of you", () => {
    expect(postedActivityBucket({ status: "in_progress", date_needed: day(2) })).toBe("scheduled");
    expect(
      postedActivityBucket({
        status: "accepted",
        helper_confirmed_at: "2026-08-01T00:00:00Z",
        date_needed: day(5),
      }),
    ).toBe("scheduled");
  });

  /**
   * THE HALF THIS FILE ORIGINALLY MISSED.
   *
   * Written 2026-09-19 asserting the tab ORDER for both tabs but the LIVE-DAY
   * rule for only `postedActivityBucket` — so the reorder shipped on both
   * sides while the rule that makes it safe shipped on one, and this guard
   * said nothing. Browser verification found five of five today-jobs sitting
   * under Scheduled on the helper's /jobs.
   *
   * Every case below is therefore run through BOTH functions. A rule that is
   * true of one side of a two-sided marketplace and not the other is exactly
   * the shape of bug a single-sided guard cannot see.
   */
  const applied = (job: Record<string, unknown>, appStatus = "accepted") =>
    appliedActivityBucket({ status: appStatus, job } as unknown as AppliedApp);

  it("the helper side files today under Needs You too", () => {
    expect(applied({ status: "in_progress", date_needed: day(0) })).toBe("needs_you");
    expect(
      applied({ status: "accepted", date_needed: day(0), helper_confirmed_at: "2026-08-01T00:00:00Z" }),
    ).toBe("needs_you");
  });

  it("the helper side still means AHEAD of you by Scheduled", () => {
    expect(applied({ status: "in_progress", date_needed: day(2) })).toBe("scheduled");
    // helper_confirmed_at matters: an `accepted` application on a job the
    // helpr has not confirmed is THEIR move (needsHelperResponse), today or
    // not — which is the same rule the poster side states as "an unconfirmed
    // booking stays Waiting".
    expect(
      applied({ status: "accepted", date_needed: day(5), helper_confirmed_at: "2026-08-01T00:00:00Z" }),
    ).toBe("scheduled");
  });

  it("the helper side keeps submitted work in Waiting, even today", () => {
    // The helpr has done everything asked of them; today does not make it
    // their move again.
    expect(
      applied({
        status: "in_progress",
        date_needed: day(0),
        helper_completed_at: "2026-09-19T10:00:00Z",
        poster_completed_at: null,
      }),
    ).toBe("waiting");
  });

  it("both sides agree on today — one job never reads two things", () => {
    // The invariant the single-sided version of this file could not express.
    for (const status of ["in_progress", "accepted"]) {
      const job = { status, date_needed: day(0), helper_confirmed_at: "2026-08-01T00:00:00Z" };
      expect(postedActivityBucket(job), status).toBe(applied(job));
    }
  });

  it("today does not override whose move it is", () => {
    // An unconfirmed booking is the helpr's move, today or not.
    expect(
      postedActivityBucket({ status: "accepted", helper_confirmed_at: null, date_needed: day(0) }),
    ).toBe("waiting");
    // And a revision back in the helper's hands stays out of Needs You even on
    // the day itself — the 2026-08-28 bucket-jumping report.
    expect(
      postedActivityBucket({
        status: "in_progress",
        date_needed: day(0),
        helper_completed_at: "2026-08-01T00:00:00Z",
        revision_requested_at: "2026-08-02T00:00:00Z",
        poster_completed_at: null,
      }),
    ).toBe("scheduled");
  });
});

// The live-day rule itself: strip it and today's jobs fall back into the
// demoted Scheduled bucket on BOTH tabs — the owner's objection, come true.
// @mutate src/components/job-card/activityFilters.ts | return ms !== null && ms === todayMs(); | return false;
