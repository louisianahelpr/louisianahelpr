import { lazy, Suspense, useContext } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { ScrollAwayContext, useOverlay } from "@/components/sections/ScrollAwayScope";

// SS-4's pill loads on demand: a static import split SaveSearchButton and its sheet into chunks of their own and put
// both names in the entry chunk's preload list (entry 5.8 KB gz, over the 5.5 KB budget; Q178).
const SaveSearchButton = lazy(() => import("@/components/savedSearches/SaveSearchButton").then((m) => ({ default: m.SaveSearchButton })));

/**
 * Jobs Browse's "Save this search" row (NIGHT-SAVEDS1-SS-4), shown when a filter a saved search keeps is on: words,
 * category, price, distance.
 *
 * Deep audit 11-22 #29: on a phone Jobs' tabs and category chips overlay the top of the list and slide away while it
 * scrolls (ScrollAway.tsx); only the list reserves their height (ScrollAwaySpacer), so the row, drawn in the toolbar
 * between the chips and the list, sat UNDER the chips: not tappable, an empty gap above the first result. `place`
 * says where this copy draws: "toolbar" draws only when the chips do not overlay (desktop, map), "list" draws only
 * when they do, right after the spacer inside the list, so it is always below the chips and scrolls with the jobs.
 */
export function JobsSaveSearchRow({ filters, user, place }: {
  filters: ReturnType<typeof useDashboardFilters>;
  user: SupaUser | null;
  place: "toolbar" | "list";
}) {
  const overlay = useOverlay(useContext(ScrollAwayContext));
  if ((place === "list") !== overlay) return null;
  const on = !!user && (filters.searchQuery.trim() || filters.selectedCategory || filters.minBudget || filters.maxBudget || (filters.nearbyMiles !== null && !filters.nearbyUnavailable));
  if (!on || !user) return null;
  return (
    <Suspense fallback={null}>
      <div data-jobs-save-search={place} className={place === "list" ? "pt-2" : undefined}>
        <SaveSearchButton
          userId={user.id}
          draft={{
            section: "jobs",
            query: filters.searchQuery.trim(),
            category: filters.selectedCategory,
            minDollars: filters.minBudget ? Number(filters.minBudget) : null,
            maxDollars: filters.maxBudget ? Number(filters.maxBudget) : null,
            radiusMiles: filters.nearbyUnavailable ? null : filters.nearbyMiles,
          }}
        />
      </div>
    </Suspense>
  );
}
