/**
 * CLASS GUARD (CJ-008): a money path never picks its rows by updated_at.
 *
 * THE BUG (measured on prod, 2026-09-25): auto_tip_candidates() chose
 * completed jobs by `j.updated_at > now() - 24h` and read the poster's
 * auto_tip_mode as it is now. A >24h cron outage lost every tip in the gap,
 * and because updated_at moves on any later write (18 of 52 completed jobs
 * had updated_at more than a day after completed_at), a poster who turned
 * auto-tip on today could be charged on a job finished months earlier. Fixed
 * by 20260925053956_auto_tip_anchor_on_opt_in.sql (completed_at anchored on
 * profiles.auto_tip_enabled_at, 14-day lookback); PGlite proof in
 * src/test/pglite/autoTipAnchoredOnOptIn.pglite.mjs.
 *
 * THE CLASS, from the source: every SQL function that a money edge function
 * (supabase/functions/<dir> whose name says charge / tip / payout / release /
 * refund / payment / escrow / dispute / capture / void / transfer) calls with
 * .rpc(...) is read at its NEWEST migration definition (any dollar tag). None
 * may compare updated_at against now(): "when this row was last touched" is
 * not an event a charge, payout or release can be timed from.
 *
 * @mutate supabase/migrations/20260925053956_auto_tip_anchor_on_opt_in.sql | AND j.completed_at > now() - make_interval(hours => _since_hours) | AND j.updated_at > now() - make_interval(hours => _since_hours)
 * @mutate supabase/migrations/20260925053956_auto_tip_anchor_on_opt_in.sql | AND j.completed_at >= p.auto_tip_enabled_at | AND true
 * @mutate supabase/functions/auto-tip-charge/index.ts | await supabase.rpc("auto_tip_candidates"); | await supabase.rpc("auto_tip_candidates", { _since_hours: 24 });
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const MIG = join(ROOT, "supabase", "migrations");

const MONEY_DIR = /charge|tip|payout|release|refund|payment|escrow|dispute|capture|void|transfer/i;

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return n.endsWith(".ts") ? [p] : [];
  });

const moneyDirs = readdirSync(FN_DIR).filter((d) => MONEY_DIR.test(d) && statSync(join(FN_DIR, d)).isDirectory());
const rpcs = new Set<string>();
for (const d of moneyDirs) {
  for (const f of tsFiles(join(FN_DIR, d))) {
    for (const m of blankComments(readFileSync(f, "utf8")).matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) rpcs.add(m[1]);
  }
}

/** Newest body of each function, any dollar tag. */
const bodies = new Map<string, string>();
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
  for (const m of sql.matchAll(FN_RE)) bodies.set(m[1].toLowerCase(), m[3]);
}

const UPDATED_AT_WINDOW = /\bupdated_at\s*[<>]=?\s*(?:now\s*\(\s*\)|current_timestamp|clock_timestamp\s*\(\s*\))|(?:now\s*\(\s*\)|current_timestamp)[^;]{0,40}?[<>]=?\s*(?:\w+\.)?updated_at\b/i;

describe("money paths never time their rows by updated_at (CJ-008)", () => {
  it("reads the inventory (floor)", () => {
    expect(moneyDirs).toContain("auto-tip-charge");
    expect(rpcs.has("auto_tip_candidates")).toBe(true);
    expect(rpcs.size).toBeGreaterThan(8);
    expect([...rpcs].filter((n) => bodies.has(n)).length).toBeGreaterThan(8);
  });

  it("no money-called function compares updated_at against now()", () => {
    const bad = [...rpcs].filter((n) => UPDATED_AT_WINDOW.test(bodies.get(n) ?? "")).sort();
    expect(bad).toEqual([]);
  });

  it("auto_tip_candidates is anchored on completion and on the poster's opt-in", () => {
    const body = bodies.get("auto_tip_candidates") ?? "";
    expect(body).toMatch(/j\.completed_at\s*>=\s*p\.auto_tip_enabled_at/);
    expect(body).toMatch(/j\.completed_at\s*>\s*now\(\)\s*-\s*make_interval\(\s*hours\s*=>\s*_since_hours\s*\)/);
    expect(body).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.tips\s+t\s+WHERE\s+t\.job_id\s*=\s*j\.id\s+AND\s+t\.source\s*=\s*'auto'/i);
  });

  it("auto-tip-charge takes the function's own window", () => {
    const src = blankComments(readFileSync(join(FN_DIR, "auto-tip-charge", "index.ts"), "utf8"));
    expect(src).toMatch(/\.rpc\(\s*"auto_tip_candidates"\s*\)/);
  });
});
