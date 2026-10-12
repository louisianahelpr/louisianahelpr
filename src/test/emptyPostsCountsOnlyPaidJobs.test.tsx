/**
 * My Posts' empty state counts only the jobs My Posts can show.
 *
 * Seen on prod 2026-10-12 at 320, 375 and 1440 (helper-e2e, whose one posted
 * job is a SEED with payment_status 'abandoned'): every bucket was empty, yet
 * the page read "No jobs in this view — Try a different filter, there might
 * be jobs in another status." Never-paid jobs are dropped from every bucket
 * (jobIsUnfundedDraft, owner 2026-09-27: "Unpaid jobs should not show in post
 * anywhere"), but JobListPage handed the empty state the UNFILTERED
 * postedJobs.length, so it believed jobs were hiding under another filter.
 * Anyone who walked away from a checkout saw the same.
 *
 * Class: the count the empty state is given is the count the buckets were
 * built from (useActivityFilters' `all`), on both tabs.
 *
 * @mutate src/components/job-card/JobListPage.tsx |               postedJobsCount={postedCounts.all} |               postedJobsCount={postedJobs.length}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { useActivityFilters } from "@/components/job-card/activityFilters";
import { ActivityEmptyState } from "@/components/job-card/ActivityEmptyState";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";
import type { Job } from "@/components/job-card/activityConstants";

const PAGE = blankComments(readFileSync(resolve(__dirname, "../components/job-card/JobListPage.tsx"), "utf8"));

const job = (payment_status: string) =>
  ({ id: `j-${payment_status}`, title: "SEED Anchor bookcases", status: "open", payment_status, customer_id: "me", created_at: new Date().toISOString() }) as unknown as Job;

describe("My Posts' empty state counts only paid jobs", () => {
  it("JobListPage gives ActivityEmptyState the bucket total, never the raw list length", () => {
    const mounts = [...PAGE.matchAll(/<ActivityEmptyState[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(mounts.length).toBeGreaterThan(0);
    for (const m of mounts) {
      expect(m).toMatch(/postedJobsCount=\{postedCounts\.all\}/);
      expect(m).not.toMatch(/postedJobsCount=\{postedJobs\.length\}/);
    }
  });

  it.each([...NEVER_PAID_STATUSES])("a %s job is in no bucket and not in `all`", (ps) => {
    const { result } = renderHook(() =>
      useActivityFilters({ postedJobs: [job(ps)], appliedApps: [], statusFilter: "needs_you", searchQuery: "", userId: "me" }),
    );
    expect(result.current.postedCounts.all).toBe(0);
    expect(result.current.filteredPostedJobs).toHaveLength(0);
  });

  it("a paid job still counts", () => {
    const { result } = renderHook(() =>
      useActivityFilters({ postedJobs: [job("escrow")], appliedApps: [], statusFilter: "needs_you", searchQuery: "", userId: "me" }),
    );
    expect(result.current.postedCounts.all).toBe(1);
  });

  it("with that count, the page says nothing is posted, not 'try a different filter'", () => {
    render(
      <ActivityEmptyState tab="posted" loadError={false} postedJobsCount={0} appliedAppsCount={0} statusFilter="needs_you" hasSearch={false} onRetry={vi.fn()} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText("Nothing posted yet")).toBeInTheDocument();
    expect(screen.queryByText(/Try a different filter/)).toBeNull();
  });
});
