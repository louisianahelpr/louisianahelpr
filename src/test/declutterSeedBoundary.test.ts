// @mutate supabase/migrations/20261020033623_declutter_items_seed_boundary.sql |         AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))) |         AND true)
// @mutate supabase/migrations/20261020033623_declutter_items_seed_boundary.sql |      OR (v_seed AND public.seed_hidden_in_discovery()) THEN |      THEN
//
// Cowork design audit 2026-10-20, D1: the owner (an admin, not a test account)
// saw test sellers' fixtures ("Fixture rocking chair [E2E-PRODAUDIT]",
// "Payout proof lamp") on Declutter Browse. Measured on prod 03:40Z: all 5
// live items were is_seed; the items read policy never asked the launch switch
// that hides test rows from discovery (jobs ask it in open_jobs_browse).
//
// The CLASS: a marketplace listing table (it carries is_seed) whose SELECT
// policy opens rows to people who are not a party (a 'live' status branch, or
// a *_publicly_visible() gate) must hide seed rows by the launch switch,
// in the policy itself or in a function it calls (two hops). Inventory: every
// newest CREATE POLICY in the migrations on a table that has is_seed.
// Behaviour proof under the real roles: src/test/pglite/declutterSeedBoundary.pglite.mjs
// (4 RED checks fail without the migration; all pass applied 3x).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = migrationFiles(DIR);
const DEFS = effectiveDefs(DIR);
const SQL = FILES.map((f) => [f, blankSqlComments(readFileSync(resolve(DIR, f), "utf8"))] as const);

/** Tables that carry an is_seed column (CREATE TABLE body or ALTER TABLE ADD COLUMN). */
function seedTables(): Set<string> {
  const out = new Set<string>();
  for (const [, sql] of SQL) {
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?is_seed\b/gi)) out.add(m[1]);
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/\bis_seed\s+boolean/i.test(m[2])) out.add(m[1]);
    }
  }
  return out;
}

/** Newest CREATE POLICY per (table, name), minus any later DROP POLICY. */
function newestPolicies(): Map<string, { table: string; name: string; stmt: string; file: string }> {
  const out = new Map<string, { table: string; name: string; stmt: string; file: string }>();
  for (const [file, sql] of SQL) {
    const events: { at: number; kind: "drop" | "create"; table: string; name: string; stmt: string }[] = [];
    for (const m of sql.matchAll(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi)) {
      events.push({ at: m.index!, kind: "drop", name: m[1], table: m[2], stmt: "" });
    }
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)[\s\S]*?;/gi)) {
      events.push({ at: m.index!, kind: "create", name: m[1], table: m[2], stmt: m[0] });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) {
      const key = `${e.table}::${e.name}`;
      if (e.kind === "drop") out.delete(key);
      else out.set(key, { table: e.table, name: e.name, stmt: e.stmt, file });
    }
  }
  return out;
}

const SEED_SWITCH = /seed_hidden_in_discovery|seed_jobs_hidden_publicly|seed_hidden_for|seed_hidden_from_caller/;

/** Does `text`, or a public function it calls (up to `hops` deep), ask the seed switch? */
function asksSeedSwitch(text: string, hops = 2, seen = new Set<string>()): boolean {
  if (SEED_SWITCH.test(text)) return true;
  if (hops === 0) return false;
  for (const m of text.matchAll(/public\.(\w+)\s*\(/g)) {
    const fn = m[1];
    if (seen.has(fn)) continue;
    seen.add(fn);
    const d = DEFS.get(fn);
    if (d && asksSeedSwitch(blankSqlComments(d.stmt), hops - 1, seen)) return true;
  }
  return false;
}

/** A discovery policy: it opens rows by a listing status or a public-visibility gate, not only to a party. */
const isDiscovery = (stmt: string) => /'live'/.test(stmt) || /_publicly_visible\s*\(/.test(stmt);
const isSelect = (stmt: string) => /\bFOR\s+(?:SELECT|ALL)\b/i.test(stmt);

describe("D1: marketplace listing reads hide test sellers' rows by the launch switch", () => {
  const tables = seedTables();
  const policies = [...newestPolicies().values()].filter((p) => tables.has(p.table) && isSelect(p.stmt));
  const discovery = policies.filter((p) => isDiscovery(p.stmt));

  it("inventory: the listing tables and their discovery policies are found", () => {
    expect(tables.size).toBeGreaterThan(10);
    expect(tables.has("declutter_items")).toBe(true);
    expect(discovery.length).toBeGreaterThan(2);
    expect(discovery.map((p) => p.table)).toEqual(expect.arrayContaining(["declutter_items", "shop_items", "shops"]));
  });

  it("every discovery policy on a seed-carrying table asks the seed switch", () => {
    const missing = discovery.filter((p) => !asksSeedSwitch(blankSqlComments(p.stmt))).map((p) => `${p.table}: "${p.name}" (${p.file})`);
    expect(missing, `these policies show test sellers' rows to real members:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the Declutter items policy keeps the seller's own rows and uses the discovery predicate (admins not spared)", () => {
    const p = discovery.find((x) => x.table === "declutter_items");
    expect(p).toBeDefined();
    const body = blankSqlComments(p!.stmt);
    expect(body).toMatch(/seller_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
    expect(body).toMatch(/NOT\s+is_seed\s+OR\s+NOT\s+\(SELECT\s+public\.seed_hidden_in_discovery\(\)\)/);
  });

  it("the buy / offer lock (SECURITY DEFINER, so RLS never applies) refuses a hidden test item as not found", () => {
    // lh-money-escrow review 2026-10-20: without this a real member holding a
    // test item's id could reserve it and pay real money for a fixture.
    const d = DEFS.get("declutter_lock_buyable_item");
    expect(d, "declutter_lock_buyable_item is not defined").toBeDefined();
    const body = blankSqlComments(d!.stmt);
    expect(body).toMatch(/i\.is_seed/);
    expect(body).toMatch(/OR\s+\(v_seed\s+AND\s+public\.seed_hidden_in_discovery\(\)\)\s+THEN\s+RAISE EXCEPTION 'item_not_found'/);
  });
});
