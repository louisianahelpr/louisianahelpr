import { useState } from "react";
import { Bookmark, ChevronRight, Clock, MapPin, X } from "lucide-react";
import { categoryLabels } from "@/components/dashboard/JobFilters";
import { FilterSheet, buildJobFilterSections } from "@/components/dashboard/FilterSheet";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
import { SavedSearches } from "@/components/SavedSearches";
import { hapticLight } from "@/lib/haptics";
import type { FeedDensity } from "@/components/dashboard/feedDensity";
import { budgetChipLabel } from "./browseTasksToolbar/constants";
import type { BrowseTasksToolbarProps, ChipDef } from "./browseTasksToolbar/types";
import { BrowseSearchBar } from "./browseTasksToolbar/BrowseSearchBar";
import { SwipeableFilterChip } from "./browseTasksToolbar/SwipeableFilterChip";
import { CategoryChipRow } from "./browseTasksToolbar/CategoryChipRow";
import { BrowseViewToggle } from "./browseTasksToolbar/BrowseViewToggle";

// Re-export so consumers can import from a single location.
export type { FeedDensity };

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
  titleSrOnly = false,
  filtersAnchorRef,
  compactActions = false,
  savedOnly = false,
  onToggleSavedOnly,
  savedCount = 0,
}: BrowseTasksToolbarProps) {
  // Saved-searches dialog. Opened from the filter sheet's "Saved searches"
  // row, which closes the sheet on the way — so the dialog is mounted HERE,
  // outside the sheet, or it would unmount with the row that opened it.
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);

  // Human-readable description of the active location filter, reused in the
  // chip clear-button aria-labels so a screen reader hears WHICH location is
  // being cleared (e.g. "within 10 mi", "Orleans") rather than a generic
  // "location filter".
  const locationFilterText = filters.locationFilter
    ? filters.locationFilter.startsWith("nearby:")
      ? `within ${filters.locationFilter.slice(7)} mi`
      : filters.locationFilter
    : "";

  // One source for the row's heading text, used by both the normal and the
  // search state (search keeps it sr-only rather than dropping the h1).
  const headingTitle = filters.hasFilters ? "Filtered results" : "Browse jobs";

  const recapChips: ChipDef[] = [];
  if (filters.selectedCategory) {
    recapChips.push({
      key: "category",
      label: categoryLabels[filters.selectedCategory],
      onClear: () => filters.setSelectedCategory(null),
      ariaLabel: `Clear category filter (${categoryLabels[filters.selectedCategory]} selected)`,
    });
  }
  if (filters.locationFilter) {
    recapChips.push({
      key: "location",
      label: (
        <>
          <MapPin className="w-3 h-3" />
          {filters.locationFilter.startsWith("nearby:")
            ? `Within ${filters.locationFilter.slice(7)} mi`
            : filters.locationFilter}
        </>
      ),
      onClear: () => filters.setLocationFilter(""),
      ariaLabel: `Clear location filter (${locationFilterText} selected)`,
    });
  }
  if (filters.minBudget || filters.maxBudget) {
    recapChips.push({
      key: "budget",
      label: <>{budgetChipLabel(filters.minBudget, filters.maxBudget)}</>,
      onClear: () => { filters.setMinBudget(""); filters.setMaxBudget(""); },
      ariaLabel: `Clear budget filter (${budgetChipLabel(filters.minBudget, filters.maxBudget)})`,
    });
  }
  if (filters.expiresWithin) {
    recapChips.push({
      key: "expires",
      label: filters.expiresWithin,
      onClear: () => filters.setExpiresWithin(""),
      ariaLabel: `Clear expiry filter (${filters.expiresWithin})`,
    });
  }
  if (filters.matchAvailability) {
    recapChips.push({
      key: "availability",
      label: (
        <>
          <Clock className="w-3 h-3" /> My hours
        </>
      ),
      onClear: () => filters.setMatchAvailability(false),
      ariaLabel: "Clear availability filter (matching my hours)",
    });
  }
  const showRecapRow = recapChips.length >= 3;

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
      {filters.hasFilters ? (
        <ScreenHeaderRow
          className="shrink-0 px-4"
          title={headingTitle}
          titleSrOnly={titleSrOnly}
          meta={
            <span
              className="font-serif italic tracking-[0.18em] uppercase text-ds-10 shrink-0"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              {`Filtered · ${filters.activeFilterCount} active`}
            </span>
          }
        />
      ) : (
        <h1 className="sr-only">{headingTitle}</h1>
      )}

      {/* One-tap category picker row. */}
      {filters.selectedCategory && (
        <CategoryChipRow
          selectedCategory={filters.selectedCategory}
          setSelectedCategory={filters.setSelectedCategory}
        />
      )}

      {/* Active-filter recap chip row — only when 3+ filters are active. */}
      {showRecapRow && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/30" role="group" aria-label="Active filters">
          {recapChips.map((chip) => (
            <SwipeableFilterChip
              key={chip.key}
              onClear={chip.onClear}
              ariaLabel={chip.ariaLabel}
            >
              {chip.label}
              <button
                onClick={chip.onClear}
                aria-label={chip.ariaLabel}
                className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
              >
                <X className="w-3 h-3" />
              </button>
            </SwipeableFilterChip>
          ))}
        </div>
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
          ...(compactActions
            ? [{
                key: "search",
                title: "Search",
                content: <BrowseSearchBar filters={filters} />,
              }]
            : []),
          ...(compactActions && onToggleSavedOnly
            ? [{
                key: "saved-only",
                title: "Saved",
                content: (
                  <button
                    type="button"
                    onClick={() => { hapticLight(); onToggleSavedOnly(); }}
                    aria-pressed={savedOnly}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-ds-md squircle border text-left btn-press transition-all duration-200 ${
                      savedOnly
                        ? "border-primary/50 bg-[hsl(var(--bark)/0.10)]"
                        : "border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur hover:border-primary/50"
                    }`}
                  >
                    <Bookmark
                      className="w-3.5 h-3.5 shrink-0 text-primary"
                      strokeWidth={2.25}
                      fill={savedOnly ? "currentColor" : "none"}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ds-12 font-semibold text-foreground leading-snug">
                        Only Saved Jobs
                      </span>
                      <span className="block text-ds-11 text-muted-foreground leading-snug">
                        {savedCount > 0
                          ? `${savedCount} saved`
                          : "You haven't saved any yet"}
                      </span>
                    </span>
                  </button>
                ),
              }]
            : []),
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
          }),
          // Signed-in only, exactly as the bookmark icon was: saved searches
          // are rows in a per-user table.
          ...(user
            ? [{
                key: "saved-searches",
                title: "Saved searches",
                content: (
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      // Close the sheet FIRST — this row lives inside it, and
                      // the dialog it opens is mounted outside it (below).
                      filters.setFiltersOpen(false);
                      setSavedSearchesOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur text-left btn-press transition-all duration-200 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ds-12 font-semibold text-foreground leading-snug">
                        Saved Searches
                      </span>
                      <span className="block text-ds-11 text-muted-foreground leading-snug">
                        Apply a Set You Saved, or Save These Filters
                      </span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ),
              }]
            : []),
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
          }}
          onApplySearch={(saved) => {
            filters.setSelectedCategory(saved.category);
            filters.setMinBudget(saved.min_budget ? String(saved.min_budget) : "");
            filters.setMaxBudget(saved.max_budget ? String(saved.max_budget) : "");
            filters.setLocationFilter(saved.location_keyword || "");
          }}
        />
      )}

      {/* Active filter chips — each wrapped in SwipeableFilterChip so a
          leftward drag removes the chip's filter with no confirm step.
          When ≥2 filters are active the "Clear all" affordance also
          scrolls the feed back to the top (via onClearAllFilters), so
          the user lands on a clean unfiltered top-of-feed instead of
          mid-list. */}
      {!filters.filtersOpen && (filters.selectedCategory || filters.locationFilter || filters.minBudget || filters.maxBudget || filters.expiresWithin || filters.matchAvailability) && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30" role="group" aria-label="Active filters">
          {filters.selectedCategory && (
            <SwipeableFilterChip
              onClear={() => filters.setSelectedCategory(null)}
              ariaLabel={`Clear category filter (${categoryLabels[filters.selectedCategory]} selected)`}
            >
              {categoryLabels[filters.selectedCategory]}
              <button onClick={() => filters.setSelectedCategory(null)} aria-label={`Clear category filter (${categoryLabels[filters.selectedCategory]} selected)`} className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.locationFilter && (
            <SwipeableFilterChip
              onClear={() => filters.setLocationFilter("")}
              ariaLabel={`Clear location filter (${locationFilterText} selected)`}
            >
              <MapPin className="w-3 h-3" />
              {filters.locationFilter.startsWith("nearby:")
                ? `Within ${filters.locationFilter.slice(7)} mi`
                : filters.locationFilter}
              <button onClick={() => filters.setLocationFilter("")} aria-label={`Clear location filter (${locationFilterText} selected)`} className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {(filters.minBudget || filters.maxBudget) && (
            <SwipeableFilterChip
              onClear={() => { filters.setMinBudget(""); filters.setMaxBudget(""); }}
              ariaLabel={`Clear budget filter (${budgetChipLabel(filters.minBudget, filters.maxBudget)})`}
            >
              {budgetChipLabel(filters.minBudget, filters.maxBudget)}
              <button onClick={() => { filters.setMinBudget(""); filters.setMaxBudget(""); }} aria-label={`Clear budget filter (${budgetChipLabel(filters.minBudget, filters.maxBudget)})`} className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.expiresWithin && (
            <SwipeableFilterChip
              onClear={() => filters.setExpiresWithin("")}
              ariaLabel={`Clear expiry filter (${filters.expiresWithin})`}
            >
              {filters.expiresWithin}
              <button onClick={() => filters.setExpiresWithin("")} aria-label={`Clear expiry filter (${filters.expiresWithin})`} className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.matchAvailability && (
            <SwipeableFilterChip
              onClear={() => filters.setMatchAvailability(false)}
              ariaLabel="Clear availability filter (matching my hours)"
            >
              <Clock className="w-3 h-3" /> My hours
              <button onClick={() => filters.setMatchAvailability(false)} aria-label="Clear availability filter (matching my hours)" className="relative hover:text-primary/70 btn-press before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.activeFilterCount >= 2 && (
            <button
              onClick={() => {
                filters.clearFilters();
                onClearAllFilters?.();
              }}
              aria-label={`Clear all ${filters.activeFilterCount} active filters`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md text-ds-11 font-semibold btn-press"
              style={{
                color: "hsl(var(--burnt-sienna))",
                background: "hsl(var(--burnt-sienna) / 0.1)",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              }}
            >
              <X className="w-3 h-3" strokeWidth={2.25} /> Clear All
            </button>
          )}
        </div>
      )}
    </>
  );
}
