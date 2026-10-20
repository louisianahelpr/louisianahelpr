/**
 * The Jobs Browse empty state's words when filters (or a search) leave nothing,
 * for the signed-in feed (BrowseTasksFeed) and the guest one (DashboardGuest).
 *
 * Cowork design audit 2026-10-20, J10: a typed search with no hits said "No
 * jobs match your filters." and offered "Clear Filters", although the person
 * had set no filter, only typed a word. A search is named as a search, with the
 * word they typed, and its way out is "Clear search".
 * Guard: src/lib/browseEmptyCopy.test.ts.
 */
export interface BrowseEmptyInputs {
  searchQuery: string;
  /** useDashboardFilters' count, which counts a typed search as one filter. */
  activeFilterCount: number;
  nearbyActive: boolean;
  currentMiles: number;
  nextMiles: number;
}

export interface BrowseEmptyCopy {
  title: string;
  body: string;
  /** The label of the button that clears what is narrowing the feed. */
  clearLabel: string;
}

export function browseFilteredEmptyCopy(i: BrowseEmptyInputs): BrowseEmptyCopy {
  const q = i.searchQuery.trim();
  const searchOnly = !!q && i.activeFilterCount <= 1;
  if (searchOnly) {
    return {
      title: `No jobs match “${q}”.`,
      body: "Try another word, or clear the search to see all open work.",
      clearLabel: "Clear search",
    };
  }
  if (i.nearbyActive && !q) {
    return {
      title: `No jobs within ${i.currentMiles} mi of you.`,
      body: `Try widening to ${i.nextMiles} mi, or clear the radius to see all open work across your parish.`,
      clearLabel: "Clear filters",
    };
  }
  return {
    title: q ? `No jobs match “${q}” with your filters.` : "No jobs match your filters.",
    body: "Try a different category, a wider time window, or clearing a filter.",
    clearLabel: "Clear filters",
  };
}
