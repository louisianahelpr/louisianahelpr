import { useEffect, useRef, useState } from "react";
import { Clock, MapPin, Search, X } from "lucide-react";
import { categoryLabels } from "@/components/dashboard/JobFilters";
import { FilterSheet, buildJobFilterSections } from "@/components/dashboard/FilterSheet";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import type { FeedDensity } from "@/components/dashboard/feedDensity";
import {
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  SEARCH_HISTORY_MIN_LENGTH,
} from "@/lib/searchHistory";
import { POPULAR_CATEGORIES, budgetChipLabel } from "./browseTasksToolbar/constants";
import type { BrowseTasksToolbarProps, ChipDef } from "./browseTasksToolbar/types";
import { SwipeableFilterChip } from "./browseTasksToolbar/SwipeableFilterChip";
import { CategoryChipRow } from "./browseTasksToolbar/CategoryChipRow";
import { BrowseTasksActions } from "./browseTasksToolbar/BrowseTasksActions";

// Re-export so consumers can import from a single location.
export type { FeedDensity };

/**
 * BrowseTasksToolbar — the Browse feed's control strip: the
 * "Browse jobs / Filtered results" heading row, the expandable search
 * bar and filter panel, the active-filter chips, and the List / Map
 * view toggle.
 *
 * The icon cluster is `BrowseTasksActions`, rendered inline in the heading
 * row — on BOTH browse surfaces, Home and the guest feed. It briefly lived in
 * the page's title card instead (2026-08-17); the owner reverted that half of
 * the change after seeing it on device, so the buttons sit next to the
 * heading whose results they filter again.
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
}: BrowseTasksToolbarProps) {
  // Recent searches dropdown — shown only when the search input is
  // focused AND empty AND we have history to show. We snapshot the list
  // when the input opens, and refresh after each push so the dropdown
  // re-reads on the next focus rather than mutating mid-typing.
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => getRecentSearches());

  // Persist non-trivial queries to history. Debounced via a ref so we
  // only push the "settled" value, not every keystroke. We wait for the
  // user to stop typing for ~1s and then commit.
  const lastPushedRef = useRef<string>("");
  useEffect(() => {
    const q = filters.searchQuery.trim();
    if (q.length < SEARCH_HISTORY_MIN_LENGTH) return;
    if (q.toLowerCase() === lastPushedRef.current.toLowerCase()) return;
    const timer = window.setTimeout(() => {
      pushRecentSearch(q);
      lastPushedRef.current = q;
      setRecentSearches(getRecentSearches());
    }, 800);
    return () => window.clearTimeout(timer);
  }, [filters.searchQuery]);

  // When the box is focused and empty we always have something to offer:
  // recent searches (if any) and a popular-picks row beneath them.
  const showSearchDropdown = searchFocused && filters.searchQuery.length === 0;

  // Shared "commit this query" path for both a recent row and a popular
  // chip — set it, remember it, and close the dropdown.
  const applySuggestion = (q: string) => {
    filters.setSearchQuery(q);
    pushRecentSearch(q);
    lastPushedRef.current = q;
    setRecentSearches(getRecentSearches());
    setSearchFocused(false);
  };

  // Popular-pick path: apply the real category filter (not a text search) and
  // close the dropdown. Mirrors tapping the chip in CategoryChipRow.
  const applyPopularCategory = (key: string) => {
    filters.setSelectedCategory(key);
    setSearchFocused(false);
  };

  // Human-readable description of the active location filter, reused in the
  // chip clear-button aria-labels so a screen reader hears WHICH location is
  // being cleared (e.g. "within 10 mi", "Orleans") rather than a generic
  // "location filter".
  const locationFilterText = filters.locationFilter
    ? filters.locationFilter.startsWith("nearby:")
      ? `within ${filters.locationFilter.slice(7)} mi`
      : filters.locationFilter
    : "";

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
      {/* Header row — title in normal mode; inline search input in search mode. */}
      <div
        className="shrink-0 flex items-center gap-3 px-4"
        style={{ minHeight: "52px", borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
      >
        {filters.searchOpen ? (
          /* Search mode — input replaces the title row inline (iOS pattern). */
          <>
            {/* The visible h1 is swapped out for the input, which left the
                screen with ZERO h1s for as long as search was open. Keep it in
                the document, just not on screen, so the "exactly one h1 per
                screen" rule holds in every state rather than only at rest. */}
            <h1 className="sr-only">{filters.hasFilters ? "Filtered results" : "Browse jobs"}</h1>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                type="search"
                aria-label="Search jobs"
                placeholder="Search jobs…"
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                value={filters.searchQuery}
                onChange={(e) => filters.setSearchQuery(e.target.value)}
                onFocus={() => {
                  setSearchFocused(true);
                  setRecentSearches(getRecentSearches());
                }}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
                className="w-full pl-9 pr-9 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
              />
              {filters.searchQuery && (
                <button
                  onClick={() => filters.setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { filters.setSearchOpen(false); filters.setSearchQuery(""); }}
              className="shrink-0 text-ds-13 font-medium btn-press py-2"
              style={{ color: "hsl(var(--bark))" }}
            >
              Cancel
            </button>
          </>
        ) : (
          /* Normal mode — title + action buttons. */
          <>
            <div className="flex flex-col leading-none flex-1 min-w-0 py-2.5">
              {filters.hasFilters && (
                <span
                  className="font-serif italic tracking-[0.18em] uppercase text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                >
                  {`Filtered · ${filters.activeFilterCount} active`}
                </span>
              )}
              <h1
                className={
                  titleSrOnly
                    ? "sr-only"
                    : "font-display italic font-bold leading-tight text-ds-20"
                }
                style={
                  titleSrOnly
                    ? undefined
                    : {
                        color: "hsl(var(--ink-deep))",
                        letterSpacing: "-0.018em",
                        marginTop: filters.hasFilters ? "0.25rem" : 0,
                      }
                }
              >
                {filters.hasFilters ? "Filtered results" : "Browse jobs"}
              </h1>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <BrowseTasksActions
                filters={filters}
                user={user}
                view={view}
                setView={setView}
                hideViewToggle={hideViewToggle}
              />
            </div>
          </>
        )}
      </div>

      {/* Search suggestions — shown below the inline search bar when
          the input is focused and the query is empty. */}
      {filters.searchOpen && showSearchDropdown && (
        <div
          className="border-b border-border/30"
          role="listbox"
          aria-label="Search suggestions"
        >
          {recentSearches.length > 0 && (
            <>
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/30">
                <span
                  className="font-serif italic tracking-[0.14em] uppercase text-ds-9"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Recent
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    clearRecentSearches();
                    setRecentSearches([]);
                  }}
                  className="text-ds-10 text-muted-foreground hover:text-destructive btn-press"
                >
                  Clear
                </button>
              </div>
              <ul>
                {recentSearches.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(q);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left text-ds-13 hover:bg-muted/50 btn-press"
                    >
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="px-4 py-1.5 border-b border-border/30">
            <span
              className="font-serif italic tracking-[0.14em] uppercase text-ds-9"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Popular
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 px-4 py-2.5">
            {POPULAR_CATEGORIES.map((key) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyPopularCategory(key);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-md bg-[hsl(var(--bark)/0.08)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.18)] text-ds-11 font-medium hover:bg-[hsl(var(--bark)/0.14)] btn-press"
              >
                <CategoryIcon category={key} className="w-3 h-3 shrink-0" />
                {categoryLabels[key]}
              </button>
            ))}
          </div>
        </div>
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
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/30" aria-label="Active filters">
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
          other surface (Activity, Guest). */}
      <FilterSheet
        open={filters.filtersOpen}
        onOpenChange={filters.setFiltersOpen}
        activeFilterCount={filters.activeFilterCount}
        onClearAll={() => {
          filters.clearFilters();
          onClearAllFilters?.();
        }}
        sections={buildJobFilterSections({
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
        })}
      />

      {/* Active filter chips — each wrapped in SwipeableFilterChip so a
          leftward drag removes the chip's filter with no confirm step.
          When ≥2 filters are active the "Clear all" affordance also
          scrolls the feed back to the top (via onClearAllFilters), so
          the user lands on a clean unfiltered top-of-feed instead of
          mid-list. */}
      {!filters.filtersOpen && (filters.selectedCategory || filters.locationFilter || filters.minBudget || filters.maxBudget || filters.expiresWithin || filters.matchAvailability) && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30" aria-label="Active filters">
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
              <X className="w-3 h-3" strokeWidth={2.25} /> Clear all
            </button>
          )}
        </div>
      )}
    </>
  );
}
