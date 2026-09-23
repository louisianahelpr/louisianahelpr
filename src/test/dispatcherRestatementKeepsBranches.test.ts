/**
 * Q315: a function that dispatches on `p_source = '...'` (ops_alert_condition
 * today) is restated whole by every migration that adds a branch. A restatement
 * built from a stale body silently drops a branch, and the per-feature guards
 * only spot-check a few sources.
 *
 * For every such function defined more than once in supabase/migrations, each
 * definition's set of p_source literals must contain the previous one's.
 * Removing a branch on purpose means listing it in KNOWN_DROPPED (exact).
 *
 * @mutate supabase/migrations/20260923215732_cron_http_untagged_close_rule.sql |   ELSIF p_source = 'user-report' THEN |   ELSIF p_source = 'user-report-x' THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

// "<function>:<source>" pairs deliberately removed by a later restatement.
// @two-way src/test/dispatcherRestatementKeepsBranches.test.ts:expect(dropped).toEqual
const KNOWN_DROPPED: string[] = [];

type Def = { file: string; name: string; sources: Set<string> };

function dispatcherDefs(): Def[] {
  const out: Def[] = [];
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
  for (const file of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      const body = rest.slice(open, rest.indexOf(tag[1], open));
      const sources = new Set([...body.matchAll(/p_source\s*=\s*'([^']+)'/g)].map((x) => x[1]));
      if (sources.size) out.push({ file, name: m[1].toLowerCase(), sources });
    }
  }
  return out;
}

describe("dispatcher restatements never drop a p_source branch (Q315)", () => {
  const defs = dispatcherDefs();

  it("finds the restated dispatcher", () => {
    expect(defs.filter((d) => d.name === "ops_alert_condition").length).toBeGreaterThan(10);
  });

  it("each definition's sources contain the previous definition's, bar KNOWN_DROPPED", () => {
    const dropped: string[] = [];
    const last = new Map<string, Def>();
    for (const d of defs) {
      const prev = last.get(d.name);
      if (prev) for (const s of prev.sources) if (!d.sources.has(s)) dropped.push(`${d.name}:${s}`);
      last.set(d.name, d);
    }
    expect(dropped).toEqual(KNOWN_DROPPED);
  });
});
