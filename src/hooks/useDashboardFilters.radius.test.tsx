// Regression guard for BD-001: the "Nearby" radius filter was a TOTAL NO-OP
// for logged-out visitors, behind a heading that said "Filtered Results".
//
// The mechanism was a missing column, not a broken formula. `open_jobs_browse`
// — the view BOTH browse feeds read — exposed no coordinates, so the haversine
// branch could never be taken; the code fell through to matching the viewer's
// saved `profiles.location` string against the job's, and a GUEST has no
// profile, so nothing was compared and every job survived. Measured on prod
// before the fix: a viewer pinned at Baton Rouge with `?loc=nearby:1` got all
// 10 open jobs, one of them 72.7 miles away.
//
// This lives in its own file because useDashboardFilters.test.tsx mocks
// useUserLocation to `{ status: "idle" }` for the whole module — which is the
// state in which the radius is deliberately NOT applied, so no test in that
// file can reach the branch that does the measuring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useDashboardFilters } from "./useDashboardFilters";

// The viewer's position, and whether we have one at all, is what selects
// between the three branches — so it is the thing each test varies.
const geo = vi.hoisted(() => ({
  state: { status: "ready", lat: 30.4515, lng: -91.1871 } as
    | { status: "ready"; lat: number; lng: number }
    | { status: "error"; message: string }
    | { status: "idle" },
}));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => geo.state }));
vi.mock("@/hooks/useDashboardJobsCount", () => ({
  useDashboardJobsCount: () => ({ data: undefined, isLoading: false }),
}));

beforeEach(() => {
  geo.state = { status: "ready", lat: 30.4515, lng: -91.1871 };
  try {
    window.localStorage.removeItem("helpr_browse_sort");
  } catch {
    /* jsdom always provides localStorage; defensive */
  }
});

// Old enough to clear the 20-minute Early Access delay.
const OLD_ENOUGH = new Date(Date.now() - 30 * 60 * 1000).toISOString();

/**
 * Real prod rows, with the coordinates the view now returns (jobs.latitude
 * rounded to 2dp) and their true distance from the pinned viewer, measured
 * with public.miles_between. These distances are what make the boundary
 * assertions below meaningful rather than arbitrary.
 */
const JOBS: Array<[string, number, number, number]> = [
  ["baton-rouge", 30.45, -91.19, 0.2],
  ["breaux-bridge", 30.27, -91.9, 44.2],
  ["lafayette", 30.23, -92.02, 52.0],
  ["crowley", 30.21, -92.37, 72.7],
];

function makeJob(id: string, lat: number | null, lng: number | null): EnrichedJob {
  return {
    id,
    customer_id: `c-${id}`,
    title: `Job ${id}`,
    description: "…",
    category: "yard_work",
    budget: 50,
    location: "Somewhere, LA",
    latitude: lat,
    longitude: lng,
    date_needed: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
    status: "open",
    is_urgent: false,
    isBoosted: false,
    expires_at: null,
    created_at: OLD_ENOUGH,
  } as unknown as EnrichedJob;
}

const ALL = JOBS.map(([id, lat, lng]) => makeJob(id, lat, lng));

/** Guests pass `profile: null` — the condition under which this was a no-op. */
function setup(allJobs: EnrichedJob[] = ALL) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    () =>
      useDashboardFilters({
        allJobs,
        userId: undefined,
        profile: null,
        helprTier: null,
        helperAvailability: [],
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    },
  );
}

describe("useDashboardFilters — Nearby radius (BD-001)", () => {
  it("filters a guest feed by real distance — 1 mile keeps only the job at 0.2 mi", () => {
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:1"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["baton-rouge"]);
  });

  it("holds the boundary in both directions at 50 mi (44.2 in, 52.0 out)", () => {
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:50"));
    expect(result.current.filteredJobs.map((j) => j.id).sort()).toEqual([
      "baton-rouge",
      "breaux-bridge",
    ]);
  });

  it("holds the boundary at 60 mi (52.0 in, 72.7 out)", () => {
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:60"));
    expect(result.current.filteredJobs.map((j) => j.id)).not.toContain("crowley");
    expect(result.current.filteredJobs).toHaveLength(3);
  });

  it("widening to 100 mi returns the full set", () => {
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:100"));
    expect(result.current.filteredJobs).toHaveLength(ALL.length);
  });

  it("clearing the radius returns the true full set", () => {
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:1"));
    expect(result.current.filteredJobs).toHaveLength(1);
    act(() => result.current.setLocationFilter(""));
    expect(result.current.filteredJobs).toHaveLength(ALL.length);
  });

  it("is NOT a no-op: at least one job is excluded at a tight radius", () => {
    // The literal shape of the original defect — every radius returned an
    // identical, unfiltered set. Asserting a count elsewhere could pass on a
    // feed that happened to be small; this asserts the sets actually differ.
    const { result } = setup();
    act(() => result.current.setLocationFilter("nearby:1"));
    const tight = result.current.filteredJobs.map((j) => j.id);
    act(() => result.current.setLocationFilter("nearby:100"));
    const wide = result.current.filteredJobs.map((j) => j.id);
    expect(tight.length).toBeLessThan(wide.length);
  });

  it("keeps a job with NO geocode rather than silently hiding the listing", () => {
    // A failed or pending geocode must not cost a poster their listing — that
    // is invisible to them and unrecoverable. Distance-unknown is kept.
    const { result } = setup([...ALL, makeJob("ungeocoded", null, null)]);
    act(() => result.current.setLocationFilter("nearby:1"));
    expect(result.current.filteredJobs.map((j) => j.id).sort()).toEqual([
      "baton-rouge",
      "ungeocoded",
    ]);
  });

  describe("when the viewer's location is unavailable", () => {
    it("leaves a usable feed rather than an empty one", () => {
      geo.state = { status: "error", message: "Location permission denied" };
      const { result } = setup();
      act(() => result.current.setLocationFilter("nearby:1"));
      expect(result.current.filteredJobs).toHaveLength(ALL.length);
    });

    it("reports nearbyUnavailable so the UI cannot claim a filter ran", () => {
      geo.state = { status: "error", message: "Location permission denied" };
      const { result } = setup();
      act(() => result.current.setLocationFilter("nearby:1"));
      expect(result.current.nearbyUnavailable).toBe(true);
    });

    it("does not report nearbyUnavailable once coordinates resolve", () => {
      const { result } = setup();
      act(() => result.current.setLocationFilter("nearby:1"));
      expect(result.current.nearbyUnavailable).toBe(false);
    });

    it("does not report nearbyUnavailable when no radius is selected", () => {
      geo.state = { status: "error", message: "Location permission denied" };
      const { result } = setup();
      expect(result.current.nearbyUnavailable).toBe(false);
    });
  });
});
