import { useEffect } from "react";

/**
 * "Only saved jobs" lists only the saved jobs on pages already loaded (Q1739).
 * A saved job further down the feed never showed: the list said "Nothing
 * saved yet" while the server count knew it was there. So while the toggle is
 * on and the server's count of matching saved jobs is above what is listed,
 * the next page is read, until the list reaches that count or the feed ends.
 *
 * Bounded by the server count, not "until found": it never pages for a saved
 * job the viewer will not be shown (closed, filled, applied to, dismissed,
 * blocked poster), because the count already leaves those out. `serverCount`
 * is null whenever a filter only the client can apply is narrowing the feed
 * (useDashboardFilters' totalMatchingCount), and then nothing is paged.
 *
 * Driven by state, not by the load-more sentinel: the sentinel only fires on
 * scroll into view and only re-attaches when its inputs change, which is why
 * the first attempt at this (withdrawn in the Q1701 branch) never started.
 */
export interface SavedOnlyPagingInput {
  savedOnly: boolean;
  listedCount: number;
  serverCount: number | null | undefined;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
}

export function shouldReadNextSavedPage(i: SavedOnlyPagingInput): boolean {
  if (!i.savedOnly) return false;
  if (typeof i.serverCount !== "number") return false;
  if (i.listedCount >= i.serverCount) return false;
  return i.hasNextPage === true && !i.isFetchingNextPage;
}

export function useSavedOnlyPaging(i: SavedOnlyPagingInput & { fetchNextPage: () => unknown }): void {
  const go = shouldReadNextSavedPage(i);
  const { fetchNextPage } = i;
  useEffect(() => {
    if (go) void fetchNextPage();
  }, [go, fetchNextPage]);
}
