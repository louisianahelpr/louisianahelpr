import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useActivityFilters,
  APPLIED_STATUS_FILTERS,
  POSTED_STATUS_FILTERS,
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
    // The whole point of the change: My Jobs and My Posts lead with the same
    // word rather than one saying "Active" and the other "All".
    expect(defaultStatusFilterFor("applied")).toBe("active");
    expect(defaultStatusFilterFor("posted")).toBe("active");
  });

  it("offers Active on both tabs' filter menus", () => {
    // A default that isn't in the menu would leave the user unable to get back
    // to it after changing the filter.
    expect(APPLIED_STATUS_FILTERS.map((f) => f.key)).toContain("active");
    expect(POSTED_STATUS_FILTERS.map((f) => f.key)).toContain("active");
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
    expect(appliedCounts.all).toBe(3);
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
