import type { RefObject } from "react";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";

/**
 * Browse's search + filter as ONE compact row (owner, 2026-10-19: "search +
 * filter take too much space"): a slim, always-open search field with the
 * Filters button inside its right edge, the height of a chip. Used where the
 * section's own top bar replaces the old brand row (Jobs & Posts > Browse).
 * It is the shared SectionSearchRow every section's Browse wears.
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
  return (
    <SectionSearchRow
      testId="browse-compact-search"
      value={filters.searchQuery}
      onChange={filters.setSearchQuery}
      placeholder={placeholder}
      filterCount={filters.activeFilterCount}
      filtersOpen={filters.filtersOpen}
      onFilters={() => filters.setFiltersOpen(!filters.filtersOpen)}
      filtersButtonRef={filtersButtonRef}
    />
  );
}
