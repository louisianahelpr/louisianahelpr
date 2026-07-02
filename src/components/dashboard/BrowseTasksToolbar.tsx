import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Clock, MapPin, Search, SlidersHorizontal, X, List, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SavedSearches } from "@/components/SavedSearches";
import { categoryLabels } from "@/components/dashboard/JobFilters";
import { FilterSheet, buildJobFilterSections } from "@/components/dashboard/FilterSheet";
import { categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { hapticLight } from "@/lib/haptics";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { FeedDensity } from "@/components/dashboard/feedDensity";
import {
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  SEARCH_HISTORY_MIN_LENGTH,
} from "@/lib/searchHistory";

// Popular categories surfaced when the box is focused but empty — gives
// a brand-new helper (no history yet) something to tap instead of a blank
// dropdown, the way top apps seed an empty search with trending picks.
// These are real category KEYS (not free text) so tapping one applies the
// exact category filter — a fuzzy title/description search would miss jobs
// whose wording doesn't contain the category word. Ordered by post volume.
const POPULAR_CATEGORIES = [
  "cleaning",
  "handyman",
  "moving",
  "yard_work",
  "pet_care",
  "delivery",
] as const;

// Compact label for the active budget-range chip. Either bound can be
// unset ("" = no floor / no cap), so render whichever side is present:
//   min only → "$50+", max only → "≤ $250", both → "$50 – $250".
function budgetChipLabel(minBudget: string, maxBudget: string): string {
  if (minBudget && maxBudget) return `$${minBudget} – $${maxBudget}`;
  if (minBudget) return `$${minBudget}+`;
  if (maxBudget) return `≤ $${maxBudget}`;
  return "Budget";
}

// Re-export so consumers can import from a single location.
export type { FeedDensity };

interface BrowseTasksToolbarProps {
  /** Dashboard filter state + setters (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  /** Signed-in user — gates the SavedSearches control. */
  user: SupaUser | null;
  /** Helper availability rows — only the count is read, to enable the
   *  "match my hours" filter. */
  helperAvailability: unknown[];
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /** Hide the List⇄Map toggle. On the desktop web the feed and map sit
   *  side by side, so the toggle is meaningless — both panes are visible. */
  hideViewToggle?: boolean;
  /** Called when the user clears all filters via the "Clear all" chip —
   *  Dashboard uses this to scroll the feed back to the top so the user
   *  doesn't end up mid-list in a freshly unfiltered feed. */
  onClearAllFilters?: () => void;
}

// Per-chip horizontal swipe-to-remove threshold. A clean leftward drift
// past this value commits the clear; anything less springs back to 0.
const CHIP_SWIPE_THRESHOLD = -64;

/**
 * Single filter chip with a horizontal swipe-left affordance. Pulling
 * the chip left past CHIP_SWIPE_THRESHOLD removes the underlying filter
 * (no confirm dialog — same model as the SwipeableJobCard dismiss).
 * The chip's body still renders the existing × button so tap remains
 * a first-class clear gesture.
 *
 * Memoised inline as a small functional component — there are at most
 * 5 chips and they re-render with their parent, so the lighter
 * inline component beats extracting to a separate file.
 */
function SwipeableFilterChip({
  children,
  onClear,
  ariaLabel,
}: {
  children: ReactNode;
  onClear: () => void;
  ariaLabel: string;
}) {
  const x = useMotionValue(0);
  // Visual hint: the chip fades and tilts a touch as it crosses the
  // commit threshold so the user feels the action arrive before it
  // fires. Matches SwipeableJobCard's "you're crossing the line" cue.
  const opacity = useTransform(x, [CHIP_SWIPE_THRESHOLD * 1.5, CHIP_SWIPE_THRESHOLD, 0], [0.35, 0.7, 1]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < CHIP_SWIPE_THRESHOLD) {
      onClear();
      return;
    }
    animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
  };

  return (
    <motion.span
      drag="x"
      dragConstraints={{ left: -120, right: 0 }}
      dragElastic={0.1}
      onDragEnd={handleDragEnd}
      style={{ x, opacity }}
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-[hsl(var(--bark)/0.1)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.22)] text-ds-11 font-medium touch-pan-y"
    >
      {children}
    </motion.span>
  );
}

