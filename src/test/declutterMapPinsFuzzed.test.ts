/**
 * DECLUTTER MAP PINS NEVER CARRY THE SELLER'S HOUSE (owner decision 2026-10-28, via the lead: "Declutter map pins are
 * a ROUGH AREA: each item's pin is moved to a spot within about half a mile (like Facebook Marketplace); the seller's
 * house is never shown; the exact spot is shared only after a sale, exactly as today").
 *
 * The browser must never receive a listing's exact pickup point before a sale, nor anything that narrows it beyond
 * the area cell members already read (area_lat/area_lng, the point rounded to 2 decimals). The point lives only in
 * declutter_item_private (no client privilege); the Browse map reads declutter_map_pins, which returns each item's
 * PUBLIC area point moved up to 300 m by a salted, stable offset, and never reads the pickup point at all
 * (lh-authz-rls review of the first draft: an offset anchored on the exact point, intersected with the public cell,
 * narrowed the house to ~106-190 m for 1-5% of items, and two geocodes of one address averaged back to it). This guard
 * reads the NEWEST definition of declutter_map_pins (any dollar-quote tag) and fails if:
 *   1. it stops being a SECURITY DEFINER behind require_feature('declutter') with EXECUTE revoked from anon;
 *   2. it reads declutter_item_private or any pickup_ column, or its returned point is not the public area point moved
 *      by the offset in BOTH coordinates, or the offset can exceed 300 m;
 *   3. the offset stops being seeded by the secret salt, or the salt table is ever granted to a client role;
 * and on the client if:
 *   4. the Browse map plots anything but the RPC's pins (area_lat/area_lng or any pickup field), or any client code
 *      reads declutter_item_private.
 * Behaviour under the real roles (pins within 300 m of the public point, unmoved by the exact point, stable, refused
 * for a non-tester; two planted defects red): src/test/pglite/declutterMapPins.pglite.mjs.
 *
 * @mutate supabase/migrations/20261102023411_declutter_map_pins_hide_blocked.sql | round((m.area_lat::double precision + m.r_m * cos(m.theta) / 111320.0)::numeric, 4), | m.area_lat::numeric,
 * @mutate supabase/migrations/20261102023411_declutter_map_pins_hide_blocked.sql | SELECT i.id, i.seller_id, i.area_lat, i.area_lng\n        FROM public.declutter_items i\n | SELECT i.id, i.seller_id, p.pickup_lat AS area_lat, p.pickup_lng AS area_lng\n        FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id\n
 * @mutate supabase/migrations/20261102023411_declutter_map_pins_hide_blocked.sql | 300.0 * sqrt(d.u_radius) | 800.0 * sqrt(d.u_radius)
 * @mutate supabase/migrations/20261102023411_declutter_map_pins_hide_blocked.sql | sha256(convert_to(v_salt \|\| '\|' \|\| v.seller_id::text | sha256(convert_to(v.seller_id::text
 * @mutate supabase/migrations/20261102023411_declutter_map_pins_hide_blocked.sql |   PERFORM public.require_feature('declutter');\n |
 * @mutate src/components/declutter/DeclutterMap.tsx |       const p = pins?.get(r.item.id);\n      return p ? [{ ...r, latitude: p.lat, longitude: p.lng }] : []; |       return [{ ...r, latitude: Number(r.item.area_lat), longitude: Number(r.item.area_lng) }];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const RPC = "declutter_map_pins";

const defs = effectiveDefs(MIG);
const def = defs.get(RPC);
const body = def ? blankSqlComments(def.stmt) : "";

/** The RPC's final projection: from the body's LAST `SELECT` (the outer one, after every CTE) to its `;`. */
function finalSelect(sql: string): string {
  const all = [...sql.matchAll(/\bSELECT\b/gi)];
  if (!all.length) return "";
  const from = all[all.length - 1].index ?? 0;
  return sql.slice(from, sql.indexOf(";", from) + 1);
}

