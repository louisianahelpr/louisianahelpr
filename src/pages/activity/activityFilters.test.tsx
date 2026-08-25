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

  it("puts a rejection and a completed job in Done", () => {
    expect(appliedActivityBucket(app({ status: "rejected", jobStatus: "open" }))).toBe("done");
    expect(appliedActivityBucket(app({ status: "accepted", jobStatus: "completed" }))).toBe("done");
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

  it("puts a booking the helpr hasn't confirmed in Waiting", () => {
    expect(postedActivityBucket({ status: "accepted", helper_confirmed_at: null })).toBe("waiting");
    expect(postedActivityBucket({ status: "accepted", helper_confirmed_at: "2026-08-01T00:00:00Z" })).toBe("scheduled");
  });

  it("puts both terminal states in Done", () => {
    expect(postedActivityBucket({ status: "completed" })).toBe("done");
    expect(postedActivityBucket({ status: "cancelled" })).toBe("done");
  });
});
