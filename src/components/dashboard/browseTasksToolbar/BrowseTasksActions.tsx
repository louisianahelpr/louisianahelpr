import { startTransition } from "react";
import { Search, SlidersHorizontal, List, Map as MapIcon } from "lucide-react";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { SavedSearches } from "@/components/SavedSearches";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

export interface BrowseTasksActionsProps {
  /** Dashboard filter state + setters (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  /** Signed-in user — gates the SavedSearches control. */
  user: SupaUser | null;
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /** Hide the List⇄Map toggle. On the desktop web the feed and map sit
   *  side by side, so the toggle is meaningless — both panes are visible. */
  hideViewToggle?: boolean;
}

/**
 * The Browse feed's icon cluster — view toggle · saved searches · search ·
 * filters.
 *
 * Returns a bare fragment of buttons rather than a wrapper, so the caller's
 * own flex row owns the gap. That is what lets Home line these up in the same
 * row as the notification bell at an even spacing: on Home the cluster is
 * lifted out of the panel toolbar and into PageScaffold's title card, beside
 * the emblem and the bell, leaving the toolbar row below to carry the large
 * "Browse jobs" title on its own (the iOS large-title pattern — one band of
 * chrome, big title beneath it).
 *
 * The guest dashboard still renders it inline inside BrowseTasksToolbar,
 * where it shares the row with the title.
 *
 * Every control here mutates `filters` / `view`, both of which are owned by
 * the page (useDashboardFilters / usePersistedBrowseView) and passed to BOTH
 * rows. Nothing is duplicated: `searchOpen` and `filtersOpen` live in that
 * shared filter state, so this cluster's search + filter buttons drive the
 * input and the sheet that BrowseTasksToolbar renders one row down.
 */
export function BrowseTasksActions({
  filters,
  user,
  view,
  setView,
  hideViewToggle = false,
}: BrowseTasksActionsProps) {
  return (
    <>
      {!hideViewToggle && (
        <Button
          variant="ghost"
          size="icon"
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
            minBudget: filters.minBudget,
            maxBudget: filters.maxBudget,
            locationFilter: filters.locationFilter,
          }}
          onApplySearch={(s) => {
            filters.setSelectedCategory(s.category);
            filters.setMinBudget(s.min_budget ? String(s.min_budget) : "");
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
    </>
  );
}

export default BrowseTasksActions;
