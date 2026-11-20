/**
 * Real-member error, 2026-11-20 12:03Z (Sentry JAVASCRIPT-5T/5V, Postgres 42804 "COALESCE types text and uuid cannot
 * be matched", HTTP 400 on /declutter): declutter_item_demand and declutter_selling_home counted unique viewers with
 * COALESCE(v.viewer_id::text, v.device_id), but declutter_item_views.viewer_id AND device_id are both uuid
 * (20261105163501), so the item page's demand line and the whole Selling home failed. Fixed in 20261120121830.
 * The PGlite proofs had a `device_id text` stand-in table, which is why they stayed green.
 *
 * Class guard, two halves:
 *  1. Inventory from source: every function the migrations leave in the database (effectiveDefs, any dollar tag,
 *     comments blanked) that reads declutter_item_views. Inside each, a COALESCE naming both viewer_id and device_id
 *     must cast both to text or neither (one cast is the 42804).
 *  2. Every PGlite proof that hand-types a declutter_item_views stand-in must give viewer_id and device_id the types
 *     of the real CREATE in 20261105163501 (a `device_id text` stand-in is what hid this). The three proofs of the
 *     broken functions now load the real CREATE itself.
 * Can fail on the original bug: the definitions before 20261120121830 trip half 1 (asserted below).
 * Behaviour (real Postgres): FIX_MIGRATION=skip node src/test/pglite/declutterItemDemand.pglite.mjs -> 3 FAIL (42804);
 * without it 9 PASS. Same for declutterSellingHome.pglite.mjs (10 FAIL / 13 PASS) and declutterShopSale.pglite.mjs.
 *
 * @mutate supabase/migrations/20261120121830_declutter_views_coalesce_uuid.sql | (SELECT count(DISTINCT COALESCE(v.viewer_id, v.device_id))::integer | (SELECT count(DISTINCT COALESCE(v.viewer_id::text, v.device_id))::integer
 * @mutate src/test/pglite/declutterSellingHome.pglite.mjs | await db.exec(viewsTable); | await db.exec(`create table public.declutter_item_views(item_id uuid, viewer_id uuid, device_id text, created_at timestamptz)`);
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261120121830";
const PGLITE_DIR = "src/test/pglite";

/** Each COALESCE( … ) argument list in `sql`, balanced on parentheses. */
function coalesceArgs(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\bcoalesce\s*\(/gi)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
    }
    out.push(sql.slice(start, i - 1));
  }
  return out;
}

const castText = (args: string, col: string) => new RegExp(`\\b${col}\\s*::\\s*text\\b`, "i").test(args);

function mixedCasts(defs: ReturnType<typeof effectiveDefs>): { readers: string[]; bad: string[] } {
  const readers: string[] = [];
  const bad: string[] = [];
  for (const [name, def] of defs) {
    const body = blankSqlComments(def.stmt);
    if (!/\bdeclutter_item_views\b/i.test(body)) continue;
    readers.push(name);
    for (const args of coalesceArgs(body)) {
      if (!/\bviewer_id\b/i.test(args) || !/\bdevice_id\b/i.test(args)) continue;
      if (castText(args, "viewer_id") !== castText(args, "device_id")) bad.push(`${name} (${def.file}): COALESCE(${args.trim()})`);
    }
  }
  return { readers, bad };
}

describe("declutter_item_views viewer/device counts keep one type (42804, 2026-11-20)", () => {
  it("no live function COALESCEs a text viewer_id with a uuid device_id (or the reverse)", () => {
    const { readers, bad } = mixedCasts(effectiveDefs(DIR));
    expect(readers.length).toBeGreaterThan(3);
    expect(readers).toEqual(expect.arrayContaining(["declutter_item_demand", "declutter_selling_home"]));
    expect(bad).toEqual([]);
  });

  it("the definitions before the fix are caught (the guard can fail on the original bug)", () => {
    const { bad } = mixedCasts(effectiveDefs(DIR, { before: FIX }));
    expect(bad.map((b) => b.split(" ")[0]).sort()).toEqual(["declutter_item_demand", "declutter_selling_home", "declutter_selling_home"]);
  });

  it("PGlite stand-ins of declutter_item_views give viewer_id and device_id prod's types (the real CREATE's)", () => {
    const real = readFileSync(join(DIR, "20261105163501_declutter_item_views.sql"), "utf8");
    const realBody = real.match(/CREATE TABLE IF NOT EXISTS public\.declutter_item_views \(([\s\S]*?)\n\);/)![1];
    const typeOf = (body: string, col: string) => body.match(new RegExp(`\\b${col}\\s+(\\w+)`, "i"))?.[1].toLowerCase();
    expect([typeOf(realBody, "viewer_id"), typeOf(realBody, "device_id")]).toEqual(["uuid", "uuid"]);
    const standIns: string[] = [];
    const drift: string[] = [];
    for (const f of readdirSync(PGLITE_DIR).filter((n) => n.endsWith(".mjs"))) {
      const src = blankComments(readFileSync(join(PGLITE_DIR, f), "utf8"));
      for (const m of src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?declutter_item_views\s*\(([^;]*)\)\s*;/gi)) {
        standIns.push(f);
        for (const col of ["viewer_id", "device_id"]) {
          const t = typeOf(m[1], col);
          if (t !== typeOf(realBody, col)) drift.push(`${f}: ${col} ${t ?? "missing"} (prod: ${typeOf(realBody, col)})`);
        }
      }
    }
    expect(standIns.length).toBeGreaterThan(2);
    expect(drift).toEqual([]);
  });
});
