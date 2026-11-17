/**
 * Guard: a SEED job's stalled-completion escalation alerts nobody (owner rule: test data never reaches the owner).
 *
 * Measured on prod 2026-11-17 (read-only SQL): error_logs at 13:46 UTC held "Job stalled — nobody marked it done —
 * "SEED TEST Pressure wash a patio"" (the admin_alert mirror) and "Job stalled with escrow held — Job 60191cb1-..."
 * (the ops alert), both tagged source ops-alert-seed. Job 60191cb1 is is_seed = true; so were the 2026-11-16 pair
 * (job 50ccc9f8, "Prod audit accepted fixture"). The digest routing (`seed:` on postSlackOpsAlert) still wrote rows.
 *
 * The seed predicate is the one 20261117041858 (the dispute-sweep fix) uses for a job: jobs.is_seed. The sweep still
 * nudges and queues seed jobs (owner pop-up 2026-09-19, "Sweep everything, fixtures included."); only the two
 * owner-facing sends at the escalate stage are skipped. The SQL twin (report_continue_day_missed, 20261108214605)
 * already skips seed jobs and test members (v_test).
 *
 * @mutate supabase/functions/stalled-completion-reminder/index.ts |           const ownerFacing = job.is_seed !== true; |           const ownerFacing = true;
 * @mutate supabase/functions/stalled-completion-reminder/index.ts |           for (const a of ownerFacing ? admins ?? [] : []) { |           for (const a of admins ?? []) {
 * @mutate supabase/functions/stalled-completion-reminder/index.ts |           if (ownerFacing) await postSlackOpsAlert({ |           await postSlackOpsAlert({
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FN = resolve(ROOT, "supabase/functions/stalled-completion-reminder/index.ts");
const src = blankComments(readFileSync(FN, "utf8")).replace(/\s+/g, " ");

describe("stalled-completion escalation never alerts the owner about a seed job", () => {
  it("reads the real sweep (inventory floor)", () => {
    expect(src.length).toBeGreaterThan(5000);
    // The scan must still select is_seed, or the gate below reads undefined and alerts on every seed job.
    expect(src).toMatch(/\.select\(\s*"[^"]*\bis_seed\b[^"]*"/);
  });

  it("the gate is the job's own is_seed flag", () => {
    const gate = src.match(/const (\w+) = job\.is_seed !== true;/);
    expect(gate, "a `const <name> = job.is_seed !== true;` gate in the escalate branch").toBeTruthy();
    const name = gate![1];
    // Every admin_alert send loop and every ops alert in the file is behind it.
    const loops = [...src.matchAll(/for \(const a of ([^)]*)\)/g)].map((m) => m[1]);
    expect(loops.length).toBeGreaterThan(0);
    for (const l of loops) expect(l, "the admin_alert loop iterates no admins for a seed job").toMatch(new RegExp(`^${name} \\?`));
    const alerts = [...src.matchAll(/(.{0,40})postSlackOpsAlert\(\{/g)].map((m) => m[1]);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a, "the ops alert is skipped for a seed job").toMatch(new RegExp(`if \\(${name}\\) await $`));
  });

  it("the SQL twin (continue day missed) still skips seed jobs before its admin_alert", () => {
    const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
    const def = defs.get("report_continue_day_missed");
    expect(def, "report_continue_day_missed is defined").toBeTruthy();
    const body = blankSqlComments(def!.stmt).replace(/\s+/g, " ");
    expect(body).toMatch(/v_test := COALESCE\(v_job\.is_seed, false\)/);
    expect(body).toMatch(/IF NOT v_test THEN INSERT INTO public\.notifications .*'Job stalled — nobody marked it done/);
  });
});
