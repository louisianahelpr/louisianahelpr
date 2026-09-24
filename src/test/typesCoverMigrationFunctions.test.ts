import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * EVERY PUBLIC FUNCTION THE MIGRATIONS LEAVE BEHIND IS IN types.ts, BEFORE IT SHIPS.
 *
 * Ops alert ledger item 00fd2bd0 "db-deploy failed on main" (x46, 2026-09-23
 * 05:52Z to 2026-09-24 04:20Z). Grouping the 50 failed db-deploy runs in that
 * window by failing step (GitHub jobs API, 2026-09-24 04:40Z): 20 of them failed
 * at "Verify types.ts matches the live schema just deployed"
 * (scripts/check-types-fresh.mjs), the newest being run 35955021149, where
 * migration 20260924…ops_alert_fingerprint shipped `public.ops_alert_fingerprint()`
 * and types.ts did not have it (fixed by 42b9ff6dc).
 *
 * check-types-fresh can only run AFTER the migration is on prod (it compares
 * against a live generation), so every one of those 20 was a red deploy on
 * main, a nightly-red issue and a ledger item. This guard catches the same
 * class before push, from the repo alone: replay the migrations in order
 * (CREATE [OR REPLACE] FUNCTION adds, DROP FUNCTION removes), keep the public
 * functions that do not return `trigger` / `event_trigger` (the generator leaves
 * those out; measured: all 114 such functions are absent from types.ts, all
 * non-trigger ones present), and require each to be a key of the `public`
 * `Functions` block. Fix when red: `npm run db:types` after the migration is
 * live, or hand-add the entry in the same commit as the migration.
 *
 * @mutate src/integrations/supabase/types.ts | ops_alert_fingerprint: { | ops_alert_fingerprint_gone: {
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/** Index of the `)` that closes the `(` at `open`. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

const HEAD = /\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;

/** public function name -> migration that last created it, for functions a client can call. */
function migrationFunctions(): Map<string, string> {
  const fns = new Map<string, string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, file), "utf8"));
    for (const m of sql.matchAll(HEAD)) {
      if ((m[2] ?? "public").toLowerCase() !== "public") continue;
      const name = m[3].toLowerCase();
      if (/^drop/i.test(m[1])) {
        fns.delete(name);
        continue;
      }
      const open = m.index! + m[0].length - 1;
      const close = closeParen(sql, open);
      const ret = /^\s*returns\s+(?:setof\s+)?"?([\w.]+)/i.exec(sql.slice(close + 1, close + 200));
      const returnsTrigger = !!ret && /^(pg_catalog\.)?(event_)?trigger$/i.test(ret[1]);
      if (returnsTrigger) fns.delete(name);
      else fns.set(name, file);
    }
  }
  return fns;
}

/** Keys of the `public` schema's generated `Functions` block. */
function typedFunctions(): Set<string> {
  const text = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const pub = text.indexOf("\n  public: {");
  const start = text.indexOf("\n    Functions: {", pub);
  const end = text.indexOf("\n    Enums: {", start);
  expect(pub).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(pub);
  expect(end).toBeGreaterThan(start);
  // `name: {` for one signature, `name:` + a `| {…}` union for overloads.
  return new Set([...text.slice(start, end).matchAll(/^ {6}(\w+):(?: \{|$)/gm)].map((m) => m[1]));
}

describe("types.ts declares every public function the migrations create", () => {
  const fns = migrationFunctions();
  const typed = typedFunctions();

  it("reads a real inventory (floors)", () => {
    expect(fns.size).toBeGreaterThan(200);
    expect(typed.size).toBeGreaterThan(200);
    expect(fns.has("ops_alert_fingerprint")).toBe(true);
  });

  it("no migration function is missing from types.ts", () => {
    const missing = [...fns]
      .filter(([name]) => !typed.has(name))
      .map(([name, file]) => `${name} (last created in ${file})`);
    expect(missing, `run npm run db:types (or add them to types.ts) in the same commit:\n${missing.join("\n")}`).toEqual([]);
  });
});
