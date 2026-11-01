/**
 * A2-B5 (audit 2026-10-28): before the viewer shares a location, a picked
 * distance (5 mi) is deliberately NOT applied (useDashboardFilters keeps every
 * job, nearbyUnavailable). The Browse copy still read the raw radius, so the
 * end card said "That's everything nearby." with "Widen to 25 mi" under a job
 * 58.8 mi away, and the empty state offered "Widen to N mi" for a radius that
 * had never run. Every Browse surface that words a distance result must read
 * the hook's `nearbyApplied`, never re-derive "a radius is picked" itself.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | const nearby = filters.nearbyApplied; | const nearby = filters.nearbyMiles !== null;
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | const nearbyActive = filters.nearbyApplied; | const nearbyActive = filters.nearbyMiles !== null;
 * @mutate src/pages/home/DashboardGuest.tsx | const nearbyActive = filters.nearbyApplied; | const nearbyActive = filters.nearbyMiles !== null;
 * @mutate src/hooks/useDashboardFilters.ts | const nearbyApplied = nearbyMiles !== null && !nearbyUnavailable; | const nearbyApplied = nearbyMiles !== null;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

// Every Browse surface that words a radius result (end card, empty state).
const SURFACES: [string, number][] = [
  ["src/components/dashboard/BrowseTasksFeed.tsx", 2],
  ["src/pages/home/DashboardGuest.tsx", 1],
];

describe("distance copy only claims a radius that ran (A2-B5)", () => {
  it("the hook defines nearbyApplied from nearbyUnavailable", () => {
    expect(src("src/hooks/useDashboardFilters.ts")).toMatch(
      /const nearbyApplied = nearbyMiles !== null && !nearbyUnavailable;/,
    );
  });
  // Vacuity floor: both Browse feeds, three call sites.
  it("checks both Browse feeds", () => {
    expect(SURFACES.flatMap(([f]) => src(f).match(/= filters\.nearbyApplied;/g) ?? []).length).toBeGreaterThan(2);
  });
  for (const [f, n] of SURFACES) {
    it(`${f} reads filters.nearbyApplied (${n}x) and never the raw radius`, () => {
      const s = src(f);
      expect(s.match(/= filters\.nearbyApplied;/g)?.length ?? 0).toBe(n);
      expect(s).not.toMatch(/filters\.nearbyMiles !== null/);
      expect(s).not.toMatch(/locationFilter\.startsWith\("nearby:"\)/);
    });
  }
});
