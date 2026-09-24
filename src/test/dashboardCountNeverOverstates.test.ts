/**
 * @mutate src/hooks/useDashboardFilters.ts | totalMatchingCount: clientOnlyNarrowing ? null : totalMatchingCount, | totalMatchingCount,
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
    expect(def).toMatch(/nearbyMiles !== null/);
    expect(def).toMatch(/matchAvailability/);
  });
});
