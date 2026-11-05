import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followedBucket, useFollowOpenCard } from "./useFollowOpenCard";
import { appliedActivityBucket } from "./activityFilters";
import type { AppliedApp } from "./activityConstants";

// @mutate src/components/job-card/useFollowOpenCard.ts |     if (was === filter && is && is !== filter) return is; |     if (was === filter && is && is !== filter) return null;
// e2e-journeys 41728838626 (11-03): the Helpr's revision job opened under Waiting from a deep link, the list then
// refreshed it into Needs you, and the open card vanished because the Waiting filter stayed selected.
const JOB = "job-1";
const app = (job: Record<string, unknown>) =>
  ({ id: "app-1", job_id: JOB, status: "accepted", job: { id: JOB, payment_status: "held", ...job } }) as unknown as AppliedApp;
const submitted = app({ status: "in_progress", helper_completed_at: "2026-11-03T22:00:00Z", poster_completed_at: null });
const revision = app({ status: "revision_requested", helper_completed_at: null });

describe("an open card follows its job into its new bucket", () => {
  it("fixtures sit in the buckets the journey saw", () => {
    expect(appliedActivityBucket(submitted)).toBe("waiting");
    expect(appliedActivityBucket(revision)).toBe("needs_you");
  });

  it("switches the selected bucket when the open card's job moves out of it", () => {
    const setStatusFilter = vi.fn();
    const base = { tab: "applied" as const, postedJobs: [], expandedJobIds: new Set([JOB]), statusFilter: "waiting", setStatusFilter };
    const { rerender } = renderHook((p: { apps: AppliedApp[] }) => useFollowOpenCard({ ...base, appliedApps: p.apps }), {
      initialProps: { apps: [submitted] },
    });
    expect(setStatusFilter).not.toHaveBeenCalled();
    rerender({ apps: [revision] });
    expect(setStatusFilter).toHaveBeenCalledWith("needs_you");
  });

  it("leaves the filter alone for a shut card, on All, or for a card that was not showing", () => {
    const was = new Map([[JOB, "waiting"]]);
    const now = new Map([[JOB, "needs_you"]]);
    expect(followedBucket(was, new Set(), now, "waiting")).toBeNull();
    expect(followedBucket(was, new Set([JOB]), now, "all")).toBeNull();
    expect(followedBucket(was, new Set([JOB]), now, "done")).toBeNull();
    expect(followedBucket(was, new Set([JOB]), new Map(), "waiting")).toBeNull();
    expect(followedBucket(was, new Set([JOB]), now, "waiting")).toBe("needs_you");
  });

  it("the Jobs list page uses it", () => {
    const page = readFileSync(join(__dirname, "JobListPage.tsx"), "utf8");
    expect(page).toMatch(/useFollowOpenCard\(\{[^}]*expandedJobIds: actions\.expandedJobIds[^}]*statusFilter, setStatusFilter \}\)/);
  });
});
