import { useState } from "react";
import { ChevronRight, SearchCheck } from "lucide-react";
import { FilterSheet, buildJobFilterSections } from "@/components/dashboard/FilterSheet";
import { SavedSearches } from "@/components/SavedSearches";
import { hapticLight } from "@/lib/haptics";
import type { BrowseTasksToolbarProps } from "./browseTasksToolbar/types";
import { CategoryChipRow } from "./browseTasksToolbar/CategoryChipRow";
import { BrowseViewToggle } from "./browseTasksToolbar/BrowseViewToggle";

/**
 * BrowseTasksToolbar — the Browse feed's control strip: the
 * "Browse jobs / Filtered results" heading row, the expandable search
 * bar and filter sheet, and the active-filter chips.
 *
 * ONE header row, not a band of its own. The row is the shared
 * `<ScreenHeaderRow>` — literally the component My Posts / My Jobs render — so
 * the browse feed carries that family's shape and height rather than an
 * approximation of it: name on the left, live state label beside it, and a
 * two-icon cluster (`BrowseTasksActions`: search · filters) on the right.
 *
 * It used to be a 52px band carrying FOUR icons — view toggle · saved searches
 * · search · filters — with the "Filtered · N active" eyebrow stacked ABOVE the
 * title, so a single active filter grew the band to two lines. Owner's call:
 * "for the icons move saved filters and map view into the filter option and
 * move the rest up into the 1 column so it's the same size layout as jobs and
 * post". So:
 *
 *   - List⇄Map became the sheet's "View" section (`BrowseViewToggle`),
 *   - Saved searches became the sheet's "Saved searches" row, which opens the
 *     same `<SavedSearches>` dialog mounted at the bottom of this component,
 *   - search + filters stayed in the header row, which is now 44px with the
 *     state label inline.
 *
 * Nothing was dropped: the map is a real feature with its own persisted
 * view state, and both controls gained a word-label on the way in.
 *
 * The icon cluster briefly lived in the page's title card instead
 * (2026-08-17); the owner reverted that after seeing it on device, so the
 * buttons stay next to the heading whose results they filter.
 *
 * The buttons drive the same `filters.searchOpen` / `filters.filtersOpen`
 * state this component reads, so the search input, its recent/popular
 * dropdown, and the FilterSheet are all one row's worth of the same state —
 * there is only ever one copy of each piece.
 */
