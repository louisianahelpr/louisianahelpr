/**
 * CLASS GUARD (CJ-007, docs/OPEN.md Q434 (b)): every cron-silent rule the sweep
 * files either closes itself or is listed here with why it cannot.
 *
 * THE BUG: 20260925231818 made sweep_silent_cron_failures file two new
 * cron-silent rules ('idle', 'unrecorded'). ops_alert_condition had no
 * 'cron-silent' branch, so their ledger items got verify_kind 'manual' and
 * stayed open after the job was fixed. Fixed by
 * 20260926035556_cron_silent_close_rule.sql.
 *
 * THE CLASS, from the migrations (newest definitions, helpers/effectiveFunctionDefs):
 *   filed  = every 'rule', '<x>' tag in the NEWEST sweep_silent_cron_failures
 *   closed = every p_rule = '<x>' branch in the NEWEST cron_silent_still_failing
 *   filed must equal closed + NO_LIVE_STATE, two-way; the NEWEST
 *   ops_alert_condition must route 'cron-silent' to cron_silent_still_failing
 *   for exactly the closed rules; and the 'unrecorded' close rule must re-ask
 *   the same cron.job predicate the sweep files on.
 *
 * @mutate supabase/migrations/20260926035556_cron_silent_close_rule.sql |   IF p_rule = 'unrecorded' THEN |   IF p_rule = 'unrecorded-x' THEN
 * @mutate supabase/migrations/20260926035556_cron_silent_close_rule.sql |         AND public.cron_silent_rule(p_sample_ref) IN ('idle', 'unrecorded') THEN |         AND public.cron_silent_rule(p_sample_ref) IN ('idle') THEN
 * @mutate supabase/migrations/20260926035556_cron_silent_close_rule.sql |          AND j.command NOT LIKE '%cron_record_work(%'); |          AND true);
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const defs = effectiveDefs(MIG);
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "");

/** Rules with no live state to re-ask, each with why. */
// @two-way src/test/cronSilentAlertsClose.test.ts:filed rules equal closed rules plus NO_LIVE_STATE
const NO_LIVE_STATE: Record<string, string> = {
  candidates:
    "'found work, did none' is a fact about past runs' bodies, not a state the database holds now; its items keep verify_kind 'manual'.",
};

const filed = () =>
  [...new Set([...body("sweep_silent_cron_failures").matchAll(/'rule'\s*,\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();
const closed = () =>
  [...new Set([...body("cron_silent_still_failing").matchAll(/p_rule\s*=\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();

describe("cron-silent alerts close themselves (CJ-007)", () => {
  it("reads both inventories from the newest definitions (not empty)", () => {
    expect(filed().length).toBeGreaterThan(2);
    expect(filed()).toContain("idle");
    expect(closed().length).toBeGreaterThan(1);
  });

  it("every rule the sweep files has a close rule or a NO_LIVE_STATE reason, two-way", () => {
    const expected = [...closed(), ...Object.keys(NO_LIVE_STATE)].sort();
    expect(filed()).toEqual(expected);
    for (const r of Object.keys(NO_LIVE_STATE)) expect(closed()).not.toContain(r);
  });

  it("the newest ops_alert_condition routes exactly the closed rules to cron_silent_still_failing", () => {
    const oac = body("ops_alert_condition");
    const branch = /ELSIF\s+p_source\s*=\s*'cron-silent'[\s\S]*?cron_silent_rule\(p_sample_ref\)\s+IN\s*\(([^)]*)\)\s*THEN([\s\S]*?)(?=\n {2}(?:ELSIF\b|END IF;))/.exec(oac);
    expect(branch, "no 'cron-silent' branch in the newest ops_alert_condition").not.toBeNull();
    const routed = [...branch![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(routed).toEqual(closed());
    expect(branch![2]).toMatch(/IF\s+p_probe_only\s+THEN\s+RETURN\s+true;/);
    expect(branch![2]).toMatch(/RETURN\s+public\.cron_silent_still_failing\(/);
  });

  it("'unrecorded' re-asks the predicate the sweep files on", () => {
    const sweep = body("sweep_silent_cron_failures");
    const close = body("cron_silent_still_failing");
    for (const clause of [
      /\bj\.active\b/,
      /j\.command\s+NOT\s+LIKE\s+'%net\.http_post\(%'/,
      /j\.command\s+NOT\s+LIKE\s+'%cron_record_work\(%'/,
      /coalesce\(j\.jobname,\s*'jobid '\s*\|\|\s*j\.jobid\)/,
    ]) {
      expect(sweep, `sweep lost ${clause}`).toMatch(clause);
      expect(close, `close rule lost ${clause}`).toMatch(clause);
    }
  });
});
