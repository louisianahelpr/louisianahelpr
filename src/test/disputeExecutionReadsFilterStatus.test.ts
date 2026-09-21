/**
 * Every `disputes` query that filters on `execution_status` must also filter on
 * `status`.
 *
 * `rpc_supersede_dispute_decision` (20260915034822) retires a ruled dispute as
 * status 'superseded' and KEEPS its execution record ('pending' / 'failed' /
 * 'executing') as history. A reader that asks "which splits are unsettled?" by
 * execution_status alone then counts every superseded row forever: the
 * auto-resolve-disputes stuck-split sweep did exactly that and raised a
 * permanent "Dispute split did not settle" alarm per supersede (round-5
 * lh-money-escrow review, MEDIUM-2).
 *
 * Inventory derived from source: every `.from("disputes")` chain in
 * supabase/functions and src (tests excluded), cut at the end of its
 * statement. A chain whose FILTER calls (eq / neq / in / is / or / not) mention
 * execution_status must also carry a status filter. Column lists passed to
 * `.select(...)` do not count as filters.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Shown able to fail: delete the `.eq("status", "decided")` from the live
// stuck-split sweep — the exact MEDIUM-2 regression — and the repo scan reds.
// @mutate supabase/functions/auto-resolve-disputes/index.ts | .eq("status", "decided") |

const FILTER_ON_EXECUTION = /\.(?:eq|neq|in|is|not|or)\(\s*["'`][^"'`]*execution_status/;
const FILTER_ON_STATUS = /\.(?:eq|neq|in|is|not)\(\s*["'`]status["'`]/;

export function disputeChains(raw: string): string[] {
  // Line comments out first, so a `;` or a column name inside one can neither
  // cut a chain short nor count as a filter. (`://` in a URL string is kept.)
  const source = raw.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const chains: string[] = [];
  const re = /\bfrom(?:\s+as\s+any\))?\)?\(\s*["']disputes["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // Cut at the statement end: the first `;` after the call.
    const end = source.indexOf(";", m.index);
    chains.push(source.slice(m.index, end === -1 ? undefined : end));
  }
  return chains;
}

export function offendingChains(source: string): string[] {
  return disputeChains(source).filter((c) => FILTER_ON_EXECUTION.test(c) && !FILTER_ON_STATUS.test(c));
}

describe("disputes reads that filter execution_status also filter status", () => {
  it("the checker flags the original stuck-split shape and passes the fixed one", () => {
    const before = `const { data } = await supabase
      .from("disputes")
      .select("id, job_id, execution_status, execution_started_at")
      .in("execution_status", ["executing", "failed"])
      .limit(500);`;
    const after = before.replace('.in("execution_status"', '.eq("status", "decided")\n      .in("execution_status"');
    expect(offendingChains(before)).toHaveLength(1);
    expect(offendingChains(after)).toHaveLength(0);
    // A column list is not a filter.
    expect(offendingChains(`await supabase.from("disputes").select("execution_status").eq("job_id", id);`)).toHaveLength(0);
  });

  it("no source file has an execution_status filter without a status filter", () => {
    const files = execFileSync("git", ["ls-files", "supabase/functions", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\/|fixtures/.test(f));
    const offenders: string[] = [];
    let chainsSeen = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("disputes")) continue;
      chainsSeen += disputeChains(src).length;
      for (const c of offendingChains(src)) offenders.push(`${f}: ${c.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    // The inventory is real, not empty.
    expect(chainsSeen).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
