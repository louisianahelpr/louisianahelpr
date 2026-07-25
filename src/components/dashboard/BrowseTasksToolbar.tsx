import { startTransition, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clock, MapPin, Search, SlidersHorizontal, X, List, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SavedSearches } from "@/components/SavedSearches";
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

// Re-export so consumers can import from a single location.
export type { FeedDensity };

/**
 * BrowseTasksToolbar — the Dashboard feed's control strip: the
 * "Browse Tasks / Filtered Results" heading row, the expandable search
 * bar and filter panel, the active-filter chips, and the List / Map
 * view toggle.
 *
 * Extracted verbatim from Dashboard.tsx (a step in splitting that
 * file) — the JSX is unchanged and every value it reads is now a prop.
 */
export function BrowseTasksToolbar({
  filters,
  user,
  helperAvailability,
  view,
  setView,
  hideViewToggle = false,
  onClearAllFilters,
}: BrowseTasksToolbarProps) {
  const reducedMotion = useReducedMotion();
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
      {/* Header row — always shown. Even on a quiet, unfiltered board the
          search + saved-searches + category filters stay available so a
          helper can hunt for work (or set up a saved search to be pinged)
          rather than just staring at an empty feed. */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
      >
        <div className="flex flex-col leading-none">
          <span
            className="font-serif italic tracking-[0.18em] uppercase text-[0.62rem]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            {filters.hasFilters
              ? `Filtered · ${filters.activeFilterCount} active`
              : "Fresh today"}
          </span>
          {/* h1, not h2: this is the primary heading of the surfaces that
              render this toolbar (/browse guest board and /dashboard). Neither
              page renders any other h1, so demoting this to h2 left both with
              zero h1 and a broken heading order. */}
          <h1
            className="font-display italic font-bold leading-tight mt-2"
            style={{
              fontSize: "1.25rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.018em",
            }}
          >
            {/* Sentence case, matching the /jobs public board's "Browse jobs"
                h1 — the same feature must not read "Browse Jobs" on one
                surface and "Browse jobs" on the other. */}
            {filters.hasFilters ? "Filtered results" : "Browse jobs"}
          </h1>
          {/* No "N jobs" count line under the title: the feed directly
              below IS the count, and the empty state already says
              "Nothing nearby just yet" far more clearly. Matches the
              /jobs public board, which dropped the same line. */}
        </div>
        <div className="flex items-center gap-1">
              {/* Clear-all lives with the filter/chip rows below, not here —
                  crowding it into the icon cluster forced the title to wrap
                  and pushed the filter button off-screen on narrow phones. */}

              {/* List ⇄ Map toggle — single icon button living in the
                  toolbar cluster beside saved-search / search / filter.
                  List is the default; tapping swaps to the map and back.
                  Always available (the map shows the live Louisiana board
                  even when 0 jobs are nearby). Hidden on the desktop web,
                  where the feed and map already render side by side. */}
              {!hideViewToggle && (
                <Button
                  variant="ghost"
                  size="icon"
                  // Mark the view swap as a transition — switching to map lazy-
                  // loads the leaflet chunk, and a slow fetch would otherwise
                  // block this tap from feeling responsive. startTransition lets
                  // React keep the current view interactive (and its Suspense
                  // fallback in place) while the map commits non-urgently.
                  onClick={() => startTransition(() => setView(view === "map" ? "list" : "map"))}
                  className={`h-10 w-10 rounded-ds-md btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${view === "map" ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                  aria-label={view === "map" ? "Show list view" : "Show map view"}
                  aria-pressed={view === "map"}
                >
                  {view === "map" ? <List className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
                </Button>
              )}
              {user && (
                <SavedSearches
                  userId={user.id}
                  currentFilters={{
                    selectedCategory: filters.selectedCategory,
                    maxBudget: filters.maxBudget,
                    locationFilter: filters.locationFilter,
                  }}
                  onApplySearch={(s) => {
                    filters.setSelectedCategory(s.category);
                    filters.setMaxBudget(s.max_budget ? String(s.max_budget) : "");
                    filters.setLocationFilter(s.location_keyword || "");
                  }}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { filters.setSearchOpen(!filters.searchOpen); if (filters.filtersOpen) filters.setFiltersOpen(false); }}
                className={`h-10 w-10 rounded-ds-md btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${filters.searchOpen || filters.searchQuery ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                aria-label="Search jobs"
                aria-expanded={filters.searchOpen}
              >
                <Search className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { filters.setFiltersOpen(!filters.filtersOpen); if (filters.searchOpen) filters.setSearchOpen(false); }}
                className={`h-10 w-10 rounded-ds-md btn-press relative focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${filters.filtersOpen || filters.activeFilterCount > 0 ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                aria-label={filters.activeFilterCount > 0 ? `Filters (${filters.activeFilterCount} active)` : "Filters"}
                aria-expanded={filters.filtersOpen}
              >
                <SlidersHorizontal className="w-5 h-5" />
                {filters.activeFilterCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
                    {filters.activeFilterCount}
                  </span>
                )}
              </Button>
        </div>
      </div>

      {/* One-tap category picker row. Hidden in the default state —
          appears only once the user has picked a category via the filter
          sheet, then expands to the full picker so they can switch or
          clear with a single tap. Keeps the unfiltered Browse board
          uncluttered while preserving the in-context switch affordance. */}
      {filters.selectedCategory && (
        <CategoryChipRow
          selectedCategory={filters.selectedCategory}
          setSelectedCategory={filters.setSelectedCategory}
        />
      )}

      {/* Active-filter recap chip row — only when 3+ filters are
          simultaneously active. With fewer, the input controls below
          already say the same thing and a recap is redundant noise.
          Each chip is wrapped in a SwipeableFilterChip so a horizontal
          swipe-left removes that single filter with no confirm step. */}
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
                className="hover:text-primary/70 btn-press"
              >
                <X className="w-3 h-3" />
              </button>
            </SwipeableFilterChip>
          ))}
        </div>
      )}

      {/* Expandable search bar */}
      <AnimatePresence>
        {filters.searchOpen && (
          <motion.div
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={reducedMotion ? {} : { height: "auto", opacity: 1 }}
            exit={reducedMotion ? {} : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-b border-border/30"
          >
            <div className="relative px-4 py-3">
              <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
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
                  // Re-read history on each focus so dropdowns reflect
                  // anything pushed since last render.
                  setRecentSearches(getRecentSearches());
                }}
                // 150ms delay so a tap on a dropdown row fires before
                // the blur removes the dropdown from the DOM.
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
                className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
              />
              {filters.searchQuery && (
                <button onClick={() => filters.setSearchQuery("")} aria-label="Clear search" className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press">
                  <X className="w-4 h-4" />
                </button>
              )}
              {showSearchDropdown && (
                <div
                  className="mx-3 mt-1 rounded-ds-md liquid-glass overflow-hidden"
                  role="listbox"
                  aria-label="Search suggestions"
                >
                  {recentSearches.length > 0 && (
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
                        <span
                          className="font-serif italic tracking-[0.14em] uppercase text-ds-9"
                          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                        >
                          Recent
                        </span>
                        <button
                          type="button"
                          // onMouseDown fires before the input's blur, so the
                          // dropdown is still mounted when we update state.
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
                              // Beat the input blur so the dropdown
                              // doesn't unmount before the click resolves.
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySuggestion(q);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-ds-13 hover:bg-muted/50 btn-press"
                            >
                              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">{q}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className="px-3 py-1.5 border-b border-border/30">
                    <span
                      className="font-serif italic tracking-[0.14em] uppercase text-ds-9"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Popular
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                    {POPULAR_CATEGORIES.map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={false}
                        // Beat the input blur (same reason as the recent rows).
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
              <button onClick={() => filters.setSelectedCategory(null)} aria-label={`Clear category filter (${categoryLabels[filters.selectedCategory]} selected)`} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
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
              <button onClick={() => filters.setLocationFilter("")} aria-label={`Clear location filter (${locationFilterText} selected)`} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {(filters.minBudget || filters.maxBudget) && (
            <SwipeableFilterChip
              onClear={() => { filters.setMinBudget(""); filters.setMaxBudget(""); }}
              ariaLabel={`Clear budget filter (${budgetChipLabel(filters.minBudget, filters.maxBudget)})`}
            >
              {budgetChipLabel(filters.minBudget, filters.maxBudget)}
              <button onClick={() => { filters.setMinBudget(""); filters.setMaxBudget(""); }} aria-label={`Clear budget filter (${budgetChipLabel(filters.minBudget, filters.maxBudget)})`} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.expiresWithin && (
            <SwipeableFilterChip
              onClear={() => filters.setExpiresWithin("")}
              ariaLabel={`Clear expiry filter (${filters.expiresWithin})`}
            >
              {filters.expiresWithin}
              <button onClick={() => filters.setExpiresWithin("")} aria-label={`Clear expiry filter (${filters.expiresWithin})`} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </SwipeableFilterChip>
          )}
          {filters.matchAvailability && (
            <SwipeableFilterChip
              onClear={() => filters.setMatchAvailability(false)}
              ariaLabel="Clear availability filter (matching my hours)"
            >
              <Clock className="w-3 h-3" /> My hours
              <button onClick={() => filters.setMatchAvailability(false)} aria-label="Clear availability filter (matching my hours)" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
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
