/**
 * Q2392 (lead 2026-10-25, item 7): Jobs > Browse leaves the viewer's own open jobs out by design
 * (get_ranked_open_jobs / get_open_jobs_for_map; measured 2026-10-25: 3 open jobs, all the owner's, so the owner's
 * Browse read 0 with an empty map and no word why). The UNFILTERED empty state now says where they are, with a link to
 * Jobs > Posted; a filtered empty state, a viewer with no open jobs, and a failed count say nothing extra.
 *
 * Rendered through the real BrowseTasksFeed empty branch, with the Supabase client doubled at the query it makes.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | footnote={filters.hasFilters ? undefined : <OwnOpenJobsNote userId={user?.id} />} | footnote={undefined}
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | footnote={filters.hasFilters ? undefined : <OwnOpenJobsNote userId={user?.id} />} | footnote={<OwnOpenJobsNote userId={user?.id} />}
 * @mutate src/components/dashboard/OwnOpenJobsNote.tsx |         .eq("status", "open"); |         ;
 * @mutate src/components/dashboard/OwnOpenJobsNote.tsx |   if (count <= 0) return null; |   if (count < 0) return null;
 * @mutate src/components/dashboard/OwnOpenJobsNote.tsx |       unwrap(res);\n      return res.count ?? 0; |       return res.count ?? 1;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const answer: { count: number | null; error: { message: string } | null } = { count: 0, error: null };
const filtersSeen: Array<[string, unknown]> = [];
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filtersSeen.push([col, val]);
      return chain;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, count: answer.count, error: answer.error }).then(res),
  };
  return { supabase: { from: (t: string) => (t === "jobs" ? chain : null) } };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: null }) }));
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null }) }));
vi.mock("@/hooks/useNotifyWhenWorkLands", () => ({ useNotifyWhenWorkLands: () => vi.fn() }));
vi.mock("@/components/dashboard/EmptyFeedActions", () => ({ EmptyFeedActions: () => null }));

import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";

beforeEach(() => {
  answer.count = 0;
  answer.error = null;
  filtersSeen.length = 0;
});
afterEach(cleanup);

function renderEmptyFeed(hasFilters = false) {
  const filters = {
    filteredJobs: [], nearbyJobs: [], hasFilters, sortBy: "smart", userLoc: null, nearbyMiles: null,
    locationFilter: "all", boostedOnly: false, mapFilter: "all", searchQuery: hasFilters ? "zzz" : "",
    activeFilterCount: 0, nearbyApplied: false, clearFilters: vi.fn(), setLocationFilter: vi.fn(),
  };
  const noop = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BrowseTasksFeed
          view="list" density={"comfortable" as never} filters={filters as never} user={{ id: "user-1" } as never}
          allJobs={[]} loadError={false} offline={false} refresh={noop} recommendedJobs={[]} recommendedLoading={false}
          effectiveFee={10} handleApplyRequest={noop} handleDismissRequest={noop} handleToggleSave={noop}
          expandedCardId={null} setExpandedCardId={noop} savedJobIds={new Set()} setReportJobId={noop} setDetailJob={noop}
          containerRef={{ current: null }} pullDistance={0} refreshing={false} isPulling={false}
          loadMoreRef={{ current: null }} hasNextPage={false} isFetchingNextPage={false} fetchNextPage={noop}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Jobs > Browse's empty state names where the viewer's own open jobs are (Q2392)", () => {
  it("two open jobs of your own: the line and a link to Posted, from a count of YOUR OPEN jobs", async () => {
    answer.count = 2;
    renderEmptyFeed();
    expect(screen.getByText("No jobs near you right now.")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "See them under Posted" });
    expect(link.getAttribute("href")).toBe("/jobs?tab=posted");
    expect(screen.getByText(/Your 2 open jobs don't show here\./)).toBeTruthy();
    expect(filtersSeen).toEqual(expect.arrayContaining([["customer_id", "user-1"], ["status", "open"]]));
  });

  it("one open job reads in the singular", async () => {
    answer.count = 1;
    renderEmptyFeed();
    expect(await screen.findByRole("link", { name: "See it under Posted" })).toBeTruthy();
    expect(screen.getByText(/Your own open job doesn't show here\./)).toBeTruthy();
  });

  it("no open jobs of your own, a failed count, or a filtered empty state: no extra line", async () => {
    answer.count = 0;
    renderEmptyFeed();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-own-open-jobs]")).toBeNull();
    cleanup();

    answer.count = null;
    answer.error = { message: "boom" };
    renderEmptyFeed();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-own-open-jobs]")).toBeNull();
    cleanup();

    answer.count = 3;
    answer.error = null;
    renderEmptyFeed(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-own-open-jobs]")).toBeNull();
  });
});