/** Split a SELECT list on top-level commas. */
function selectList(select: string): string[] {
  const list = select.replace(/^SELECT\s+/i, "").replace(/\s+FROM\b[\s\S]*$/i, "");
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A coordinate expression that is a point unmoved: `area_lat`, `m.pickup_lat`, `(x.area_lng)::numeric`… */
const BARE_POINT = /^\(?\s*(?:\w+\.)?(?:pickup|area)_(?:lat|lng)\s*\)?\s*(?:::\s*\w+(?:\s+\w+)?)?$/i;

describe("Declutter map pins are a rough area, never the pickup point", () => {
  it("inventory: the migrations are read and the RPC's newest definition is found", () => {
    expect(migrationFiles(MIG).length).toBeGreaterThan(900);
    expect(def, `${RPC} is defined by some migration`).toBeDefined();
    expect(body.length).toBeGreaterThan(500);
  });

  it("1. a definer behind the 'declutter' switch, its first act; anon cannot execute it", () => {
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SET\s+search_path/i);
    const begin = body.search(/\bBEGIN\b/i);
    expect(begin).toBeGreaterThan(0);
    expect(body.slice(begin).replace(/^BEGIN\s*/i, "")).toMatch(/^PERFORM public\.require_feature\('declutter'\);/);
    const grants = migrationFiles(MIG)
      .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")))
      .join("\n");
    expect(grants).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${RPC}\\(\\) FROM PUBLIC, anon;`));
    expect(grants).not.toMatch(new RegExp(`GRANT[^;]*ON FUNCTION public\\.${RPC}\\([^;]*TO[^;]*\\banon\\b`, "i"));
  });

  it("2. it never reads the pickup point; the pin is the PUBLIC area point moved in BOTH coordinates, at most 300 m", () => {
    expect(body).not.toMatch(/declutter_item_private|pickup_/i);
    expect(body).toMatch(/SELECT i\.id, i\.seller_id, i\.area_lat, i\.area_lng\s+FROM public\.declutter_items i\s/);
    const cols = selectList(finalSelect(body));
    expect(cols.length).toBe(3);
    const [, lat, lng] = cols;
    for (const [name, expr] of [["lat", lat], ["lng", lng]] as const) {
      expect({ name, bare: BARE_POINT.test(expr) }).toEqual({ name, bare: false });
      // Moved: the area coordinate PLUS a distance x cos/sin of the angle (the offset).
      expect({ name, moved: new RegExp(`area_${name}[\\s\\S]*\\+[\\s\\S]*r_m\\s*\\*\\s*${name === "lat" ? "cos" : "sin"}\\(`).test(expr) }).toEqual({ name, moved: true });
    }
    // The disc: at most 300 m (house to pin then never over ~0.63 mi, the owner's "about half a mile").
    const disc = /([\d.]+)\s*\*\s*sqrt\(\s*d\.u_radius\s*\)\s+AS\s+r_m/.exec(body);
    expect(disc).not.toBeNull();
    expect(Number(disc![1])).toBeGreaterThan(0);
    expect(Number(disc![1])).toBeLessThanOrEqual(300);
  });

  it("3. the offset is seeded by the secret salt, and no client role may read the salt", () => {
    expect(body).toMatch(/FROM public\.declutter_pin_secret/);
    expect(body).toMatch(/sha256\(convert_to\(v_salt \|\|/);
    // No salt: a refusal, never an unsalted offset.
    expect(body).toMatch(/IF v_salt IS NULL THEN\s*RAISE EXCEPTION/);
    const all = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n");
    expect(all).toMatch(/REVOKE ALL ON TABLE public\.declutter_pin_secret FROM PUBLIC, anon, authenticated;/);
    expect(all).not.toMatch(/GRANT[^;]*ON (?:TABLE )?public\.declutter_pin_secret[^;]*TO[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
    expect(all).not.toMatch(/CREATE POLICY[^;]*ON public\.declutter_pin_secret/i);
  });

  it("4. the Browse map plots only the RPC's pins, and no client code reads the private table", () => {
    const map = blankComments(readFileSync(join(ROOT, "src/components/declutter/DeclutterMap.tsx"), "utf8"));
    expect(map).not.toMatch(/area_lat|area_lng|pickup_/);
    expect(map).toMatch(/pins\?\.get\(r\.item\.id\)/);
    const api = blankComments(readFileSync(join(ROOT, "src/lib/declutter/api.ts"), "utf8"));
    expect(api).toMatch(/supabase\.rpc\("declutter_map_pins"\)/);
    const files = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(join("src", "test")));
    expect(files.length).toBeGreaterThan(500);
    const readers = files.filter((f) => /\.from\(\s*["']declutter_item_private["']/.test(blankComments(readFileSync(f, "utf8"))));
    expect(readers).toEqual([]);
  });
});
