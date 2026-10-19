import type { RefObject } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

/**
 * Browse's search + filter as ONE compact row (owner, 2026-10-19: "search +
 * filter take too much space"): a slim, always-open search field with the
 * Filters button inside its right edge, the height of a chip. Used where the
 * section's own top bar replaces the old brand row (Jobs & Posts > Browse).
 */
export function BrowseCompactSearchRow({
  filters,
  filtersButtonRef,
  placeholder = "Search jobs",
}: {
  filters: ReturnType<typeof useDashboardFilters>;
  filtersButtonRef?: RefObject<HTMLButtonElement>;
  placeholder?: string;
}) {
  const active = filters.activeFilterCount > 0;
  return (
    <div className="flex items-center gap-2 h-10 pl-3.5 pr-1 rounded-full border border-border bg-card" data-testid="browse-compact-search">
      <Search className="w-[18px] h-[18px] text-muted-foreground shrink-0" aria-hidden />
      <input
        type="search"
        value={filters.searchQuery}
        onChange={(e) => filters.setSearchQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className="flex-1 min-w-0 bg-transparent text-ds-15 outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {filters.searchQuery && (
        <button type="button" aria-label="Clear search" onClick={() => filters.setSearchQuery("")} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground">
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
      <button
        ref={filtersButtonRef}
        type="button"
        onClick={() => filters.setFiltersOpen(!filters.filtersOpen)}
        aria-label={active ? `Filters (${filters.activeFilterCount} active)` : "Filters"}
        aria-expanded={filters.filtersOpen}
        className={`btn-press relative w-8 h-8 rounded-full flex items-center justify-center ${active || filters.filtersOpen ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]" : "text-muted-foreground"}`}
      >
        <SlidersHorizontal className="w-[18px] h-[18px]" aria-hidden />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
            {filters.activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
