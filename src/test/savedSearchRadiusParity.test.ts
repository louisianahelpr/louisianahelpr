/**
 * CLASS GUARD (Q54, front/back parity, matrix row "saved-search radius > 0"):
 * every radius the client can hand to a saved_searches insert is one the
 * saved_searches_radius_miles_positive CHECK accepts.
 *
 * The radius reaches SavedSearches.handleSave as parseNearbyFilter(locationFilter),
 * and locationFilter is seeded from the `?loc=` URL param (useDashboardFilters),
 * so it is not limited to the chips. Before 2026-09-27 `?loc=nearby:0` parsed to
 * 0, and saving that search was refused by the CHECK (23514) after the user
 * pressed Save. Now a radius the server would refuse parses to null (no radius).
 *
 * @mutate src/lib/geo.ts | return Number.isFinite(miles) && miles > 0 ? miles : null; | return m ? miles : null;
 * @mutate src/components/dashboard/JobFilters.tsx | const radiusOptions = [5, 10, 25, 50]; | const radiusOptions = [0, 5, 10, 25, 50];
 * @mutate supabase/migrations/20260901035245_seed_visibility_server_authority_and_saved_search_matching.sql | CHECK (radius_miles IS NULL OR radius_miles > 0); | CHECK (radius_miles IS NULL OR radius_miles > 10);
 */
import { describe, it, expect } from "vitest";
import { extractConstraints } from "./helpers/schemaConstraints";
import { readCode } from "./helpers/parityReaders";
import { parseNearbyFilter } from "@/lib/geo";

function radiusCheck() {
  const c = extractConstraints().get("saved_searches")?.get("saved_searches_radius_miles_positive");
  if (!c || c.kind !== "range" || c.min === null) {
    throw new Error(`saved_searches_radius_miles_positive is not a parsed lower bound: ${JSON.stringify(c)}`);
  }
  return c;
}

function accepts(miles: number | null): boolean {
  const c = radiusCheck();
  if (miles === null) return c.nullable;
  const lo = c.min as number;
  if (c.exclusiveMin ? !(miles > lo) : !(miles >= lo)) return false;
  if (c.max !== null && (c.exclusiveMax ? !(miles < c.max) : !(miles <= c.max))) return false;
  return true;
}

/** The radius chips, read from source: `const radiusOptions = [ ... ]`. */
function radiusChips(): number[] {
  const rel = "src/components/dashboard/JobFilters.tsx";
  const m = /\bconst\s+radiusOptions\s*=\s*\[([^\]]*)\]/.exec(readCode(rel));
  if (!m) throw new Error(`${rel}: no radiusOptions array`);
  const nums = m[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) throw new Error(`${rel}: unreadable radiusOptions ${m[1]}`);
  return nums;
}

describe("saved-search radius: client == saved_searches_radius_miles_positive", () => {
  it("reads a real CHECK and real chips (floor)", () => {
    expect(radiusCheck().column).toBe("radius_miles");
    expect(radiusChips().length).toBeGreaterThan(0);
  });

  it("every radius chip is a value the CHECK accepts", () => {
    const refused = radiusChips().filter((mi) => !accepts(mi));
    expect(refused).toEqual([]);
  });

  it("no ?loc= token parses to a radius the CHECK refuses", () => {
    const tokens = ["", "nearby:0", "nearby:0.0", "nearby:00", "nearby:-5", "nearby:0.5", "nearby:5", "nearby:25", "nearby:1e3", "junk"];
    const refused = tokens
      .map((t) => ({ t, r: parseNearbyFilter(t) }))
      .filter(({ r }) => !accepts(r))
      .map(({ t, r }) => `${t} -> ${r}`);
    expect(refused).toEqual([]);
  });
});
