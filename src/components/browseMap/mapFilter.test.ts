// Regression tests for the Browse map's filter predicate. The map used to
// ignore filters entirely (it runs its own fetch, so it never saw the list's
// `filteredJobs`) — tapping a category chip changed the list and left every
// pin in place. These lock the predicate to the list's semantics.

import { describe, it, expect } from "vitest";
import { buildMapJobFilter, isAnyFilterActive, unsupportedMapFilters, type MapJobFilterInput } from "./mapFilter";
import type { MapJob } from "./config";

const NONE: MapJobFilterInput = {
  selectedCategory: null,
  searchQuery: "",
  minBudget: "",
  maxBudget: "",
  urgentOnly: false,
  boostedOnly: false,
  expiresWithin: "",
  matchAvailability: false,
  nearbyMiles: null,
  userLoc: null,
  earlyAccessDelayMs: 0,
};

const job = (over: Partial<MapJob> = {}): MapJob => ({
  id: "j1",
  title: "Mow the front lawn",
  category: "yard_work",
  budget: 60,
  is_urgent: false,
  latitude: 30.45,
  longitude: -91.15, // Baton Rouge
  parish: "East Baton Rouge",
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  ...over,
});

describe("buildMapJobFilter", () => {
  it("keeps everything when no filter is set", () => {
    expect(buildMapJobFilter(NONE)(job())).toBe(true);
  });

  it("filters by category — the reported 'clicked errands and nothing filtered' bug", () => {
    const f = buildMapJobFilter({ ...NONE, selectedCategory: "errands" });
    expect(f(job({ category: "errands" }))).toBe(true);
    expect(f(job({ category: "yard_work" }))).toBe(false);
  });

  it("matches the search query against the title, case-insensitively", () => {
    const f = buildMapJobFilter({ ...NONE, searchQuery: "  LAWN " });
    expect(f(job({ title: "Mow the front lawn" }))).toBe(true);
    expect(f(job({ title: "Walk my dog" }))).toBe(false);
  });

  it("applies the budget band inclusively at both ends", () => {
    const f = buildMapJobFilter({ ...NONE, minBudget: "50", maxBudget: "150" });
    expect(f(job({ budget: 50 }))).toBe(true);
    expect(f(job({ budget: 150 }))).toBe(true);
    expect(f(job({ budget: 49 }))).toBe(false);
    expect(f(job({ budget: 151 }))).toBe(false);
  });

  it("filters to urgent only", () => {
    const f = buildMapJobFilter({ ...NONE, urgentOnly: true });
    expect(f(job({ is_urgent: true }))).toBe(true);
    expect(f(job({ is_urgent: false }))).toBe(false);
  });

  it("applies the nearby radius when coords are known", () => {
    const f = buildMapJobFilter({
      ...NONE,
      nearbyMiles: 25,
      userLoc: { lat: 30.45, lng: -91.15 },
    });
    expect(f(job())).toBe(true);
    // New Orleans is ~65mi from Baton Rouge.
    expect(f(job({ latitude: 29.95, longitude: -90.07 }))).toBe(false);
  });

  it("ignores the nearby radius when the viewer's coords aren't resolved", () => {
    const f = buildMapJobFilter({ ...NONE, nearbyMiles: 5, userLoc: null });
    expect(f(job({ latitude: 29.95, longitude: -90.07 }))).toBe(true);
  });

  it("honours the subscription early-access delay, so the map can't leak jobs the list holds back", () => {
    const f = buildMapJobFilter({ ...NONE, earlyAccessDelayMs: 20 * 60 * 1000 });
    expect(f(job({ created_at: new Date(Date.now() - 60_000).toISOString() }))).toBe(false);
    expect(f(job({ created_at: new Date(Date.now() - 30 * 60_000).toISOString() }))).toBe(true);
  });
});

describe("isAnyFilterActive", () => {
  it("is false for a pristine filter state", () => {
    expect(isAnyFilterActive(NONE)).toBe(false);
  });

  it("is true for a whitespace-only search but false for an empty one", () => {
    expect(isAnyFilterActive({ ...NONE, searchQuery: "   " })).toBe(false);
    expect(isAnyFilterActive({ ...NONE, searchQuery: "lawn" })).toBe(true);
  });

  it("counts filters the map can't apply — the viewer still turned them on", () => {
    expect(isAnyFilterActive({ ...NONE, boostedOnly: true })).toBe(true);
  });
});

describe("unsupportedMapFilters", () => {
  it("names only the filters the narrow map row has no field for", () => {
    expect(unsupportedMapFilters(NONE)).toEqual([]);
    expect(
      unsupportedMapFilters({ ...NONE, boostedOnly: true, expiresWithin: "24h", matchAvailability: true }),
    ).toEqual(["Boosted", "Ending soon", "Matches my availability"]);
  });

  it("does not name filters it CAN apply", () => {
    expect(unsupportedMapFilters({ ...NONE, selectedCategory: "errands", urgentOnly: true })).toEqual([]);
  });
});
