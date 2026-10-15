/**
 * Q1424 PGlite proof: three more cron-run ops monitors keep their time windows
 * on a fixed clock (./lib/fixedClock.mjs, the newest CREATE of each function).
 *   check_ops_alert_pending           an ops_alert_pending row is stale only once it has been
 *                                     queued MORE than 2 h; one report a UTC day
 *   check_user_reports_reach_ledger   a report is checked only inside (now - 25 h, now - 10 min];
 *                                     a queued ledger row excuses it only while queued < 2 h
 *   check_db_saturation               the call-rate window needs >= 60 s since the last sample;
 *                                     samples are pruned 1 ms past 14 days; one report an hour
 *
 *   node src/test/pglite/opsMonitorWindowsClock.pglite.mjs
 *   OPS_MONITOR_EDGES_MOVED=1 node src/test/pglite/opsMonitorWindowsClock.pglite.mjs   # RED: each edge moved by one
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
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
// Only the columns the three bodies read; helpers they call are stubs with the
// same signatures (their own behaviour is proven elsewhere).
await db.exec(`
SET TIME ZONE 'UTC';
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb DEFAULT '{}'::jsonb, context jsonb,
                                created_at timestamptz DEFAULT public._probe_now());
CREATE TABLE public.ops_alert_pending (id serial, source_kind text, source text, title text, seen_at timestamptz, queued_at timestamptz);
CREATE TABLE public.ops_alert_ledger (id serial, source_kind text, source text, title text, first_seen timestamptz,
                                      last_seen timestamptz, sample_ref jsonb DEFAULT '{}'::jsonb);
CREATE TABLE public.reports (id uuid PRIMARY KEY, reporter_id uuid, reported_type text, reason text, created_at timestamptz);
CREATE FUNCTION public.ops_alert_fold_pending() RETURNS int LANGUAGE sql AS $s$ SELECT 0 $s$;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $s$ SELECT $s$;
CREATE FUNCTION public.ops_alert_normalise(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $s$ SELECT lower(t) $s$;
CREATE FUNCTION public.user_report_is_real(uuid) RETURNS boolean LANGUAGE sql AS $s$ SELECT true $s$;
CREATE FUNCTION public.user_report_title(t text, r text) RETURNS text LANGUAGE sql IMMUTABLE AS $s$ SELECT 'user report: ' || t || ' ' || r $s$;

CREATE TABLE public.db_saturation_state (id int PRIMARY KEY, sampled_at timestamptz, total_calls numeric, total_ms numeric, app_stats jsonb);
CREATE TABLE public.db_saturation_samples (
  id serial, sampled_at timestamptz DEFAULT public._probe_now(), origin text, client_conns int, max_conns int, conn_pct numeric,
  active_conns int, longest_active_s numeric, idle_in_xact int, window_s numeric, calls_per_s numeric, exec_ms_per_s numeric,
  p95_ms numeric, window_app_calls numeric, log_timeouts int, log_window_minutes int, db_problems text[], log_problem text);
CREATE TABLE public._probe_saturated (on_ boolean);
INSERT INTO public._probe_saturated VALUES (false);
CREATE FUNCTION public.db_saturation_thresholds() RETURNS jsonb LANGUAGE sql AS $s$ SELECT '{"timeouts_per_hour": 5}'::jsonb $s$;
CREATE FUNCTION public.db_saturation_problems(jsonb) RETURNS text[] LANGUAGE sql
  AS $s$ SELECT CASE WHEN (SELECT on_ FROM public._probe_saturated) THEN ARRAY['probe saturation'] ELSE ARRAY[]::text[] END $s$;
-- check_db_saturation reads extensions.pg_stat_statements by name (to_regclass), joined to the API roles.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE extensions.pg_stat_statements (queryid bigint, userid oid, calls numeric, total_exec_time double precision);
`);

const MOVED = Boolean(process.env.OPS_MONITOR_EDGES_MOVED);
if (MOVED) console.log("OPS_MONITOR_EDGES_MOVED=1: each window edge moved by one (expect FAILs)");
const EDGE_MOVES = [
  ["queued_at < public._probe_now() - interval '2 hours'", "queued_at <= public._probe_now() - interval '2 hours'"],
  ["AND e.created_at > date_trunc('day', public._probe_now())", "AND e.created_at >= date_trunc('day', public._probe_now())"],
  ["r.created_at >  public._probe_now() - interval '25 hours'", "r.created_at >= public._probe_now() - interval '25 hours'"],
  ["r.created_at <= public._probe_now() - interval '10 minutes'", "r.created_at < public._probe_now() - interval '10 minutes'"],
  ["p.queued_at > public._probe_now() - interval '2 hours'", "p.queued_at >= public._probe_now() - interval '2 hours'"],
  ["IF v_window_s >= 60 AND", "IF v_window_s > 60 AND"],
  ["WHERE sampled_at < public._probe_now() - interval '14 days'", "WHERE sampled_at <= public._probe_now() - interval '14 days'"],
  ["AND e.created_at >= date_trunc('hour', public._probe_now()))", "AND e.created_at > date_trunc('hour', public._probe_now()))"],
];
for (const name of ["check_ops_alert_pending", "check_user_reports_reach_ledger", "check_db_saturation"]) {
  const { file, stmt } = newestFunction(name);
  let fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  for (const [from, to] of EDGE_MOVES) {
    if (!fixed.includes(from)) continue;
    // Each edge this probe moves must exist in the body it proves: a rewritten
    // body that drops one fails here, never passes by not moving it.
    if (MOVED) fixed = fixed.replaceAll(from, to);
  }
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}
{
  const bodies = ["check_ops_alert_pending", "check_user_reports_reach_ledger", "check_db_saturation"].map((n) => onFixedClock(newestFunction(n).stmt)).join("\n");
  const missing = EDGE_MOVES.filter(([from]) => !bodies.includes(from)).map(([from]) => from);
  check("every edge this probe moves is in the newest bodies", missing.length === 0, missing.join(" | "));
}

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back Sunday: 24 h of UTC, 25 of Central wall clock
const count = async (sql) => (await q(sql))[0].n;

{
  // check_ops_alert_pending
  await setClock(db, iso(NOW));
  await db.exec(`DELETE FROM public.ops_alert_pending; DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.ops_alert_pending (source_kind, source, title, seen_at, queued_at) VALUES ('x', 'x', 't', $1, $1)`, [iso(NOW - 2 * HOUR)]);
  let r = (await q(`SELECT public.check_ops_alert_pending() AS r`))[0].r;
  check("check_ops_alert_pending: a row queued exactly 2 h ago is not stale yet", r.ok === true && r.queued === 1, JSON.stringify(r));
  await db.exec(`DELETE FROM public.ops_alert_pending;`);
  await q(`INSERT INTO public.ops_alert_pending (source_kind, source, title, seen_at, queued_at) VALUES ('x', 'x', 't', $1, $1)`, [iso(NOW - 2 * HOUR - 1)]);
  r = (await q(`SELECT public.check_ops_alert_pending() AS r`))[0].r;
  const reported = await count(`SELECT count(*)::int n FROM public.error_logs WHERE tags ->> 'source' = 'ops-alert-pending-stale'`);
  check("check_ops_alert_pending: 1 ms past 2 h it is stale and reported", r.ok === false && r.stale === 1 && reported === 1, `${JSON.stringify(r)}; reports ${reported}`);
  // One report a UTC day: a report AT UTC midnight is yesterday's (report again), 1 ms after is today's (hold).
  const midnight = Date.UTC(2026, 10, 1, 0, 0, 0);
  const again = async (at) => {
    await db.exec(`DELETE FROM public.error_logs;`);
    await q(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES ('error', 'x', '{"source":"ops-alert-pending-stale"}', $1)`, [iso(at)]);
    await q(`SELECT public.check_ops_alert_pending()`);
    return count(`SELECT count(*)::int n FROM public.error_logs`);
  };
  const atMidnight = await again(midnight);
  const afterMidnight = await again(midnight + 1);
  check("check_ops_alert_pending: a report at UTC midnight is yesterday's (reported again), 1 ms after is today's (not)", atMidnight === 2 && afterMidnight === 1, `${atMidnight}, ${afterMidnight}`);
}

{
  // check_user_reports_reach_ledger: (now - 25 h, now - 10 min], reporter real, no ledger trace.
  await setClock(db, iso(NOW));
  const REPORTER = "00000000-0000-4000-8000-0000000000a1";
  const unrecorded = async (...ages) => {
    await db.exec(`DELETE FROM public.reports; DELETE FROM public.error_logs; DELETE FROM public.ops_alert_pending; DELETE FROM public.ops_alert_ledger;`);
    for (const [i, age] of ages.entries()) {
      await q(`INSERT INTO public.reports (id, reporter_id, reported_type, reason, created_at) VALUES ($1, $2, 'job', 'spam', $3)`,
        [`00000000-0000-4000-8000-00000000000${i}`, REPORTER, iso(NOW - age)]);
    }
    return Number((await q(`SELECT public.check_user_reports_reach_ledger() AS n`))[0].n);
  };
  check("check_user_reports_reach_ledger: a report exactly 25 h old is out of the window", (await unrecorded(25 * HOUR)) === 0);
  check("check_user_reports_reach_ledger: 1 ms inside 25 h it is checked (and reported unrecorded)", (await unrecorded(25 * HOUR - 1)) === 1
    && (await count(`SELECT count(*)::int n FROM public.error_logs WHERE tags ->> 'source' = 'user-report-unrecorded'`)) === 1);
  check("check_user_reports_reach_ledger: a report exactly 10 min old is checked", (await unrecorded(10 * MIN)) === 1);
  check("check_user_reports_reach_ledger: 1 ms younger than 10 min it is left for the ledger to catch up", (await unrecorded(10 * MIN - 1)) === 0);
  // A queued (not yet folded) ledger row excuses the report only while it has been queued under 2 h.
  const queued = async (queuedAge) => {
    await db.exec(`DELETE FROM public.reports; DELETE FROM public.error_logs; DELETE FROM public.ops_alert_pending; DELETE FROM public.ops_alert_ledger;`);
    await q(`INSERT INTO public.reports (id, reporter_id, reported_type, reason, created_at) VALUES ($1, $2, 'job', 'spam', $3)`,
      ["00000000-0000-4000-8000-0000000000b1", REPORTER, iso(NOW - 3 * HOUR)]);
    await q(`INSERT INTO public.ops_alert_pending (source_kind, source, title, seen_at, queued_at) VALUES ('user-report', 'user-report', 'user report: job spam', $1, $2)`,
      [iso(NOW - 3 * HOUR), iso(NOW - queuedAge)]);
    return Number((await q(`SELECT public.check_user_reports_reach_ledger() AS n`))[0].n);
  };
  check("check_user_reports_reach_ledger: a row queued exactly 2 h ago no longer excuses the report", (await queued(2 * HOUR)) === 1);
  check("check_user_reports_reach_ledger: 1 ms younger it still does", (await queued(2 * HOUR - 1)) === 0);
}

{
  // check_db_saturation (cron origin: no arguments).
  const AUTH = (await q(`SELECT oid::int AS o FROM pg_roles WHERE rolname = 'authenticated'`))[0].o;
  await db.exec(`DELETE FROM extensions.pg_stat_statements;`);
  await q(`INSERT INTO extensions.pg_stat_statements VALUES (1, $1, 1000, 500)`, [AUTH]);
  const windowAfter = async (gapMs) => {
    await setClock(db, iso(NOW));
    await db.exec(`DELETE FROM public.db_saturation_state; DELETE FROM public.db_saturation_samples; DELETE FROM public.error_logs;`);
    await q(`INSERT INTO public.db_saturation_state VALUES (1, $1, 400, 100, $2::jsonb)`, [iso(NOW - gapMs), JSON.stringify({ [`1:${AUTH}`]: [400, 100] })]);
    return (await q(`SELECT public.check_db_saturation() AS r`))[0].r;
  };
  let r = await windowAfter(60_000);
  check("check_db_saturation: a sample exactly 60 s after the last one measures a window", Number(r.window_s) === 60 && Number(r.calls_per_s) === 10, JSON.stringify({ w: r.window_s, cps: r.calls_per_s }));
  r = await windowAfter(60_000 - 1);
  // window_s is reported rounded (59.999 shows as 60); the rate is what the edge gates.
  check("check_db_saturation: 1 ms short of 60 s it measures no rate", r.calls_per_s === null && r.exec_ms_per_s === null, JSON.stringify({ w: r.window_s, cps: r.calls_per_s }));

  // Samples: kept AT 14 days, deleted 1 ms past.
  await setClock(db, iso(NOW));
  await db.exec(`DELETE FROM public.db_saturation_samples;`);
  await q(`INSERT INTO public.db_saturation_samples (sampled_at, origin) VALUES ($1, 'old'), ($2, 'older')`, [iso(NOW - 14 * DAY), iso(NOW - 14 * DAY - 1)]);
  await q(`SELECT public.check_db_saturation()`);
  const left = (await q(`SELECT array_agg(origin ORDER BY origin) AS o FROM public.db_saturation_samples WHERE origin IN ('old', 'older')`))[0].o;
  check("check_db_saturation: a sample exactly 14 days old is kept, 1 ms older is pruned", JSON.stringify(left) === JSON.stringify(["old"]), JSON.stringify(left));

  // One report an hour: a report AT the top of this hour holds the next; one 1 ms before it does not.
  await db.exec(`UPDATE public._probe_saturated SET on_ = true;`);
  const HOUR_START = Date.UTC(2026, 10, 1, 12, 0, 0);
  await setClock(db, iso(HOUR_START + 30 * MIN));
  const reports = async (at) => {
    await db.exec(`DELETE FROM public.error_logs;`);
    await q(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES ('error', 'x', '{"source":"db-saturation"}', $1)`, [iso(at)]);
    await q(`SELECT public.check_db_saturation()`);
    return count(`SELECT count(*)::int n FROM public.error_logs WHERE tags ->> 'source' = 'db-saturation'`);
  };
  const atTop = await reports(HOUR_START);
  const beforeTop = await reports(HOUR_START - 1);
  check("check_db_saturation: a report at the top of the hour holds the next (1), 1 ms before it does not (2)", atTop === 1 && beforeTop === 2, `${atTop}, ${beforeTop}`);
  await db.exec(`UPDATE public._probe_saturated SET on_ = false;`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
