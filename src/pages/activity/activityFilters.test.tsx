import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useActivityFilters,
  APPLIED_STATUS_FILTERS,
  POSTED_STATUS_FILTERS,
  appliedActivityBucket,
  postedActivityBucket,
  bucketAppliedApp,
} from "./activityFilters";
import { defaultStatusFilterFor } from "@/components/activity/activityConstants";
import type { AppliedApp } from "@/components/activity/activityConstants";

/**
 * Covers the "Active" bucket on the applied (My Jobs) tab.
 *
 * My Jobs used to default to "pending" — a single status — so a helper whose
 * applications had all been answered landed on an empty screen with their
 * whole history hidden behind a filter menu. Both tabs now default to the
 * "active" BUCKET instead, which is the distinction worth protecting: a bucket
 * spans several statuses, so it degrades gracefully as items settle.
 *
 * These are written against the real hook rather than the bucket helper alone,
 * because the bug that started all this was in the wiring (which filter the
 * page opens on and what it counts), not in the classification.
 */

const HELPER = "helper-1";

function app(over: Partial<AppliedApp> & { status: string; jobStatus?: string }): AppliedApp {
  const { jobStatus = "open", ...rest } = over;
  return {
    id: `app-${Math.abs(jobStatus.length * 7 + rest.status.length)}-${rest.status}-${jobStatus}`,
    job_id: `job-${rest.status}-${jobStatus}`,
    helper_id: HELPER,
    created_at: "2026-08-01T00:00:00Z",
    ...rest,
    job: {
      id: `job-${rest.status}-${jobStatus}`,
      title: "Mow the lawn",
      description: "Front and back",
      location: "Lafayette, LA",
      status: jobStatus,
      helper_confirmed_at: null,
      offered_to_helper_id: null,
      direct_offer_status: null,
    },
  } as unknown as AppliedApp;
}

function run(apps: AppliedApp[], statusFilter: string) {
  return renderHook(() =>
    useActivityFilters({
      postedJobs: [],
      appliedApps: apps,
      statusFilter,
      searchQuery: "",
      userId: HELPER,
    }),
  ).result.current;
}

describe("Activity — the Active bucket", () => {
  it("both tabs open on the same filter", () => {
    // My Jobs and My Posts lead with the same word. That word is now
    // "Needs you" rather than "Active" — see defaultStatusFilterFor — but the
    // invariant this guards is unchanged: the two tabs must not disagree.
    expect(defaultStatusFilterFor("applied")).toBe(defaultStatusFilterFor("posted"));
  });

  it("offers the default on both tabs' filter menus", () => {
    // A default that isn't in the menu would leave the user unable to get back
    // to it after changing the filter. Asserted against the default itself
    // rather than a hardcoded key, so renaming the buckets can never silently
    // strand the one the page opens on.
    const fallback = defaultStatusFilterFor("applied");
    expect(APPLIED_STATUS_FILTERS.map((f) => f.key)).toContain(fallback);
    expect(POSTED_STATUS_FILTERS.map((f) => f.key)).toContain(fallback);
  });

  it("keeps live applications and drops settled ones", () => {
    const apps = [
      app({ status: "pending", jobStatus: "open" }),        // applied, awaiting
      app({ status: "accepted", jobStatus: "in_progress" }), // working
      app({ status: "rejected", jobStatus: "open" }),        // not selected
      app({ status: "accepted", jobStatus: "completed" }),   // done
      app({ status: "pending", jobStatus: "cancelled" }),    // job pulled
    ];
    const { filteredAppliedApps } = run(apps, "active");
    expect(filteredAppliedApps).toHaveLength(2);
    expect(filteredAppliedApps.every((a) => bucketAppliedApp(a) === "active")).toBe(true);
  });

  it("counts Active without stealing rows from the single-status counters", () => {
    // `active` overlaps pending/accepted/in_progress, so it is counted on its
    // own line rather than inside the else-if chain. If it ever joins that
    // chain, these single-status counts silently drop to zero.
    const apps = [
      app({ status: "pending", jobStatus: "open" }),
      app({ status: "accepted", jobStatus: "in_progress" }),
      app({ status: "rejected", jobStatus: "open" }),
    ];
    const { appliedCounts } = run(apps, "active");
    expect(appliedCounts.active).toBe(2);
    expect(appliedCounts.pending).toBe(1);
    expect(appliedCounts.in_progress).toBe(1);
    expect(appliedCounts.not_selected).toBe(1);
    // "All" deliberately EXCLUDES not-selected (b7576a36) — a rejected
    // application is not something you still have. So 3 applications, 2 in
    // All. This assertion said 3 and was left behind when that changed.
    expect(appliedCounts.all).toBe(2);
  });

  it("goes empty when every application has settled — with the others still counted", () => {
    // Exactly the reported account: four applications, every underlying job
    // cancelled. Active is legitimately empty; there is deliberately no
    // fallback, so the empty state has to be the thing that points onward —
    // it reads the non-zero counts below.
    const apps = [
      app({ status: "pending", jobStatus: "cancelled" }),
      app({ status: "pending", jobStatus: "cancelled" }),
      app({ status: "accepted", jobStatus: "cancelled" }),
      app({ status: "rejected", jobStatus: "cancelled" }),
    ];
    const { filteredAppliedApps, appliedCounts } = run(apps, "active");
    expect(filteredAppliedApps).toHaveLength(0);
    expect(appliedCounts.active).toBe(0);
    expect(appliedCounts.not_selected).toBe(4);
  });
});

