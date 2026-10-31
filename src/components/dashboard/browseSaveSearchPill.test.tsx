/**
 * NIGHT-SAVEDS1-SS-4 (night audit, saved searches): the Saved searches empty state says "Search in Jobs or Declutter,
 * then tap Save this search", and Jobs Browse had no such pill with filters on (`/jobs?tab=browse&q=lawn&max=200`,
 * pill count 0). Jobs Browse now shows Declutter's pill whenever a filter a saved search keeps is on, and its draft
 * carries those filters.
 *
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       {user && (filters.searchQuery.trim() \|\| filters.selectedCategory | {false && (filters.searchQuery.trim() \|\| filters.selectedCategory
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |             maxDollars: filters.maxBudget ? Number(filters.maxBudget) : null, |             maxDollars: null,
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |             radiusMiles: filters.nearbyUnavailable ? null : filters.nearbyMiles, |             radiusMiles: filters.nearbyMiles,
 *
 * The pill loads on demand (lander, 10-31): a static import put SaveSearchButton and SaveSearchSheet into the entry
 * chunk's preload list (entry 5923 B gz, over the 5.5 KB critical-path budget; land.sh refused the train). The last
 * test keeps that import lazy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@supabase/supabase-js";

const seen = vi.hoisted(() => ({ drafts: [] as unknown[] }));
vi.mock("@/components/SavedSearches", () => ({ SavedSearches: () => null }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({
  SaveSearchButton: ({ draft }: { draft: unknown }) => {
    seen.drafts.push(draft);
    return <button type="button">Save this search</button>;
  },
}));

import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import type { BrowseTasksToolbarProps } from "@/components/dashboard/browseTasksToolbar/types";

const noop = () => {};
const base = {
  filtersOpen: false, setFiltersOpen: noop, activeFilterCount: 0, clearFilters: noop,
  selectedCategory: null, setSelectedCategory: noop, locationFilter: "", setLocationFilter: noop,
  sortBy: "smart", setSortBy: noop, expiresWithin: "", setExpiresWithin: noop, jobWhen: "", setJobWhen: noop,
  minBudget: "", setMinBudget: noop, maxBudget: "", setMaxBudget: noop, searchQuery: "", setSearchQuery: noop,
  matchAvailability: false, setMatchAvailability: noop, boostedOnly: false, setBoostedOnly: noop,
  urgentOnly: false, setUrgentOnly: noop, userLoc: { status: "idle" }, nearbyMiles: null,
  nearbyApproximate: false, nearbyUnavailable: false, nearbyApplied: false,
};
const user = { id: "u1" } as User;

function show(over: Record<string, unknown>, who: User | null = user) {
  seen.drafts = [];
  const filters = { ...base, ...over } as unknown as BrowseTasksToolbarProps["filters"];
  return render(
    <MemoryRouter>
      <BrowseTasksToolbar filters={filters} user={who} helperAvailability={[]} view="list" setView={noop} />
    </MemoryRouter>,
  );
}

describe("Jobs Browse: Save this search (SS-4)", () => {
  it("shows with words and a top price, and saves them as a Jobs search", async () => {
    show({ searchQuery: " lawn ", maxBudget: "200" });
    expect(await screen.findByRole("button", { name: "Save this search" })).toBeInTheDocument();
    expect(seen.drafts[seen.drafts.length - 1]).toEqual({ section: "jobs", query: "lawn", category: null, minDollars: null, maxDollars: 200, radiusMiles: null });
  });

  it("each kept filter alone shows it; a category, a low price and a distance are carried", async () => {
    let shown = 0;
    for (const over of [{ selectedCategory: "cleaning" }, { minBudget: "40" }, { nearbyMiles: 10, locationFilter: "nearby:10" }]) {
      const v = show(over);
      expect(await screen.findByRole("button", { name: "Save this search" })).toBeInTheDocument();
      shown++;
      v.unmount();
    }
    expect(shown).toBeGreaterThan(2);
    show({ selectedCategory: "cleaning", minBudget: "40", nearbyMiles: 10, locationFilter: "nearby:10" });
    await screen.findByRole("button", { name: "Save this search" });
    expect(seen.drafts[seen.drafts.length - 1]).toEqual({ section: "jobs", query: "", category: "cleaning", minDollars: 40, maxDollars: null, radiusMiles: 10 });
  });

  it("not with no filter, not for a guest, and a distance that could not run is not saved as one", async () => {
    let v = show({});
    expect(screen.queryByRole("button", { name: "Save this search" })).toBeNull();
    v.unmount();
    v = show({ searchQuery: "lawn" }, null);
    expect(screen.queryByRole("button", { name: "Save this search" })).toBeNull();
    v.unmount();
    // No coordinates: the radius is not applied (useDashboardFilters), so the pill must not save a radius.
    v = show({ nearbyMiles: 10, locationFilter: "nearby:10", nearbyUnavailable: true });
    expect(screen.queryByRole("button", { name: "Save this search" })).toBeNull();
    v.unmount();
    show({ nearbyMiles: 10, locationFilter: "nearby:10", nearbyUnavailable: true, searchQuery: "lawn" });
    await screen.findByRole("button", { name: "Save this search" });
    expect(seen.drafts[seen.drafts.length - 1]).toMatchObject({ query: "lawn", radiusMiles: null });
  });

  it("the pill stays out of the entry chunk: BrowseTasksToolbar imports it lazily, never statically", () => {
    const src = readFileSync("src/components/dashboard/BrowseTasksToolbar.tsx", "utf8");
    expect(src).not.toMatch(/^import\s[^;]*\bfrom\s+["']@\/components\/savedSearches\/SaveSearchButton["']/m);
    expect(src).toMatch(/lazy\(\(\) => import\("@\/components\/savedSearches\/SaveSearchButton"\)/);
  });
});
