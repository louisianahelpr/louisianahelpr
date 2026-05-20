import { motion, AnimatePresence } from "framer-motion";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Clock, MapPin, Search, SlidersHorizontal, X, List, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SavedSearches } from "@/components/SavedSearches";
import JobFilters, { categoryLabels } from "@/components/dashboard/JobFilters";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

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
}: BrowseTasksToolbarProps) {
  return (
    <>
      {/* Header row */}
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
              : "For you, today"}
          </span>
          <h2
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "1.25rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.018em",
            }}
          >
            {filters.hasFilters ? "Filtered Results" : "Browse Tasks"}
          </h2>
          {/* Subtitle hidden when 0 jobs — the empty-state card
              below already says "Nothing nearby just yet" in a much
              more prominent way. Showing "0 jobs" here too is
              redundant noise. */}
          {filters.filteredJobs.length > 0 && (
            <span
              className="font-serif italic mt-0.5 text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {filters.filteredJobs.length}{" "}
              {filters.filteredJobs.length === 1 ? "job" : "jobs"}
            </span>
          )}
        </div>
        {(() => {
          // When there are zero open jobs AND no active filters, the
          // toolbar (saved-searches / search / filters) has nothing
          // useful to do. Dim it (opacity 50%, no pointer events) so
          // the eye doesn't get pulled to dead controls on an empty
          // screen. Still rendered for layout continuity.
          const isEmptyAndUnfiltered = filters.filteredJobs.length === 0 && !filters.hasFilters;
          return (
            <div
              className={`flex items-center gap-1 transition-opacity ${isEmptyAndUnfiltered ? "opacity-40 pointer-events-none" : ""}`}
              aria-hidden={isEmptyAndUnfiltered ? "true" : undefined}
            >
              {filters.hasFilters && (
                <Button variant="ghost" size="sm" onClick={filters.clearFilters} className="text-ds-11 text-muted-foreground hover:text-destructive h-8 rounded-ds-md btn-press">
                  <X className="w-3 h-3 mr-1" /> Clear
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
                className={`h-8 w-8 rounded-ds-md btn-press ${filters.searchOpen || filters.searchQuery ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                aria-label="Search jobs"
                aria-expanded={filters.searchOpen}
              >
                <Search className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { filters.setFiltersOpen(!filters.filtersOpen); if (filters.searchOpen) filters.setSearchOpen(false); }}
                className={`h-8 w-8 rounded-ds-md btn-press relative ${filters.filtersOpen || filters.activeFilterCount > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                aria-label={filters.activeFilterCount > 0 ? `Filters (${filters.activeFilterCount} active)` : "Filters"}
                aria-expanded={filters.filtersOpen}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {filters.activeFilterCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
                    {filters.activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
          );
        })()}
      </div>

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
                placeholder="Search tasks…"
                value={filters.searchQuery}
                onChange={(e) => filters.setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md border border-border/50 bg-muted/30 focus:bg-background focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
              />
              {filters.searchQuery && (
                <button onClick={() => filters.setSearchQuery("")} aria-label="Clear search" className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expandable filters panel — capped at 50vh so it doesn't
          push the job list off screen on small phones. The panel
          scrolls internally if its content is taller than the cap. */}
      <AnimatePresence>
        {filters.filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden border-b border-border/30"
          >
            <JobFilters
              searchQuery={filters.searchQuery} setSearchQuery={filters.setSearchQuery}
              selectedCategory={filters.selectedCategory} setSelectedCategory={filters.setSelectedCategory}
              maxBudget={filters.maxBudget} setMaxBudget={filters.setMaxBudget}
              locationFilter={filters.locationFilter} setLocationFilter={filters.setLocationFilter}
              sortBy={filters.sortBy} setSortBy={filters.setSortBy}
              filtersOpen={true} setFiltersOpen={filters.setFiltersOpen}
              expiresWithin={filters.expiresWithin} setExpiresWithin={filters.setExpiresWithin}
              matchAvailability={filters.matchAvailability} setMatchAvailability={filters.setMatchAvailability}
              hasAvailability={helperAvailability.length > 0}
              boostedOnly={filters.boostedOnly} setBoostedOnly={filters.setBoostedOnly}
              userLocStatus={filters.userLoc?.status}
              userLocMessage={filters.userLoc?.status === "error" ? filters.userLoc.message : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active filter chips */}
      {!filters.filtersOpen && (filters.selectedCategory || filters.locationFilter || filters.maxBudget || filters.expiresWithin || filters.matchAvailability) && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30">
          {filters.selectedCategory && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
              {categoryLabels[filters.selectedCategory]}
              <button onClick={() => filters.setSelectedCategory(null)} aria-label="Clear category filter" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.locationFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
              <MapPin className="w-3 h-3" />
              {filters.locationFilter.startsWith("nearby:")
                ? `Within ${filters.locationFilter.slice(7)} mi`
                : filters.locationFilter}
              <button onClick={() => filters.setLocationFilter("")} aria-label="Clear location filter" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.maxBudget && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
              ≤ ${filters.maxBudget}
              <button onClick={() => filters.setMaxBudget("")} aria-label="Clear max budget" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.expiresWithin && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
              {filters.expiresWithin}
              <button onClick={() => filters.setExpiresWithin("")} aria-label="Clear expiry filter" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.matchAvailability && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
              <Clock className="w-3 h-3" /> My hours
              <button onClick={() => filters.setMatchAvailability(false)} aria-label="Clear availability filter" className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* List ⇄ Map toggle — hidden when 0 jobs because the map
          would show an empty Louisiana with no pins, making the
          toggle a UI-noise tax. Re-appears the moment jobs land. */}
      {filters.filteredJobs.length > 0 && (
        <div className="px-3 pt-3 pb-1">
          <div className="flex gap-1 p-1 bg-muted/40 rounded-ds-md border border-border w-full max-w-xs mx-auto">
            <button
              onClick={() => setView("list")}
              className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-ds-sm text-ds-11 font-medium transition-colors ${
                view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button
              onClick={() => setView("map")}
              className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-ds-sm text-ds-11 font-medium transition-colors ${
                view === "map" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" /> Map
            </button>
          </div>
        </div>
      )}
    </>
  );
}
