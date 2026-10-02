/**
 * A search miss on My Posts / My Jobs names the buckets that DO hold matches.
 * OPEN.md: "My Posts search only searches the active status tab and tells the
 * user the job doesn't exist". The search narrows the bucket on screen, so a
 * job sitting in another bucket read as "No jobs match your search", which is
 * false. The empty state now counts search matches per bucket and offers a
 * jump that lands on them (query kept), instead of the generic line.
 *
 * Written against the real hook and the real empty state, because the bug was
 * in the wiring: the empty state only had PRE-search bucket counts.
 *
 * @mutate src/components/job-card/activityFilters.ts | if (!appliedAppMatchesSearch(a, searchLower)) return; |
 * @mutate src/components/job-card/activityFilters.ts | if (!postedJobMatchesSearch(j, searchLower)) return; |
 * @mutate src/components/job-card/ActivityEmptyState.tsx | ? (searchElsewhereLine | ? (false
 * @mutate src/components/job-card/ActivityEmptyState.tsx | hasSearch && searchJumpTo && onSelectStatusFilter ? ( | false ? (
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  useActivityFilters,
  APPLIED_STATUS_FILTERS,
  POSTED_STATUS_FILTERS,
  appliedActivityBucket,
  postedActivityBucket,
} from "./activityFilters";
import { ActivityEmptyState } from "./ActivityEmptyState";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const HELPER = "helper-1";

function app(id: string, title: string, status: string, jobStatus: string): AppliedApp {
  return {
    id,
    job_id: `job-${id}`,
    helper_id: HELPER,
    status,
    created_at: "2026-08-01T00:00:00Z",
    job: {
      id: `job-${id}`,
      title,
      description: "Details",
      location: "Lafayette, LA",
      status: jobStatus,
      helper_confirmed_at: null,
      offered_to_helper_id: null,
      direct_offer_status: null,
    },
  } as unknown as AppliedApp;
}

function job(id: string, title: string, status: string): Job {
  return {
    id,
    title,
    description: "Details",
    location: "Lafayette, LA",
    customer_id: "poster-1",
    status,
    payment_status: "escrow",
    date_needed: "2026-08-01",
    created_at: "2026-07-20T00:00:00Z",
    expires_at: "2030-01-01T00:00:00Z",
    helper_confirmed_at: null,
    offered_to_helper_id: null,
    direct_offer_status: null,
  } as unknown as Job;
}

function renderEmpty(tab: "posted" | "applied", statusFilter: string, counts: Record<string, number>, onSelect = vi.fn()) {
  render(
    <MemoryRouter>
      <ActivityEmptyState
        tab={tab}
        loadError={false}
        postedJobsCount={2}
        appliedAppsCount={2}
        statusFilter={statusFilter}
        hasSearch
        statusCounts={{}}
        statusLabels={tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS}
        searchMatchCounts={counts}
        onRetry={vi.fn()}
        onNavigate={vi.fn()}
        onSelectStatusFilter={onSelect}
        onClearSearch={vi.fn()}
      />
    </MemoryRouter>,
  );
  return onSelect;
}

const labelOf = (key: string) => APPLIED_STATUS_FILTERS.find((f) => f.key === key)!.label;

describe("a search miss names the buckets that hold matches", () => {
  it("My Jobs: the match in another bucket is named, and the jump lands on it", () => {
    const mow = app("a1", "Mow the lawn", "pending", "open");
    const paint = app("a2", "Paint the fence", "accepted", "completed");
    const here = appliedActivityBucket(mow);
    const there = appliedActivityBucket(paint);
    expect(here).not.toBe(there);

    const onBucket = (statusFilter: string) =>
      renderHook(() => useActivityFilters({ postedJobs: [], appliedApps: [mow, paint], statusFilter, searchQuery: "paint", userId: HELPER })).result.current;

    const r = onBucket(here);
    expect(r.filteredAppliedApps).toHaveLength(0);
    expect(r.appliedSearchCounts).toEqual({ [there]: 1 });

    const onSelect = renderEmpty("applied", here, r.appliedSearchCounts);
    expect(screen.getByText(new RegExp(`1 in ${labelOf(there)} matches your search`, "i"))).toBeTruthy();
    expect(screen.queryByText(/no jobs match your search/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Show ${labelOf(there)} \\(1\\)`, "i") }));
    expect(onSelect).toHaveBeenCalledWith(there);

    // The jump keeps the query and shows the match it promised.
    expect(onBucket(there).filteredAppliedApps.map((a) => a.id)).toEqual(["a2"]);
  });

  it("My Posts: counts only the jobs that match the search", () => {
    const open = job("j1", "Mow the lawn", "open");
    const done = job("j2", "Paint the fence", "completed");
    const openBucket = postedActivityBucket(open, 0, Date.now());
    const doneBucket = postedActivityBucket(done, 0, Date.now());
    expect(openBucket).not.toBe(doneBucket);
    const r = renderHook(() =>
      useActivityFilters({ postedJobs: [open, done], appliedApps: [], statusFilter: openBucket, searchQuery: "paint", userId: HELPER }),
    ).result.current;
    expect(r.filteredPostedJobs).toHaveLength(0);
    expect(r.postedSearchCounts).toEqual({ [doneBucket]: 1 });
  });

  it("control: no match anywhere keeps the generic line and Clear search", () => {
    renderEmpty("applied", "waiting", {});
    expect(screen.getByText(/no jobs match your search/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear search/i })).toBeTruthy();
  });
});