/**
 * CategoryChipRow — a one-tap category picker. A horizontally
 * scrollable strip of every job category (plus a leading "All" chip)
 * that reads and writes the same `selectedCategory` filter the filter
 * sheet and active-filter recap chips use, so all three stay in sync.
 *
 * This is a *picker* (all categories, one selected), distinct from the
 * active-filter recap row below (which only echoes applied filters).
 * Tapping the already-active chip toggles back to "All" (null).
 */
function CategoryChipRow({
  selectedCategory,
  setSelectedCategory,
}: {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
}) {
  // Each chip: ≥44px tall hit area (h-11), brand tokens via hsl(var(--…)),
  // active state mirrors the bark-wash used by the filter-sheet chips.
  const base =
    "inline-flex items-center gap-1.5 shrink-0 h-11 px-3.5 rounded-ds-md text-ds-12 font-semibold tracking-tight border btn-press squircle motion-safe:transition-colors";
  const active =
    "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.40)]";
  const idle =
    "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto scrollbar-hide border-b border-border/30"
      role="group"
      aria-label="Filter by category"
    >
      <button
        type="button"
        onClick={() => {
          hapticLight();
          setSelectedCategory(null);
        }}
        aria-pressed={!selectedCategory}
        className={`${base} ${!selectedCategory ? active : idle}`}
      >
        All
      </button>
      {Object.entries(categoryLabels).map(([key, label]) => {
        const isActive = selectedCategory === key;
        const titleColor = (categoryColors[key] || categoryColors.other).title;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              hapticLight();
              // Toggle: tapping the active chip clears back to "All".
              setSelectedCategory(isActive ? null : key);
            }}
            aria-pressed={isActive}
            className={`${base} ${isActive ? active : idle}`}
          >
            <CategoryIcon
              category={key}
              aria-hidden
              className={`w-3 h-3 ${isActive ? "" : titleColor}`}
              strokeWidth={2.25}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

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

  // Active-filter recap chip row — only render when 3+ filters are
  // active simultaneously. With <3 active, the existing input controls
  // already cover the same ground and a recap row would be redundant
  // noise. Each chip's × reuses the same clear handler the existing
  // single-filter chips use further down.
  type ChipDef = {
    key: string;
    label: ReactNode;
    onClear: () => void;
    ariaLabel: string;
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
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
          >
            {filters.hasFilters
              ? `Filtered · ${filters.activeFilterCount} active`
              : "Fresh today"}
          </span>
          <h2
            className="font-display italic font-bold leading-tight mt-2"
            style={{
              fontSize: "1.25rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.018em",
            }}
          >
            {filters.hasFilters ? "Filtered Results" : "Browse Jobs"}
          </h2>
          {/* Subtitle hidden when 0 jobs — the empty-state card
              below already says "Nothing nearby just yet" in a much
              more prominent way. Showing "0 jobs" here too is
              redundant noise. */}
          {filters.filteredJobs.length > 0 && (
            <span
              className="font-serif italic mt-0.5 text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {filters.filteredJobs.length}{" "}
              {filters.filteredJobs.length === 1 ? "job" : "jobs"}
            </span>
          )}
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-b border-border/30"
          >
            <div className="relative px-4 py-3">
              <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="search"
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
          minBudget: filters.minBudget, setMinBudget: filters.setMinBudget,
          maxBudget: filters.maxBudget, setMaxBudget: filters.setMaxBudget,
          locationFilter: filters.locationFilter, setLocationFilter: filters.setLocationFilter,
          sortBy: filters.sortBy, setSortBy: filters.setSortBy,
          expiresWithin: filters.expiresWithin, setExpiresWithin: filters.setExpiresWithin,
          matchAvailability: filters.matchAvailability, setMatchAvailability: filters.setMatchAvailability,
          hasAvailability: helperAvailability.length > 0,
          boostedOnly: filters.boostedOnly, setBoostedOnly: filters.setBoostedOnly,
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
