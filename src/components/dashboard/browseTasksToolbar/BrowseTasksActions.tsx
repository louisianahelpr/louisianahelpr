import type { Ref } from "react";
import { Bookmark, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

export interface BrowseTasksActionsProps {
  /** Show ONLY saved jobs. Owner: "how can they see saved jobs? add a button
   *  by search" — saving a job had no destination at all before this, so the
   *  bookmark on every card wrote to a list nobody could open. Optional: the
   *  guest feed has no saved jobs and passes neither. */
  savedOnly?: boolean;
  onToggleSavedOnly?: () => void;
  /** How many are saved — shown on the button so an empty list is visible
   *  BEFORE the tap rather than after it. */
  savedCount?: number;
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
/**
 * Saved moved into the filter sheet on EVERY surface (owner) — it is a filter,
 * and it was the last control that was an icon here but a row there.
 *
 * Kept as a named flag rather than deleting the branch: the button, its count
 * badge and its pressed styling are one edit from returning if the decision
 * reverses, and a bare `false &&` is a lint error (constant condition) as well
 * as being unreadable at the call site.
 */
const SAVED_IN_TOOLBAR = false as boolean;

export function BrowseTasksActions({
  filters,
  filtersButtonRef,
  savedOnly = false,
  onToggleSavedOnly,
  savedCount = 0,
}: BrowseTasksActionsProps) {
  return (
    <>
      {/* Saved moved into the filter sheet on EVERY surface (owner) — it is a
          filter, and it was the last control that was an icon here but a row
          there. `false &&` rather than deletion: the button, its badge and its
          pressed styling are one edit away if it ever comes back to the row. */}
      {SAVED_IN_TOOLBAR && onToggleSavedOnly && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSavedOnly}
          aria-pressed={savedOnly}
          aria-label={
            savedOnly
              ? "Show all jobs"
              : `Show saved jobs${savedCount ? ` (${savedCount})` : ""}`
          }
          className={`h-10 w-10 rounded-ds-md btn-press relative focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
            savedOnly
              ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]"
              : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"
          }`}
        >
          <Bookmark
            className="w-5 h-5"
            fill={savedOnly ? "currentColor" : "none"}
          />
          {savedCount > 0 && !savedOnly && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
              {savedCount > 9 ? "9+" : savedCount}
            </span>
          )}
        </Button>
      )}
      {/* SEARCH IS AN ICON ON EVERY SURFACE, PHONE INCLUDED.
          It used to be hidden behind a `compact` flag on phone and native,
          which left the Browse brand row as emblem + filter + bell with a
          MEASURED 158px hole in the middle of it (375px, Chrome, seeded
          account: emblem ends x78, the first icon starts x236) and put the
          only route to search two taps deep inside the Filters sheet — a
          drawer nobody opens looking for a search box. My Posts and My Jobs
          both carry a "Search jobs" icon in the same slot on the same phone
          width, so Browse was also the odd screen out.
          The width argument the flag rested on was measured when this cluster
          was FIVE controls (search, saved, view, filters + the live pill).
          Saved, View and Saved-searches have all since moved into the sheet,
          so the row is now emblem + search + filter + bell: 156px of controls
          against 201px of room at 320, and 158px of slack at 375 — the hole
          this fills. */}
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
