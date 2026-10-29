/**
 * @mutate src/hooks/useDashboardFilters.ts | totalMatchingCount: clientOnlyNarrowing ? null : totalMatchingCount, | totalMatchingCount,
 * @mutate src/hooks/useDashboardFilters.ts |     nearbyApplied \|\| matchAvailability; |     matchAvailability;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// BD-008: the server count (useDashboardJobsCount) cannot express the radius or
// availability filters, so while either narrows the feed the header must fall
// back to the rendered count instead of stating a set that is not on screen.
const src = readFileSync("src/hooks/useDashboardFilters.ts", "utf8");

describe("dashboard header count (BD-008)", () => {
  it("nulls the server count while a client-only filter narrows the feed", () => {
    expect(src).toMatch(/totalMatchingCount:\s*clientOnlyNarrowing\s*\?\s*null\s*:\s*totalMatchingCount/);
  });
  it("counts both client-only filters as narrowing", () => {
    const def = src.match(/const clientOnlyNarrowing =([^;]+);/)?.[1] ?? "";
    // The radius counts once it actually runs (nearbyApplied, A2-B5): a picked radius with no location keeps every
    // job, so the server count is still the rendered set; an applied one (a fix or the parish centre) narrows it.
    expect(def).toMatch(/\bnearbyApplied\b/);
    expect(def).toMatch(/matchAvailability/);
    const applied = src.match(/const nearbyApplied =([^;]+);/)?.[1] ?? "";
    expect(applied.replace(/\s+/g, " ").trim()).toBe("nearbyMiles !== null && !nearbyUnavailable");
    const unavailable = src.match(/const nearbyUnavailable =([^;]+);/)?.[1] ?? "";
    expect(unavailable.replace(/\s+/g, " ").trim()).toBe('nearbyMiles !== null && userLoc.status !== "ready"');
  });
});