export function BrowseTasksToolbar({
  filters,
  user,
  helperAvailability,
  view,
  setView,
  hideViewToggle = false,
  onClearAllFilters,
  // No longer read: the heading is always sr-only now that the visible
  // "Filtered · N active" eyebrow it used to gate was removed (owner:
  // redundant with the highlighted category chip + the filter sheet).
  // Kept in the prop list (BrowseTasksToolbarProps) so callers passing it
  // (Dashboard, DashboardGuest) don't need a matching change.
  titleSrOnly: _titleSrOnly = false,
  filtersAnchorRef,
  savedOnly = false,
  onToggleSavedOnly,
  savedCount = 0,
}: BrowseTasksToolbarProps) {
  // Saved-searches dialog. Opened from the filter sheet's "Saved searches"
  // row, which closes the sheet on the way — so the dialog is mounted HERE,
  // outside the sheet, or it would unmount with the row that opened it.
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);

  // One source for the row's heading text, used by both the normal and the
  // search state (search keeps it sr-only rather than dropping the h1).
  //
  // `nearbyUnavailable` is a chosen radius with no viewer coordinates to
  // measure from (permission denied, still resolving, or no geolocation), in
  // which case the feed is deliberately NOT narrowed — a denied permission
  // must leave a usable browse surface, not an empty one. So that radius does
  // not count toward "filtered".
  //
  // This heading is sr-only, which is exactly why it matters: it is the only
  // signal this row gives a screen-reader user about whether they are looking
  // at a subset. Announcing "Filtered Results" over an unnarrowed feed told
  // them a filter had run when none had (BD-001).
  const narrowedCount = filters.activeFilterCount - (filters.nearbyUnavailable ? 1 : 0);
  const headingTitle = narrowedCount > 0
    ? "Filtered Results"
    : filters.nearbyUnavailable
      ? "Browse Jobs — location unavailable, distance filter not applied"
      : "Browse Jobs";

  return (
    <>
      {/* Header row — the SHARED <ScreenHeaderRow>, the same component My Posts
          / My Jobs render, so this screen is that family's shape and height
          rather than an approximation of it. 44px, no hairline, no band: the
          two remaining icons sit in the row's trailing cluster and the feed
          starts directly beneath.

          The title is `sr-only` on both browse surfaces (owner: "home will not
          have a title just the H logo"), so what is actually VISIBLE on the
          left is the "Filtered · N active" label — live state, the only
          on-screen sign that the feed is showing a subset. It rides the row's
          baseline now instead of stacking above the title, which is what used
          to push this band to two lines the moment a filter was on. */}
      {/* The search FIELD is not here any more — it renders in the title
          card (DashboardTitleBar's `searchBar` slot), which is where the icon
          that opens it lives. It used to render in this row: tapping a button
          in the top panel made an input appear in a different container below
          it.

          The "Popular" chip row that hung under the old input went with it. It
          applied a category filter, which is exactly what CategoryChipRow — a
          permanent one-tap row a few pixels below this — already does, so it
          was a second control for the same job wearing a different name.
          Recent searches moved into BrowseSearchBar; those are the user's own
          text queries and nothing else offers them.

          What stays here is the live "Filtered · N active" label — the only
          on-screen sign that the feed is showing a subset. The row renders
          ONLY when there is one to show; the title is `sr-only` on this screen
          (owner: "home will not have a title just the H logo"), so otherwise
          this would be 44px of empty band above the feed.

          The <h1> is NOT dropped with it: a screen with zero headings is an
          a11y defect, so the sr-only heading renders on its own in the
          collapsed case and keeps the document structure the row gave. */}
      {/* No more visible "Filtered · N active" eyebrow, and no separate
          "Active filters" chip recap row below (owner: redundant — the
          selected category already stays visually highlighted in the
          one-tap category row right below, and every other active filter
          is one tap away in the filter sheet, which already shows its own
          "Clear All"). The heading itself stays sr-only either way; this
          screen has no visible title by design ("home will not have a
          title just the H logo"). */}
      <h1 className="sr-only">{headingTitle}</h1>

      {/* One-tap category picker row. */}
      {filters.selectedCategory && (
        <CategoryChipRow
          selectedCategory={filters.selectedCategory}
          setSelectedCategory={filters.setSelectedCategory}
        />
      )}

      {/* Unified filter bottom sheet — the SlidersHorizontal button above
          toggles `filtersOpen`, which opens this sheet with all the filter
          controls stacked as vertical sections. Same presentation as every
          other surface (Activity, Guest).

          It carries two sections the header row used to carry as bare icons:
          "View" (List⇄Map) above every filter, because it is not one — it
          decides HOW you look at the results, before anything about which
          results — and "Saved searches" at the bottom, next to "Clear all",
          because like Clear all it is an action rather than a control. */}
      <FilterSheet
        open={filters.filtersOpen}
        onOpenChange={filters.setFiltersOpen}
        anchorRef={filtersAnchorRef}
        activeFilterCount={filters.activeFilterCount}
        onClearAll={() => {
          filters.clearFilters();
          onClearAllFilters?.();
        }}
        sections={[
          // PHONE ONLY. These two have icons in the header row on desktop; on
          // phone the row is emblem + filter + bell and there is no width for
          // them, so they live here instead. They sit ABOVE "View" because
          // they are the two that decide WHICH results exist at all — text and
          // saved-state — before you choose how to look at them.
          // NO SEARCH SECTION. Search is an icon in the brand row on every
          // width now (owner, 2026-09-07), so a second field in here would be
          // the same control in two places — and the sheet copy is one of the
          // sites an external review read as evidence that Browse had no
          // search at all. One home each: text goes in the row's field,
          // everything below narrows what that returns.
          // View keeps its own row (owner, 2026-08-24: tried riding the
          // Sort by line, rejected) — it decides HOW you look at results,
          // before anything about which results.
          ...(hideViewToggle
            ? []
            : [{
                key: "view",
                title: "View",
                content: (
                  <BrowseViewToggle
                    view={view}
                    setView={setView}
                    // Picking a view is a terminal choice — get the sheet out
                    // of the way so you land on the thing you asked for. Only
                    // fires on an actual change, so re-tapping the current
                    // view does not dismiss the sheet under you.
                    onSelect={() => filters.setFiltersOpen(false)}
                  />
                ),
              }]),
          ...buildJobFilterSections({
            // "Only saved" is a filter, so it lives with the other Show-only
            // switches (owner: merge & tighten, 2026-08-24).
            savedOnly,
            onToggleSavedOnly,
            savedCount,
            selectedCategory: filters.selectedCategory, setSelectedCategory: filters.setSelectedCategory,
            locationFilter: filters.locationFilter, setLocationFilter: filters.setLocationFilter,
            sortBy: filters.sortBy, setSortBy: filters.setSortBy,
            expiresWithin: filters.expiresWithin, setExpiresWithin: filters.setExpiresWithin,
            matchAvailability: filters.matchAvailability, setMatchAvailability: filters.setMatchAvailability,
            hasAvailability: helperAvailability.length > 0,
            boostedOnly: filters.boostedOnly, setBoostedOnly: filters.setBoostedOnly,
            urgentOnly: filters.urgentOnly, setUrgentOnly: filters.setUrgentOnly,
            userLocStatus: filters.userLoc?.status,
            userLocMessage: filters.userLoc?.status === "error" ? filters.userLoc.message : undefined,
            // Saved Searches OPENS a dialog — it is an action, not a filter,
            // but it used to sit alone in the sheet footer, disconnected
            // from every section above it. Folded into "Show only" (the
            // last section) instead, right after the other narrowing
            // switches, so it reads as part of the sheet. Signed-in only,
            // exactly as the bookmark icon was: saved searches are rows in
            // a per-user table.
            savedSearchesButton: user ? (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  // Close the sheet FIRST — this row lives inside it, and
                  // the dialog it opens is mounted outside it (below).
                  filters.setFiltersOpen(false);
                  setSavedSearchesOpen(true);
                }}
                className="w-full flex items-center gap-2 h-11 px-3 rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur text-left btn-press transition-all duration-200 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
              >
                {/* SearchCheck, not Bookmark — the "Only Saved Jobs" toggle row
                    right above this one already uses Bookmark for a saved
                    JOB, so this row (a saved SEARCH query) needs its own glyph
                    or the two read as the same feature. */}
                <SearchCheck className="w-3.5 h-3.5 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
                <span className="min-w-0 flex-1 text-ds-12 font-semibold text-foreground">
                  Saved Searches
                </span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ) : undefined,
          }),
        ]}
      />

      {/* The saved-searches dialog itself — mounted here rather than inside
          the sheet section that opens it, because that row closes the sheet on
          tap and would take a dialog rendered inside it down with it. Also
          still openable by the `open-saved-searches` window event, which is
          why the listener inside SavedSearches keeps working unchanged. */}
      {user && (
        <SavedSearches
          open={savedSearchesOpen}
          onOpenChange={setSavedSearchesOpen}
          userId={user.id}
          currentFilters={{
            selectedCategory: filters.selectedCategory,
            minBudget: filters.minBudget,
            maxBudget: filters.maxBudget,
            locationFilter: filters.locationFilter,
            // The text query is part of the search. It had no column until
            // 20260901035245, so saving "Lawn care under $200" kept the budget
            // and dropped the words — and re-applying it silently widened the
            // feed to every category of job under $200.
            searchQuery: filters.searchQuery,
          }}
          onApplySearch={(saved) => {
            // Restore EVERY dimension the search was saved with. Anything left
            // out here comes back wider than the user saved it, with nothing
            // on screen to say so.
            filters.setSearchQuery(saved.query ?? "");
            // Open the search field when a query comes back, for the same
            // reason useDashboardFilters opens it for `?q=`: a restored query
            // that is applied but invisible reads as a broken feed.
            if (saved.query) filters.setSearchOpen(true);
            filters.setSelectedCategory(saved.category);
            filters.setMinBudget(saved.min_budget ? String(saved.min_budget) : "");
            filters.setMaxBudget(saved.max_budget ? String(saved.max_budget) : "");
            // The radius round-trips through the same `nearby:<miles>` token
            // the filter state uses; it is stored as a number now, because a
            // token in a text column is what made the alert unmatchable.
            filters.setLocationFilter(saved.radius_miles ? `nearby:${saved.radius_miles}` : "");
          }}
        />
      )}
    </>
  );
}