describe("Activity — whose move is it", () => {
  // The four buckets have to be EXHAUSTIVE and MUTUALLY EXCLUSIVE — that is
  // what let the old catch-all "All" chip and the per-card status band both
  // come off. A state that lands in none of them is a job the user can no
  // longer find; a state that lands in two is a count that lies.
  it("puts an offer held for the helpr in Needs you", () => {
    expect(appliedActivityBucket(app({ status: "accepted", jobStatus: "accepted" }))).toBe("needs_you");
  });

  it("puts an application awaiting a decision in Waiting", () => {
    expect(appliedActivityBucket(app({ status: "pending", jobStatus: "open" }))).toBe("waiting");
  });

  it("puts work underway in Scheduled", () => {
    expect(appliedActivityBucket(app({ status: "accepted", jobStatus: "in_progress" }))).toBe("scheduled");
  });

  it("puts a dispute in Needs you — the card carries Respond to Dispute", () => {
    expect(appliedActivityBucket(app({ status: "accepted", jobStatus: "disputed" }))).toBe("needs_you");
  });

  it("puts submitted-but-unapproved work in Waiting — the ball is with the poster", () => {
    const a = app({ status: "accepted", jobStatus: "in_progress" });
    (a.job as { helper_completed_at?: string | null }).helper_completed_at = "2026-08-01T00:00:00Z";
    (a.job as { poster_completed_at?: string | null }).poster_completed_at = null;
    expect(appliedActivityBucket(a)).toBe("waiting");
  });

  it("puts a completed job in Done and a rejection in its own Cancelled bucket", () => {
    // Cancelled is a separate terminal bucket from Done (product direction,
    // 2026-08-30) — a rejection/cancellation did not "finish" the way a
    // completed job did, so it no longer folds into the same tab.
    expect(appliedActivityBucket(app({ status: "rejected", jobStatus: "open" }))).toBe("cancelled");
    expect(appliedActivityBucket(app({ status: "accepted", jobStatus: "completed" }))).toBe("done");
  });

  it("puts an application whose job row never arrived in Cancelled, not Waiting", () => {
    // REGRESSION (found 2026-09-05, live in prod: 15 rows across 10 helpers).
    // `get_jobs_for_my_applications` hands a helper a job only when
    // customer_id = me, helper_id = me, status = 'open', or they are on the
    // group roster. A job CANCELLED BEFORE ANYONE WAS HIRED matches none of
    // them, so `app.job` is null — and a null job used to fall through every
    // branch to the "Applied, awaiting their decision" default and sit in
    // Waiting forever, inflating that tab's count with rows the card itself
    // was already rendering as "Job no longer available".
    //
    // `status: "pending"` is the point: the application really is still
    // pending in the database, and deliberately stays that way. The bucket,
    // not the row, is what had to learn that a vanished job is a dead end.
    const orphaned = app({ status: "pending", jobStatus: "open" });
    (orphaned as { job?: unknown }).job = null;
    expect(appliedActivityBucket(orphaned)).toBe("cancelled");

    const undef = app({ status: "pending", jobStatus: "open" });
    (undef as { job?: unknown }).job = undefined;
    expect(appliedActivityBucket(undef)).toBe("cancelled");
  });

  it("separates an open job WITH applicants from one without", () => {
    // The distinction the whole `applicantCount` argument exists for: a queue
    // of people waiting on a reply is the poster's move, an empty one is not.
    expect(postedActivityBucket({ status: "open" }, 3)).toBe("needs_you");
    expect(postedActivityBucket({ status: "open" }, 0)).toBe("waiting");
  });

  it("puts submitted-but-unapproved work in Needs you, not Scheduled", () => {
    // The exact case the owner reported: the helpr finished, the job still
    // reads `in_progress`-ish, and the poster has a decision in front of them.
    expect(
      postedActivityBucket({
        status: "in_progress",
        helper_completed_at: "2026-08-01T00:00:00Z",
        poster_completed_at: null,
      }),
    ).toBe("needs_you");
  });

  it("never leaves a past-due job in Scheduled", () => {
    // THE OWNER'S REPORT (2026-08-31): "These jobs were posted for Aug 27 still
    // marked under scheduled?" Twelve prod jobs were `in_progress` with
    // date_needed 1-4 days in the past and all twelve sat under Scheduled —
    // the one bucket that means "agreed and upcoming".
    //
    // Dates are built in the PLATFORM's zone, the same way jobDate.test.ts
    // does it, so the assertion does not flip with the runner's timezone.
    const fmt = (offsetDays: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(Date.now() + offsetDays * 86_400_000));

    // Underway, day gone, nobody finished it — the poster's move.
    expect(postedActivityBucket({ status: "in_progress", date_needed: fmt(-4) })).toBe("needs_you");
    // Booked and confirmed but the day passed without it ever starting.
    expect(
      postedActivityBucket({ status: "accepted", helper_confirmed_at: "2026-08-01T00:00:00Z", date_needed: fmt(-1) }),
    ).toBe("needs_you");
    // Still open, day gone, nobody applied — also the poster's move, where it
    // used to read as "waiting" for applicants who can no longer come.
    expect(postedActivityBucket({ status: "open", date_needed: fmt(-2) }, 0)).toBe("needs_you");

    // DAY granularity, not minute: today is never overdue, however late it is.
    expect(postedActivityBucket({ status: "in_progress", date_needed: fmt(0) })).toBe("scheduled");
    expect(postedActivityBucket({ status: "in_progress", date_needed: fmt(1) })).toBe("scheduled");

    // Terminal states are unaffected — there is nothing left to chase.
    expect(postedActivityBucket({ status: "completed", date_needed: fmt(-9) })).toBe("done");
    expect(postedActivityBucket({ status: "cancelled", date_needed: fmt(-9) })).toBe("cancelled");

    // And the helper side agrees, so one job never reads Scheduled to one
    // party and overdue to the other...
    expect(
      appliedActivityBucket({
        status: "accepted",
        job: { status: "in_progress", date_needed: fmt(-3) },
      } as never),
    ).toBe("needs_you");
    // ...except where the helpr has already submitted: that is the poster's
    // move, and asking the helpr for a second thing they cannot give is wrong.
    expect(
      appliedActivityBucket({
        status: "accepted",
        job: {
          status: "in_progress",
          date_needed: fmt(-3),
          helper_completed_at: "2026-08-01T00:00:00Z",
          poster_completed_at: null,
        },
      } as never),
    ).toBe("waiting");
  });

  it("puts a booking the helpr hasn't confirmed in Waiting", () => {
    expect(postedActivityBucket({ status: "accepted", helper_confirmed_at: null })).toBe("waiting");
    expect(postedActivityBucket({ status: "accepted", helper_confirmed_at: "2026-08-01T00:00:00Z" })).toBe("scheduled");
  });

  it("puts Completed in Done and Cancelled in its own bucket", () => {
    expect(postedActivityBucket({ status: "completed" })).toBe("done");
    expect(postedActivityBucket({ status: "cancelled" })).toBe("cancelled");
  });

  it("releases a job from Needs you once a revision sends the work back", () => {
    // THE BUCKET-JUMPING BUG (owner, 2026-08-28: "My post jumps a lot between
    // needs you and scheduled").
    //
    // `helper_completed_at` is deliberately NOT cleared when the poster asks
    // for changes — it is a record of what happened, and JobTracking makes the
    // same allowance in the progress tracker. But the bucket read the bare
    // stamp as "a submission is waiting on me", so once a revision round-trip
    // finished the job was pinned to Needs you forever, and any write that
    // arrived without the field flipped it to Scheduled and back.
    const submitted = "2026-08-01T00:00:00Z";
    const sentBack = "2026-08-02T00:00:00Z";
    const resubmitted = "2026-08-03T00:00:00Z";

    // Work is back with the helpr: nothing is on the poster's desk.
    expect(
      postedActivityBucket({
        status: "in_progress",
        helper_completed_at: submitted,
        revision_requested_at: sentBack,
        poster_completed_at: null,
      }),
    ).toBe("scheduled");

    // Re-submitted AFTER the revision — the poster owes a decision again.
    expect(
      postedActivityBucket({
        status: "in_progress",
        helper_completed_at: resubmitted,
        revision_requested_at: sentBack,
        poster_completed_at: null,
      }),
    ).toBe("needs_you");

    // The revision itself is still the poster's move while it is open.
    expect(
      postedActivityBucket({
        status: "revision_requested",
        helper_completed_at: submitted,
        revision_requested_at: sentBack,
      }),
    ).toBe("needs_you");

    // A job that never had a revision is unchanged by any of this.
    expect(
      postedActivityBucket({
        status: "in_progress",
        helper_completed_at: submitted,
        poster_completed_at: null,
      }),
    ).toBe("needs_you");

    // An unparseable stamp falls through to the old behaviour — ask for a
    // look rather than silently hide submitted work.
    expect(
      postedActivityBucket({
        status: "in_progress",
        helper_completed_at: submitted,
        revision_requested_at: "not a date",
        poster_completed_at: null,
      }),
    ).toBe("needs_you");
  });

  it("counts only applications still awaiting a decision", () => {
    // The second half of the jumping report. The count fed here used to be
    // EVERY application ever filed, so an open job whose applicants had all
    // been declined kept insisting it needed the poster — a decision they had
    // already made. The caller now passes the pending-only count; this pins
    // the contract that the argument means "awaiting me", not "ever applied".
    expect(postedActivityBucket({ status: "open" }, 2)).toBe("needs_you");
    expect(postedActivityBucket({ status: "open" }, 0)).toBe("waiting");
  });
});
