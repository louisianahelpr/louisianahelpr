/**
 * B82 (2026-11-01): declutter_first_screen sorts a member with no position on file from the SAME parish point the
 * browser measures miles from (useDeclutterOrigin -> deriveFallbackLocation -> getParishCentroid), and returns it as
 * `near`. Browse shows the capped answer ahead of the full read only when previewIsTopOfList(near, origin) holds, so
 * a copy that drifts from src/lib/parishCentroids.ts (a point moved, a parish missing) silently puts that member back
 * on the full listings read plus the photo read before any card (measured: first photo ~8.4 s on Slow 4G).
 *
 * The SQL table is read from the NEWEST effective definition (effectiveDefs: any dollar tag, comments blanked).
 * PGlite proof of the order itself: src/test/pglite/declutterFirstScreenParishOrigin.pglite.mjs.
 *
 * @mutate src/lib/parishCentroids.ts | "Lafayette": { lat: 30.2241, lng: -92.0198 }, | "Lafayette": { lat: 30.2242, lng: -92.0198 },
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { PARISH_CENTROIDS, getParishCentroid } from "@/lib/parishCentroids";
import { previewIsTopOfList } from "@/lib/declutter/bootPrefetch";

const DIR = join(process.cwd(), "supabase/migrations");

function sqlCentroids(): Map<string, { lat: number; lng: number }> {
  const def = effectiveDefs(DIR).get("declutter_first_screen");
  if (!def) throw new Error("declutter_first_screen has no definition");
  const body = blankSqlComments(def.stmt);
  const block = /FROM \(VALUES([\s\S]*?)\) AS c\(name, lat, lng\)/.exec(body)?.[1] ?? "";
  const out = new Map<string, { lat: number; lng: number }>();
  for (const m of block.matchAll(/\('((?:[^']|'')+)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g)) {
    out.set(m[1].replace(/''/g, "'"), { lat: Number(m[2]), lng: Number(m[3]) });
  }
  return out;
}

describe("declutter_first_screen sorts from the browser's parish point", () => {
  it("its parish table is exactly PARISH_CENTROIDS, both ways", () => {
    const sql = sqlCentroids();
    const ts = new Map(Object.entries(PARISH_CENTROIDS));
    expect(ts.size).toBeGreaterThan(60);
    expect([...sql.keys()].sort()).toEqual([...ts.keys()].sort());
    for (const [name, p] of ts) expect(sql.get(name), name).toEqual(p);
  });

  it("the point the server sends back is the browser's origin, so the preview is the top of the list", () => {
    // The server's `near` is that SQL number, through JSON; the browser's origin is getParishCentroid's.
    for (const [name, p] of sqlCentroids()) {
      const near = JSON.parse(JSON.stringify({ lat: p.lat, lng: p.lng })) as { lat: number; lng: number };
      expect(previewIsTopOfList(near, getParishCentroid(name), true), name).toBe(true);
    }
  });

  it("it reads the ZIP's parish first, then the profile's, and only with no position on file", () => {
    const body = blankSqlComments(effectiveDefs(DIR).get("declutter_first_screen")?.stmt ?? "");
    expect(body).toMatch(/IF NOT v_has_position THEN/);
    expect(body).toMatch(/v_zip_parish := public\.get_parish_for_zip\(v_zip\)/);
    expect(body).toMatch(/ORDER BY \(c\.name = trim\(regexp_replace\(COALESCE\(v_zip_parish, ''\)[^)]*\)\)\) DESC/);
  });
});
