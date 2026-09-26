/**
 * CLASS GUARD (CJ-007 review, 2026-09-26): a SQL cron's error handler files the
 * failure somewhere a person or a monitor reads, or is listed here with why not.
 *
 * THE BUG: detect_stuck_payments caught each stuck job's failure with
 * `EXCEPTION WHEN OTHERS THEN RAISE NOTICE ...` and moved on. Nothing reads a
 * NOTICE, so a stuck payment that could not be alerted left no trace; and
 * because a job already alerted stays in its 24h scan, the found-vs-done rule
 * (20260926040817) cannot see a partial failure either. Fixed by filing each
 * failed row through log_cron_defect in 20260926040817.
 *
 * THE CLASS, from the migrations: every function a recorded SQL cron runs (the
 * job's NEWEST command, cron_record_work('<job>', to_jsonb(public.<fn>()))),
 * at its effective definition. Each `EXCEPTION WHEN ... THEN` handler must
 * call log_cron_defect(, insert into error_logs, re-raise, or return a result
 * object; anything else is a swallow. Swallows per function must equal
 * KNOWN_SWALLOWS exactly (two-way: fixing one lowers its count here).
 *
 * @mutate supabase/migrations/20260926040817_money_sweeps_found_vs_done.sql | PERFORM public.log_cron_defect(\n        CASE WHEN rec.seed | PERFORM public.log_cron_defect_x(\n        CASE WHEN rec.seed
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { jobCommands } from "./helpers/cronWorkRegister";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");

/** function -> [swallowing handlers, why each is deliberate]. */
// @two-way src/test/sqlCronFailuresAreFiled.test.ts:every swallowing handler is known, and every known count is exact
const KNOWN_SWALLOWS: Record<string, [number, string]> = {
  sweep_old_notifications: [1, "Catches only the informational 'deleted N rows' log insert after the delete committed; RAISE WARNING."],
  sweep_cron_http_failures: [1, "Catches a failed Slack post; the error_logs rows it summarises are already written."],
  sweep_silent_cron_failures: [2, "(1) a truncated/non-JSON HTTP body stays '{}', the run row still recorded; (2) a failed Slack post, error_logs rows already written."],
  reap_stranded_instant_payouts: [1, "Catches a failed Slack post so the notifier never undoes the reap; each reap is already an error_logs row."],
  sweep_dead_crons: [1, "Catches a failed Slack post; the verdict rows are already in error_logs."],
  sweep_cron_blackouts: [1, "Catches a failed Slack post; the blackout is already in error_logs."],
  send_ops_daily_digest: [1, "A failed Slack post leaves v_request NULL and posted false, which check_ops_digest_delivery reads (ops-digest-undelivered)."],
  run_missed_cron_catch_up: [2, "(1) lock_not_available: the slot stays unclaimed for the next tick; (2) the catch-up's failure is recorded as action 'catch_up_failed' in cron_catchup_runs and alerted from there."],
};

const FILES_IT = /log_cron_defect\(|INSERT\s+INTO\s+public\.error_logs|\bRAISE\s*;|RAISE\s+EXCEPTION|RETURN\s+jsonb_build_object/i;

function swallows(): Map<string, number> {
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") }));
  const defs = effectiveDefs(MIG);
  const out = new Map<string, number>();
  for (const [, c] of jobCommands(files)) {
    const fn = /cron_record_work\(\s*'[^']+'\s*,\s*to_jsonb\(\s*(?:\(\s*SELECT\s+count\(\*\)\s+FROM\s+)?public\.(\w+)\(/i.exec(c.command)?.[1];
    if (!fn || out.has(fn)) continue;
    const body = blankSqlComments(defs.get(fn)?.stmt ?? "");
    const handlers = [...body.matchAll(/EXCEPTION\s+WHEN\s+[\s\S]*?THEN([\s\S]*?)(?=\bEND;|\bEXCEPTION\b)/gi)];
    out.set(fn, handlers.filter((h) => !FILES_IT.test(h[1])).length);
  }
  return out;
}

describe("SQL cron error handlers file what they catch", () => {
  const found = swallows();

  it("reads the cron functions from the migrations (not empty)", () => {
    expect(found.size).toBeGreaterThan(30);
    expect(found.has("detect_stuck_payments")).toBe(true);
  });

  it("every swallowing handler is known, and every known count is exact", () => {
    const actual = Object.fromEntries([...found].filter(([, n]) => n > 0).sort());
    const expected = Object.fromEntries(Object.entries(KNOWN_SWALLOWS).map(([fn, [n]]) => [fn, n]).sort());
    expect(actual).toEqual(expected);
  });
});
