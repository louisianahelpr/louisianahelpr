/**
 * Read-only SQL only calls functions the read-only role may execute.
 *
 * "Auto-tick items verified live" (open-auto-tick.yml) went red on main,
 * 2026-10-12: Management API 42501. scripts/lib/openFeeds.mjs LEDGER_SQL
 * (2eec60461) calls public.admin_alert_close_rule(title), and
 * open-sync-trackers sends it with { readOnly: true }, which runs as
 * supabase_read_only_user. That role had SELECT on ops_alert_ledger but no
 * EXECUTE on the rule (prod proacl {postgres=X,service_role=X}, read live
 * 2026-10-12). liveChecksCallNoRevokedFunction.test.ts guarded only the
 * check-live-*.mjs scripts, and only by banning calls outright, so a feed
 * query in scripts/lib slipped past it.
 *
 * CLASS: every SQL text a script sends with `{ readOnly: true }` (a template
 * literal at the call, or a const it names, in the same file or scripts/lib)
 * may call a public.* function only when the migrations leave EXECUTE on it,
 * and on every public function it calls in turn (an invoker SQL function
 * checks EXECUTE on its callees too), granted to supabase_read_only_user.
 * Fix: 20261012233929 grants it on the two pure, table-free functions.
 *
 * Shown red on the old migrations (the grant removed) and on a planted call:
 * @mutate supabase/migrations/20261012233929_read_only_role_reads_the_alert_close_rule.sql |     GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO supabase_read_only_user; |     NULL;
 * @mutate supabase/migrations/20261012233929_read_only_role_reads_the_alert_close_rule.sql |     GRANT EXECUTE ON FUNCTION public.ops_alert_normalise(text) TO supabase_read_only_user; |     NULL;
 * @mutate scripts/lib/opsAlertLedger.mjs | export const OPEN_ITEMS_SQL = ` | export const OPEN_ITEMS_SQL = `SELECT public.ops_alert_verify(NULL) AS x;
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// trackedFiles indexes src/ only; scripts/ is read from disk (recursive).
const scripts = (readdirSync(join(ROOT, "scripts"), { recursive: true }) as string[])
  .map((f) => `scripts/${f.split("\\").join("/")}`)
  .filter((f) => f.endsWith(".mjs") && !f.includes("node_modules"))
  .sort();
const libConsts = new Map<string, string>();
for (const f of scripts.filter((s) => s.startsWith("scripts/lib/"))) {
  for (const m of read(f).matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*`([\s\S]*?)`/g)) libConsts.set(m[1], m[2]);
}

/** Every SQL text sent read-only that can be read statically: [where, sql]. */
function readOnlySql(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of scripts) {
    const src = blankComments(read(f));
    const local = new Map([...src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*`([\s\S]*?)`/g)].map((m) => [m[1], m[2]] as const));
    // sql(<arg>, { readOnly: true ... }) and its aliases (query, sqlFn, ...): first argument is
    // a template literal, a string literal, or a CONSTANT_NAME.
    for (const m of src.matchAll(/\b\w+\(\s*(`[\s\S]*?`|"[^"\n]*"|[A-Z][A-Z0-9_]*)\s*,\s*\{\s*readOnly:\s*true\b/g)) {
      const arg = m[1];
      const text = /^[`"]/.test(arg) ? arg.slice(1, -1) : local.get(arg) ?? libConsts.get(arg);
      if (text !== undefined) out.push([`${f}: ${arg.slice(0, 40)}`, text]);
    }
  }
  return out;
}

const calledPublicFns = (sql: string) =>
  new Set(
    [...blankSqlComments(sql).replace(/to_regprocedure\('[^']*'\)/g, "").replace(/'[^']*'::regprocedure/g, "").matchAll(/\bpublic\.([a-z_0-9]+)\s*\(/g)].map(
      (m) => m[1],
    ),
  );

/** fn -> granted to supabase_read_only_user by the NEWEST grant/revoke/drop statement naming it. */
function readOnlyGrants(): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const file of migrationFiles(MIGRATIONS)) {
    const code = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const events: Array<[number, string, boolean]> = [];
    for (const m of code.matchAll(/\bGRANT\s+(?:EXECUTE|ALL)[^;]*?\bON\s+FUNCTION\s+([^;]*?)\bTO\s+([^;]*);/gi))
      if (/\bsupabase_read_only_user\b/i.test(m[2])) for (const fn of m[1].matchAll(/public\.(\w+)/g)) events.push([m.index!, fn[1], true]);
    for (const m of code.matchAll(/\bREVOKE\s+[^;]*?\bON\s+FUNCTION\s+([^;]*?)\bFROM\s+([^;]*);/gi))
      if (/\bsupabase_read_only_user\b/i.test(m[2])) for (const fn of m[1].matchAll(/public\.(\w+)/g)) events.push([m.index!, fn[1], false]);
    for (const m of code.matchAll(/\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)) events.push([m.index!, m[1], false]);
    for (const [, fn, granted] of events.sort((a, b) => a[0] - b[0])) state.set(fn, granted);
  }
  return state;
}

describe("read-only SQL calls only functions granted to supabase_read_only_user", () => {
  const sites = readOnlySql();
  const defs = effectiveDefs(MIGRATIONS);
  const grants = readOnlyGrants();

  it("finds the read-only SQL sites, the ledger feed among them", () => {
    expect(sites.length).toBeGreaterThan(4);
    expect(sites.some(([where]) => where.startsWith("scripts/open-sync-trackers.mjs: LEDGER_SQL"))).toBe(true);
  });

  it("every public function they call (and every one those call) is executable by the read-only role", () => {
    const missing: string[] = [];
    for (const [where, sql] of sites) {
      const seen = new Set<string>();
      const stack = [...calledPublicFns(sql)];
      while (stack.length) {
        const fn = stack.pop()!;
        if (seen.has(fn)) continue;
        seen.add(fn);
        if (grants.get(fn) !== true) missing.push(`${where} -> public.${fn}()`);
        const def = defs.get(fn);
        // An invoker SQL function checks EXECUTE on what it calls; a definer runs its callees as the owner.
        if (def && !/\bSECURITY\s+DEFINER\b/i.test(def.stmt)) {
          const body = def.stmt.replace(new RegExp(`function\\s+(?:public\\.)?"?${fn}"?\\s*\\(`, "i"), "");
          for (const callee of calledPublicFns(body)) stack.push(callee);
        }
      }
    }
    expect(missing, "a read-only query would fail with 42501 permission denied for function").toEqual([]);
  });

  it("the ledger feed's close rule and its normaliser are both granted (the 2026-10-12 red)", () => {
    expect(grants.get("admin_alert_close_rule")).toBe(true);
    expect(grants.get("ops_alert_normalise")).toBe(true);
  });
});
