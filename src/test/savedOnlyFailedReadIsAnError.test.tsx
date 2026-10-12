/**
 * A failed saved-jobs read is an ERROR on the saved-only feed, never "Nothing
 * saved yet" (Q1701, found by the Q1644 review, lh-silent-failure@bd92a4678#1).
 *
 * useDashboardSideQueries kept only `data` from the saved-ids query, so when
 * the read threw, savedJobIds stayed an empty Set and the saved-only feed drew
 * the "Nothing saved yet" empty state with no retry: a person whose read failed
 * was told they had saved nothing. Two layers carry the fix and both are held
 * here: the hook says the read failed (with a retry), and the feed draws
 * ErrorState with that retry for it.
 *
 * Also held (lh-silent-failure review of this fix): an optimistic save while
 * the read is failed must not seed the cache with a one-item "success" list
 * (optimisticSavedIds), a failed refetch after one good read keeps the good
 * list, and the retry button is disabled while the re-read runs.
 *
 * @mutate src/pages/home/useDashboardSideQueries.ts | failed: savedJobsError && savedJobsData === undefined, | failed: false,
 * @mutate src/pages/home/useDashboardSideQueries.ts | failed: savedJobsError && savedJobsData === undefined, | failed: savedJobsError,
 * @mutate src/components/dashboard/SavedOnlyState.tsx | {savedRead?.failed ? ( | {false ? (
 * @mutate src/components/dashboard/SavedOnlyState.tsx | retryDisabled={savedRead.retrying} | retryDisabled={false}
 * @mutate src/pages/home/optimisticSavedIds.ts |   if (prev === undefined) return undefined; |   if (prev === undefined) prev = [];
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: null }) }));
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null }) }));

// The hook's two queries, answered per key. The saved-ids answer is set per
// test (default: the read FAILED with nothing read); the upcoming-job read is
// irrelevant here.
const refetchSaved = vi.fn();
const savedAnswer: { data: string[] | undefined; isError: boolean; isFetching: boolean } = {
  data: undefined, isError: true, isFetching: false,
};
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) =>
    JSON.stringify(opts.queryKey).includes("aved")
      ? { ...savedAnswer, refetch: refetchSaved }
      : { data: null, isError: false, isFetching: false, refetch: vi.fn() },
}));

import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { useDashboardSideQueries } from "@/pages/home/useDashboardSideQueries";
import { optimisticSavedIds } from "@/pages/home/optimisticSavedIds";

afterEach(() => {
  cleanup();
  Object.assign(savedAnswer, { data: undefined, isError: true, isFetching: false });
  refetchSaved.mockClear();
});

function job(tag: string): EnrichedJob {
  return {
    id: `id-${tag}`,
    title: `JOB ${tag}`,
    description: `Task ${tag} description, long enough to render.`,
    category: "cleaning",
    budget: 100,
    date_needed: jobLocalDateISO(5),
    location: "New Orleans, LA",
    customer_id: "poster-1",
    status: "open",
    created_at: new Date().toISOString(),
    is_urgent: false,
    pricing_mode: "set_price",
  } as EnrichedJob;
}

function renderFeed(opts: {
  savedLoadFailed: boolean;
  savedJobIds: Set<string>;
  retrySaved?: () => void;
  savedRetrying?: boolean;
}) {
  const filters = {
    filteredJobs: [] as EnrichedJob[],
    nearbyJobs: [],
    hasFilters: false,
    sortBy: "smart",
    userLoc: null,
    nearbyMiles: null,
    locationFilter: "all",
    boostedOnly: false,
    mapFilter: "all",
    clearFilters: vi.fn(),
    setLocationFilter: vi.fn(),
  };
  const noop = vi.fn();
  render(
    <MemoryRouter>
      <BrowseTasksFeed
        view="list"
        density={"compact" as never}
        filters={filters as never}
        user={{ id: "viewer-1" } as never}
        // The feed itself loaded (other jobs exist); only the saved read differs.
        allJobs={[job("a"), job("b")]}
        loadError={false}
        refresh={noop}
        recommendedJobs={[]}
        recommendedLoading={false}
        savedOnly
        savedRead={{ failed: opts.savedLoadFailed, onRetry: opts.retrySaved ?? noop, retrying: opts.savedRetrying ?? false }}
        savedJobIds={opts.savedJobIds}
        effectiveFee={10}
        handleApplyRequest={noop}
        handleDismissRequest={noop}
        handleToggleSave={noop}
        expandedCardId={null}
        setExpandedCardId={noop}
        setReportJobId={noop}
        setDetailJob={noop}
        containerRef={{ current: null }}
        pullDistance={0}
        refreshing={false}
        isPulling={false}
        loadMoreRef={{ current: null }}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={noop}
      />
    </MemoryRouter>,
  );
}

describe("saved-only feed: a failed saved read is an error with a retry (Q1701)", () => {
  it("the hook reports a failed saved-ids read and retries it", () => {
    const { result } = renderHook(() => useDashboardSideQueries({ userId: "viewer-1", allJobs: [] }));
    expect(result.current.savedRead.failed).toBe(true);
    expect(result.current.savedJobIds.size).toBe(0);
    result.current.savedRead.onRetry();
    expect(refetchSaved).toHaveBeenCalledTimes(1);
  });

  it("the feed draws ErrorState with a retry, never 'Nothing saved yet'", () => {
    const retry = vi.fn();
    renderFeed({ savedLoadFailed: true, savedJobIds: new Set(), retrySaved: retry });
    expect(screen.queryByText("Nothing saved yet")).toBeNull();
    expect(screen.getByText("We couldn't load your saved jobs.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("a good read with nothing saved is still the empty state (no false alarm)", () => {
    renderFeed({ savedLoadFailed: false, savedJobIds: new Set() });
    expect(screen.getByText("Nothing saved yet")).toBeTruthy();
    expect(screen.queryByText("We couldn't load your saved jobs.")).toBeNull();
  });

  it("a failed REFETCH after one good read keeps the good list (not an error)", () => {
    Object.assign(savedAnswer, { data: ["id-a"], isError: true });
    const { result } = renderHook(() => useDashboardSideQueries({ userId: "viewer-1", allJobs: [] }));
    expect(result.current.savedRead.failed).toBe(false);
    expect([...result.current.savedJobIds]).toEqual(["id-a"]);
  });

  it("the retry button is disabled while the re-read runs", () => {
    Object.assign(savedAnswer, { isFetching: true });
    const { result } = renderHook(() => useDashboardSideQueries({ userId: "viewer-1", allJobs: [] }));
    expect(result.current.savedRead.retrying).toBe(true);
    const retry = vi.fn();
    renderFeed({ savedLoadFailed: true, savedJobIds: new Set(), retrySaved: retry, savedRetrying: true });
    const button = screen.getByRole("button", { name: /try again/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("an optimistic save never turns a failed read into a one-item list", () => {
    expect(optimisticSavedIds(undefined, "id-new", true)).toBeUndefined();
    expect(optimisticSavedIds(undefined, "id-new", false)).toBeUndefined();
    expect(optimisticSavedIds(["id-a"], "id-new", true)).toEqual(["id-a", "id-new"]);
    expect(optimisticSavedIds(["id-a", "id-new"], "id-new", false)).toEqual(["id-a"]);
    expect(optimisticSavedIds(["id-a"], "id-a", true)).toEqual(["id-a"]);
  });

  it("useSaveJob's optimistic update goes through that guard", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/home/useSaveJob.ts"), "utf8"));
    expect(src).toMatch(/setQueryData<string\[\] \| undefined>\(queryKeys\.dashboard\.savedJobs\(userId\), \(prev\) =>\s*optimisticSavedIds\(prev, jobId, saved\)\)/);
  });
});
