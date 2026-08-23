import type { Ref } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

export interface BrowseTasksActionsProps {
  /** Dashboard filter state + setters (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  /**
   * Forwarded to the Filters button so the desktop-web filter popover can
   * anchor to it. The panel is rendered by BrowseTasksToolbar, a different
   * component, so the two are joined by this ref rather than by a shared
   * <Popover> subtree. Omit it and nothing changes — the sheet still opens.
   */
  filtersButtonRef?: Ref<HTMLButtonElement>;
}

/**
 * The Browse feed's icon cluster — search · filters. Two buttons, the same two
 * My Posts / My Jobs carry, in the same trailing slot of the same
 * <ScreenHeaderRow>.
 *
 * It used to be four. The List⇄Map toggle and Saved searches moved INTO the
 * filter sheet (owner: "move saved filters and map view into the filter option
 * and move the rest up into the 1 column so it's the same size layout as jobs
 * and post") — see the "View" and "Saved searches" sections built in
 * BrowseTasksToolbar. Neither was dropped; both are one tap further in, and
 * labelled with words now instead of a bare glyph.
 *
 * Returns a bare fragment of buttons rather than a wrapper, so the header
 * row's own `gap-1` cluster owns the spacing.
 *
 * Both controls mutate `filters`, owned by the page (useDashboardFilters).
 * `searchOpen` and `filtersOpen` live in that shared state, so these buttons
 * drive the input and the sheet that BrowseTasksToolbar renders around them —
 * there is only ever one copy of each piece.
 */
export function BrowseTasksActions({ filters, filtersButtonRef }: BrowseTasksActionsProps) {
  return (
    <>
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
        ref={filtersButtonRef}
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
