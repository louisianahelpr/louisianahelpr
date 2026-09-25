/**
 * No money path decides anything from jobs.cancellation_reason (money review
 * 2026-09-25 HIGH-1).
 *
 * cancellation_reason is free text a client controls: poster_cancel_job copies
 * the caller's own p_reason into it verbatim. void-cancelled-payments once gave
 * a FULL refund, service fee included and the committed Helpr's late fee
 * dropped, to any job whose reason read 'series_ended_account_banned', so any
 * poster could type it. The ban path now sets a server-owned marker
 * (jobs.series_ban_cancelled_at) and the refund reads that.
 *
 * Class, both layers:
 *   - edge: no function under supabase/functions READS cancellation_reason
 *     (a select list, a property access, a comparison). Writing it as an
 *     object key (`cancellation_reason: "..."`) is the only allowed use.
 *   - SQL: no function the migrations leave in the database branches on it
 *     (IF / WHEN / WHERE / AND / OR / CASE ... cancellation_reason), except
 *     the trigger that REFUSES the reserved reason.
 *
 * @mutate supabase/functions/_shared/seriesRefund.ts |   if (inSeries && !!job.series_ban_cancelled_at) return true; |   if (inSeries && (job as { cancellation_reason?: string }).cancellation_reason === "series_ended_account_banned") return true;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | helper_fee_percent, is_group_job, helpers_needed, parent_job_id, recurrence_days") | helper_fee_percent, is_group_job, helpers_needed, parent_job_id, recurrence_days, cancellation_reason")
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |        AND c.helper_completed_at IS NULL |        AND c.helper_completed_at IS NULL AND c.cancellation_reason IS NULL
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/** SQL functions allowed to test the reason: they refuse it, they settle nothing. */
const SQL_REFUSERS = new Set(["enforce_series_ban_marker_server_owned"]);

describe("no settlement path branches on jobs.cancellation_reason (HIGH-1)", () => {
  it("edge functions only ever WRITE it", () => {
    const files = walkSource([join(process.cwd(), "supabase/functions")], [".ts"]);
    expect(files.length).toBeGreaterThan(50);
    const writers: string[] = [];
    const readers: string[] = [];
    for (const f of files) {
      const src = readSource(f);
      if (!src) continue;
      const code = blankComments(src);
      for (const m of code.matchAll(/cancellation_reason/g)) {
        const after = code.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
        const before = code.slice(Math.max(0, m.index! - 1), m.index!);
        // `cancellation_reason: <value>` in an object literal, not `.cancellation_reason` or a select list.
        if (/^\s*:/.test(after) && before !== ".") writers.push(f);
        else readers.push(`${f.replace(process.cwd() + "/", "")} @${m.index}`);
      }
    }
    expect(writers.length).toBeGreaterThanOrEqual(2);
    expect(readers).toEqual([]);
  });

  it("no SQL function the migrations leave branches on it (except the refuser)", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
    expect(defs.size).toBeGreaterThan(300);
    const RE = /(?:\bIF|\bWHEN|\bWHERE|\bAND|\bOR|\bELSIF|\bNOT|\bCASE)\s*\(?\s*(?:\w+\.)?cancellation_reason\b/i;
    const branching = [...defs.entries()]
      .filter(([name, d]) => !SQL_REFUSERS.has(name) && RE.test(blankSqlComments(d.stmt)))
      .map(([name, d]) => `${name} (${d.file})`);
    expect(branching).toEqual([]);
    // The refuser is real and still refuses.
    for (const name of SQL_REFUSERS) {
      expect(blankSqlComments(defs.get(name)?.stmt ?? "")).toMatch(/RAISE EXCEPTION 'reserved_cancellation_reason'/);
    }
  });
});
