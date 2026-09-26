/**
 * CLASS GUARD: every SQL cancel path prices a cancellation on COMMITMENT.
 *
 * THE BUG (lh-money-escrow review of Q50, 2026-09-23). Migration
 * 20260908155425 moved poster_cancel_job's fee ladder from "a Helpr is
 * assigned" (`helper_id IS NOT NULL`) to "a Helpr is committed" (`helper_id IS
 * NOT NULL AND helper_confirmed_at IS NOT NULL`), matching
 * `_shared/cancellationFee.ts` helperIsCommitted — the module
 * void-cancelled-payments settles with. block_user_and_settle was left on the
 * old predicate (live pg_get_functiondef, prod 2026-09-23), so blocking a
 * chosen-but-never-accepted Helpr inside 24h stored a 25%/50% cancellation fee,
 * late_cancellation = true and a strike that the money path then refunded away.
 *
 * THE CLASS, derived from the tree: the LATEST definition of every public
 * function in supabase/migrations that calls `cancellation_fee_percent(` or
 * `is_late_cancellation(` (comments stripped; the two ladder functions
 * themselves excluded). The first argument of each call must not be the bare
 * assignment test, and the function must read `helper_confirmed_at`.
 *
 * RED ON THE ORIGINAL: against origin/main 96ae77309 (latest
 * block_user_and_settle = 20260914215112) the per-function test fails naming
 * block_user_and_settle.
 *
 * @mutate supabase/migrations/20260924220318_rename_tab_addresses.sql | now());\n    v_percent := public.cancellation_fee_percent(v_committed, v_hours); | now());\n    v_percent := public.cancellation_fee_percent(v_job.helper_id IS NOT NULL, v_hours);
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
// Any dollar-quote tag; the LAST definition in timestamp order wins.
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const latest = new Map<string, { body: string; file: string }>();
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
  for (const m of sql.matchAll(FN_RE)) latest.set(m[1].toLowerCase(), { body: m[3], file: f });
}

const LADDER = new Set(["cancellation_fee_percent", "is_late_cancellation"]);
const CALL_RE = /\b(?:public\.)?(cancellation_fee_percent|is_late_cancellation)\s*\(\s*([^,]+),/gi;

const callers = [...latest.entries()]
  .filter(([name]) => !LADDER.has(name))
  .map(([name, v]) => ({ name, ...v, calls: [...v.body.matchAll(CALL_RE)].map((m) => ({ fn: m[1], arg: m[2].trim() })) }))
  .filter((c) => c.calls.length > 0);

describe("SQL cancel paths price the fee on commitment, not assignment", () => {
  it("found the cancel paths (inventory floor, 2026-09-23: poster_cancel_job, block_user_and_settle)", () => {
    const names = callers.map((c) => c.name);
    expect(names).toContain("poster_cancel_job");
    expect(names).toContain("block_user_and_settle");
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });

  it.each(callers.map((c) => [c.name, c] as const))("%s gates the ladder on helper_confirmed_at", (_name, c) => {
    for (const call of c.calls) {
      expect(
        /^\S*helper_id\s+IS\s+NOT\s+NULL$/i.test(call.arg),
        `${c.name} (${c.file}) calls ${call.fn}(${call.arg}, …) — assignment is not commitment`,
      ).toBe(false);
    }
    expect(/\bhelper_confirmed_at\b/.test(c.body), `${c.name} (${c.file}) never reads helper_confirmed_at`).toBe(true);
  });
});
