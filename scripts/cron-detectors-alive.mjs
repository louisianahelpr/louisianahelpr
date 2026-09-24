#!/usr/bin/env node
/**
 * CJ-011: the four database cron detectors (sweep-cron-http-failures,
 * sweep-silent-cron-failures, sweep-dead-crons, sweep-cron-blackouts) are
 * themselves pg_cron jobs, and only sweep-dead-crons watches the other three.
 * Nothing in the database watches sweep-dead-crons. This is the watcher from
 * OUTSIDE the database, run daily by schedule-heartbeat.yml: each detector must
 * exist, be active, and have a succeeded run within MAX_GAP_HOURS (all four
 * fire at least hourly).
 *
 * Exit 1 with a ::error:: per failing detector. Read-only.
 */
import { sql } from "./lib/opsAlertLedger.mjs";

export const DETECTORS = ["sweep-cron-http-failures", "sweep-silent-cron-failures", "sweep-dead-crons", "sweep-cron-blackouts"];
export const MAX_GAP_HOURS = 3; // CJ-011 gap budget

/** Pure verdict over rows of {jobname, active, hours_since_ok}. */
export function judge(rows) {
  const problems = [];
  for (const name of DETECTORS) {
    const r = rows.find((x) => x.jobname === name);
    if (!r) problems.push(`${name} is not scheduled in cron.job`);
    else if (!r.active) problems.push(`${name} is inactive`);
    else if (r.hours_since_ok === null || r.hours_since_ok === undefined) problems.push(`${name} has never succeeded`);
    else if (Number(r.hours_since_ok) > MAX_GAP_HOURS) problems.push(`${name} last succeeded ${Number(r.hours_since_ok).toFixed(1)}h ago (budget ${MAX_GAP_HOURS}h)`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = DETECTORS.map((n) => `'${n}'`).join(",");
  const rows = await sql(
    `select j.jobname, j.active,
            extract(epoch from now() - (select max(d.end_time) from cron.job_run_details d
                                         where d.jobid = j.jobid and d.status = 'succeeded')) / 3600 as hours_since_ok
       from cron.job j where j.jobname in (${names})`,
    { readOnly: true },
  );
  const problems = judge(rows);
  for (const r of rows) console.log(`${r.jobname}: active=${r.active} last ok ${r.hours_since_ok === null ? "never" : Number(r.hours_since_ok).toFixed(2) + "h ago"}`);
  for (const p of problems) console.log(`::error::${p}. The cron detectors are the only thing watching prod's scheduled jobs; see cron.job_run_details.`);
  process.exit(problems.length ? 1 : 0);
}
