/**
 * Q1357 PGlite proof: the cron-monitor sweeps judge a row 1 ms inside their
 * window and leave one exactly AT its edge, at a Central midnight and on both
 * 2026 DST nights.
 *
 *   node src/test/pglite/sweepCronMonitorClock.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Sweeps (newest CREATE across the migrations, clock reads pointed at a fixed
 * instant by ./lib/fixedClock.mjs):
 *   sweep_cron_blackouts         a dispatch gap of 15+ min that ENDED in the last 24 h
 *   sweep_cron_startup_failures  3 failed runs inside 20 min; one page per 20 min
 *   sweep_cron_http_failures     a failed tagged response in the last 60 min; an
 *                                unanswered catch-up 2 h on; untagged cron once per UTC day
 *   sweep_dead_crons             no start within expected_max_gap; a raised error in 24 h;
 *                                one row per job per UTC day
 *   sweep_silent_cron_failures   ingest responses from the last 6 h; streaks over 30 days
 * Session TimeZone is UTC, as pg_cron's sessions on prod are, so the "UTC day"
 * dedupes turn over at 00:00Z whatever Central time it is.
 *
 * Probe-only rewrite (besides the clock): `pg_extension WHERE extname = 'pg_cron'`
 * reads a one-row stand-in, because PGlite has no pg_cron and the sweeps return
 * early without it. net.http_post and vault are absent on purpose: every Slack
 * post sits in an EXCEPTION block, so a missing notifier is the case it handles.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);

await db.exec(`
SET TIME ZONE 'UTC';
CREATE SCHEMA cron; CREATE SCHEMA net;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, active boolean DEFAULT true, command text);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
CREATE TABLE net._http_response (id bigint, status_code int, timed_out boolean, error_msg text, content text, created timestamptz);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text,
  tags jsonb, context jsonb, created_at timestamptz DEFAULT public._probe_now());
CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz);
CREATE TABLE public.cron_catchup_runs (jobname text, slot timestamptz, request_id bigint, decided_at timestamptz,
  action text, http_checked_at timestamptz, http_status int, detail text);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, registered_at timestamptz,
  candidate_key text, disposition_keys text[], min_streak int, note text, work_visibility text, work_keys text[], max_idle interval);
CREATE TABLE public.cron_run_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), jobname text, status_code int,
  body jsonb, response_id bigint, occurred_at timestamptz, UNIQUE (response_id, occurred_at));
CREATE FUNCTION public.check_ops_digest_delivery() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"ok":true}'::jsonb $f$;
`);

const SWEEPS = ["sweep_cron_blackouts", "sweep_cron_startup_failures", "sweep_cron_http_failures", "sweep_dead_crons", "sweep_silent_cron_failures"];
for (const name of SWEEPS) {
  const { file, stmt } = newestFunction(name);
  const fixed = onFixedClock(stmt).replace(/FROM\s+pg_extension\s+WHERE\s+extname\s*=\s*'pg_cron'/gi, "FROM (SELECT 'pg_cron'::text AS extname) x WHERE extname = 'pg_cron'");
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}

const fresh = () => db.exec(`DELETE FROM cron.job; DELETE FROM cron.job_run_details; DELETE FROM net._http_response;
  DELETE FROM public.error_logs; DELETE FROM public.cron_http_requests; DELETE FROM public.cron_catchup_runs;
  DELETE FROM public.cron_work_expectations; DELETE FROM public.cron_run_log;`);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const logged = async (source) => Number((await q(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = $1`, [source]))[0].n);
const run = async (sweep) => (await q(`SELECT public.${sweep}() AS r`))[0].r;

// A Central midnight (00:00 CDT), the fall-back night (01:30 CST, the repeated
// hour's second pass) and the spring-forward night (03:30 CDT, just after the gap).
const INSTANTS = ["2026-10-12T05:00:00Z", "2026-11-01T07:30:00Z", "2026-03-08T08:30:00Z"];

for (const at of INSTANTS) {
  const now = Date.parse(at);

  // sweep_cron_blackouts: a 20-minute gap that ended exactly 24 h ago is old news;
  // 1 ms later it is the newest blackout and is reported once.
  for (const [label, end, want] of [["ended AT now-24h", now - DAY, 0], ["ended 1 ms inside 24 h", now - DAY + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job_run_details (jobid, status, start_time) VALUES (1, 'succeeded', $1), (1, 'succeeded', $2)`, [iso(end - 20 * MIN), iso(end)]);
    const r = await run("sweep_cron_blackouts");
    check(`${at} sweep_cron_blackouts: gap ${label} -> flagged ${want}`, Number(r.flagged) === want, JSON.stringify(r));
    if (want) {
      const again = await run("sweep_cron_blackouts");
      check(`${at} sweep_cron_blackouts: the same gap is not reported twice`, Number(again.flagged) === 0 && (await logged("cron-blackout")) === 1, JSON.stringify(again));
    }
  }

  // sweep_cron_startup_failures: three failed runs inside 20 minutes page; the
  // oldest exactly AT now-20min leaves two, which does not.
  for (const [label, oldest, want] of [["oldest AT now-20min", now - 20 * MIN, false], ["oldest 1 ms inside", now - 20 * MIN + 1, true]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname) VALUES (1, 'a')`);
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time) VALUES
      (1, 'failed', 'job startup timeout', $1), (1, 'failed', 'job startup timeout', $2), (1, 'failed', 'job startup timeout', $2)`, [iso(oldest), iso(now - MIN)]);
    const r = await run("sweep_cron_startup_failures");
    check(`${at} sweep_cron_startup_failures: 3 failures, ${label} -> reported ${want}`, r.reported === want, JSON.stringify(r));
  }
  // ...and while an incident runs, a page within the last 20 minutes holds the next one.
  for (const [label, last, want] of [["last page AT now-20min", now - 20 * MIN, true], ["last page 1 ms inside", now - 20 * MIN + 1, false]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job_run_details (jobid, status, start_time) VALUES (1, 'failed', $1), (1, 'failed', $1), (1, 'failed', $1)`, [iso(now - MIN)]);
    await q(`INSERT INTO public.error_logs (severity, tags, created_at) VALUES ('fatal', '{"source":"cron-startup-timeout"}', $1)`, [iso(last)]);
    const r = await run("sweep_cron_startup_failures");
    check(`${at} sweep_cron_startup_failures: ${label} -> pages again ${want}`, r.reported === want, JSON.stringify(r));
  }

  // sweep_cron_http_failures: a tagged 500 created exactly 60 min ago is outside
  // the lookback; 1 ms later it is filed (and only once).
  for (const [label, created, want] of [["created AT now-60min", now - 60 * MIN, 0], ["created 1 ms inside", now - 60 * MIN + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO net._http_response (id, status_code, timed_out, content, created) VALUES (7, 500, false, '{"fn":"a"}', $1)`, [iso(created)]);
    await q(`INSERT INTO public.cron_http_requests VALUES (7, 'a', $1)`, [iso(created - MIN)]);
    const r = await run("sweep_cron_http_failures");
    check(`${at} sweep_cron_http_failures: a 500 ${label} -> logged ${want}`, Number(r.logged) === want, JSON.stringify(r));
    if (want) check(`${at} sweep_cron_http_failures: re-read is idempotent`, Number((await run("sweep_cron_http_failures")).logged) === 0);
  }
  // A caught-up slot with no response is decided as failed once 2 h have passed, strictly.
  for (const [label, decided, want] of [["decided AT now-2h", now - 2 * HOUR, 0], ["decided 1 ms before that", now - 2 * HOUR - 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO public.cron_catchup_runs (jobname, slot, request_id, decided_at, action) VALUES ('a', $1, 9, $1, 'caught_up')`, [iso(decided)]);
    const r = await run("sweep_cron_http_failures");
    const left = (await q(`SELECT action FROM public.cron_catchup_runs`))[0].action;
    check(`${at} sweep_cron_http_failures: unanswered catch-up ${label} -> failed ${want}`, Number(r.catch_up_failed) === want && left === (want ? "catch_up_failed" : "caught_up"), `${JSON.stringify(r)} action=${left}`);
  }
  // An untagged HTTP cron is filed once per UTC day: a row AT 00:00Z today holds it, one 1 ms before does not.
  const dayStart = Math.floor(now / DAY) * DAY;
  for (const [label, prev, want] of [["previous row AT 00:00Z", dayStart, 0], ["previous row 1 ms before 00:00Z", dayStart - 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname, command) VALUES (3, 'raw', 'select net.http_post(url := ''x'')')`);
    await q(`INSERT INTO public.error_logs (severity, tags, created_at) VALUES ('error', '{"source":"cron-http-untagged","job":"raw"}', $1)`, [iso(prev)]);
    const r = await run("sweep_cron_http_failures");
    check(`${at} sweep_cron_http_failures: untagged cron, ${label} -> filed ${want}`, Number(r.untagged) === want, JSON.stringify(r));
  }

  // sweep_dead_crons: a job last started exactly expected_max_gap (1 h) ago is
  // alive; 1 ms more and it is dead.
  for (const [label, last, want] of [["last start AT now-1h", now - HOUR, 0], ["last start 1 ms past 1 h", now - HOUR - 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname, command) VALUES (1, 'hourly', 'select 1')`);
    await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, registered_at) VALUES ('hourly', '1 hour', $1)`, [iso(now - 30 * DAY)]);
    await q(`INSERT INTO cron.job_run_details (jobid, status, start_time, end_time) VALUES (1, 'succeeded', $1, $1)`, [iso(last)]);
    const r = await run("sweep_dead_crons");
    check(`${at} sweep_dead_crons: ${label} -> flagged ${want}`, Number(r.flagged) === want, JSON.stringify(r));
  }
  // A run that raised its own error counts for 24 h, strictly.
  for (const [label, started, want] of [["raised AT now-24h", now - DAY, 0], ["raised 1 ms inside 24 h", now - DAY + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname, command) VALUES (1, 'daily', 'select 1')`);
    await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, registered_at) VALUES ('daily', '2 days', $1)`, [iso(now - 30 * DAY)]);
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time) VALUES (1, 'failed', 'ERROR: boom', $1, $1)`, [iso(started)]);
    const r = await run("sweep_dead_crons");
    check(`${at} sweep_dead_crons: ${label} -> flagged ${want}`, Number(r.flagged) === want, JSON.stringify(r));
  }
  // One row per job per UTC day: a row AT 00:00Z is not "today" (strict >), 1 ms after is.
  for (const [label, prev, want] of [["previous row AT 00:00Z", dayStart, 1], ["previous row 1 ms after 00:00Z", dayStart + 1, 0]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname, command) VALUES (1, 'hourly', 'select 1')`);
    await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, registered_at) VALUES ('hourly', '1 hour', $1)`, [iso(now - 30 * DAY)]);
    await q(`INSERT INTO cron.job_run_details (jobid, status, start_time, end_time) VALUES (1, 'succeeded', $1, $1)`, [iso(now - 3 * HOUR)]);
    await q(`INSERT INTO public.error_logs (severity, tags, created_at) VALUES ('error', '{"source":"cron-dead","job":"hourly"}', $1)`, [iso(prev)]);
    const r = await run("sweep_dead_crons");
    check(`${at} sweep_dead_crons: dead job, ${label} -> filed ${want}`, Number(r.flagged) === want, JSON.stringify(r));
  }

  // sweep_silent_cron_failures: ingests a tagged response from the last 6 h, strictly.
  for (const [label, created, want] of [["response AT now-6h", now - 6 * HOUR, 0], ["response 1 ms inside", now - 6 * HOUR + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO net._http_response (id, status_code, timed_out, content, created) VALUES (11, 200, false, '{"fn":"a","found":0}', $1)`, [iso(created)]);
    await q(`INSERT INTO public.cron_http_requests VALUES (11, 'a', $1)`, [iso(created - MIN)]);
    const r = await run("sweep_silent_cron_failures");
    check(`${at} sweep_silent_cron_failures: ${label} -> recorded ${want}`, Number(r.recorded) === want, JSON.stringify(r));
  }
  // A found-work-did-none run counts toward the streak for 30 days, strictly.
  for (const [label, occurred, want] of [["run AT now-30d", now - 30 * DAY, 0], ["run 1 ms inside 30 d", now - 30 * DAY + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO cron.job (jobid, jobname, command) VALUES (1, 'a', 'select net.http_post(url := public.cron_http_tag(''a''))')`);
    await q(`INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, min_streak, note) VALUES ('a', 'found', ARRAY['done'], 1, 'probe')`);
    await q(`INSERT INTO public.cron_run_log (jobname, body, response_id, occurred_at) VALUES ('a', '{"found":3,"done":0}', 1, $1)`, [iso(occurred)]);
    const r = await run("sweep_silent_cron_failures");
    check(`${at} sweep_silent_cron_failures: ${label} -> flagged ${want}`, Number(r.flagged) === want, JSON.stringify(r));
  }
}

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
