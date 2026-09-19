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
} from "./activityFilters";

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
