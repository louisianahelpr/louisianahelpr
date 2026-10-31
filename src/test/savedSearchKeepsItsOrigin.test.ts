/**
 * BUY-49: a Declutter distance alert measured from the profile, while Browse measures from the device or ZIP. Behaviour
 * of the sender: src/test/pglite/savedSearchKeepsItsOrigin.pglite.mjs.
 *
 * @mutate supabase/migrations/20261031224850_saved_search_price_drop_counts.sql |                OR (COALESCE(s.origin_lat, p.latitude) IS NOT NULL AND COALESCE(s.origin_lng, p.longitude) IS NOT NULL\n                    AND public.miles_between(COALESCE(s.origin_lat, p.latitude), | OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL\n                    AND public.miles_between(p.latitude,
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | radiusMiles: from ? maxMiles : null, origin: from ?? null, extras | radiusMiles: from ? maxMiles : null, extras
 * @mutate src/lib/savedSearches.ts |   const origin = d.origin && d.radiusMiles ? |   const origin = false ?
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const h = vi.hoisted(() => {
  const inserts: Array<Record<string, unknown>> = [];
  const results: Array<{ data: unknown; error: unknown }> = [];
  return { inserts, results };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.inserts.push(row);
        return { select: async () => h.results.shift() ?? { data: [{ id: "s1" }], error: null } };
      },
    }),
  },
}));

import { createSavedSearch } from "@/lib/savedSearches";

const draft = { section: "declutter" as const, query: "mug", category: null, minDollars: null, maxDollars: null };

describe("a saved search keeps where it measured from", () => {
  beforeEach(() => { h.inserts.length = 0; h.results.length = 0; });

  it("saves the origin, rounded, only with a radius", async () => {
    await createSavedSearch("u", { ...draft, radiusMiles: 25, origin: { lat: 30.2241, lng: -92.0198 } }, true);
    expect(h.inserts[0]).toMatchObject({ radius_miles: 25, origin_lat: 30.22, origin_lng: -92.02 });
    await createSavedSearch("u", { ...draft, radiusMiles: null, origin: { lat: 30.2241, lng: -92.0198 } }, true);
    expect(h.inserts[1]).not.toHaveProperty("origin_lat");
  });

  it("a database not yet deployed still saves the search, without the origin", async () => {
    h.results.push({ data: null, error: { code: "PGRST204", message: "column" } });
    await expect(createSavedSearch("u", { ...draft, radiusMiles: 25, origin: { lat: 30, lng: -92 } }, true)).resolves.toBe("s1");
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[1]).not.toHaveProperty("origin_lat");
  });

  it("the sender and the N new count read the saved origin first", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(500);
    for (const fn of ["deliver_saved_search_item_alerts", "saved_search_new_counts"]) {
      expect(blankSqlComments(defs.get(fn)?.stmt ?? ""), fn).toContain("public.miles_between(COALESCE(s.origin_lat, p.latitude), COALESCE(s.origin_lng, p.longitude)");
    }
  });

  it("Browse hands over the origin it measured from", () => {
    expect(blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterBrowseView.tsx"), "utf8"))).toContain("radiusMiles: from ? maxMiles : null, origin: from ?? null, extras: saveExtras }");
  });
});
