/**
 * Q1424 PGlite proof: check_db_saturation's clock edges, on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of the function):
 *   window      the cron call measures a rate only when the previous sample is
 *               at least 60 s old (exactly 60 s: measured; 60 s - 1 ms: not)
 *   retention   db_saturation_samples older than 14 days are deleted (exactly
 *               14 days old: kept; 1 ms older: deleted)
 *   once an hour a report is filed only when none exists with
 *               created_at >= date_trunc('hour', now) (one AT the top of the
 *               hour holds the next; 1 ms before it does not)
 * pg_stat_statements is a plain table here (the function reads it only through
 * to_regclass + EXECUTE); thresholds and problems are stubs, so the hourly case
 * runs on the statement-timeouts path (the workflow's call).
 *
 *   node src/test/pglite/dbSaturationClock.pglite.mjs
 *   DB_SATURATION_INCLUSIVE=1 node src/test/pglite/dbSaturationClock.pglite.mjs   # RED: each edge moved by one
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
await db.exec(`
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA extensions;
CREATE TABLE extensions.pg_stat_statements (queryid bigint, userid oid, calls bigint, total_exec_time double precision);
CREATE TABLE public.db_saturation_state (id int PRIMARY KEY, sampled_at timestamptz, total_calls numeric, total_ms numeric, app_stats jsonb);
CREATE TABLE public.db_saturation_samples (
  id serial, sampled_at timestamptz NOT NULL DEFAULT public._probe_now(), origin text,
  client_conns int, max_conns int, conn_pct numeric, active_conns int, longest_active_s numeric, idle_in_xact int,
  window_s numeric, calls_per_s numeric, exec_ms_per_s numeric, p95_ms numeric, window_app_calls numeric,
  log_timeouts int, log_window_minutes int, db_problems text[], log_problem text);
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb DEFAULT '{}'::jsonb, context jsonb, created_at timestamptz DEFAULT public._probe_now());
CREATE FUNCTION public.db_saturation_thresholds() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"timeouts_per_hour": 5}'::jsonb $$;
CREATE FUNCTION public.db_saturation_problems(s jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::text[] $$;
`);
const { file, stmt } = newestFunction("check_db_saturation");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.DB_SATURATION_INCLUSIVE) {
  console.log("DB_SATURATION_INCLUSIVE=1: each edge moved by one (expect FAILs)");
  fixed = fixed
    .replace("IF v_window_s >= 60 AND", "IF v_window_s > 60 AND")
    .replace("WHERE sampled_at < public._probe_now() - interval '14 days'", "WHERE sampled_at <= public._probe_now() - interval '14 days'")
    .replace(
      "AND e.tags ->> 'source' = 'db-statement-timeouts'\n       AND e.created_at >= date_trunc('hour', public._probe_now())",
      "AND e.tags ->> 'source' = 'db-statement-timeouts'\n       AND e.created_at > date_trunc('hour', public._probe_now())",
    );
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const iso = (ms) => new Date(ms).toISOString();
const N = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back day: 24 h of UTC, 25 of Central wall clock
await setClock(db, iso(N));

{
  // The rate window: previous sample 60 s old is measured, 60 s - 1 ms is not.
  await db.exec(`DELETE FROM extensions.pg_stat_statements; INSERT INTO extensions.pg_stat_statements VALUES (1, 10, 600, 1200);`);
  const windowAt = async (prevMs) => {
    await db.exec(`DELETE FROM public.db_saturation_state;`);
    await q(`INSERT INTO public.db_saturation_state VALUES (1, $1, 0, 0, '{}'::jsonb)`, [iso(prevMs)]);
    return (await q(`SELECT public.check_db_saturation() AS r`))[0].r;
  };
  const at = await windowAt(N - 60_000);
  const inside = await windowAt(N - 60_000 + 1);
  check("a previous sample exactly 60 s old gives a rate window", Number(at.window_s) === 60 && Number(at.calls_per_s) === 10, JSON.stringify({ w: at.window_s, cps: at.calls_per_s }));
  check("a previous sample 60 s - 1 ms old gives none", inside.calls_per_s === null, JSON.stringify({ w: inside.window_s, cps: inside.calls_per_s }));
}

{
  // Retention: exactly 14 days old is kept, 1 ms older is deleted (the call's own sample is the third row).
  const EDGE = N - 14 * 24 * 3_600_000;
  await db.exec(`DELETE FROM public.db_saturation_samples;`);
  await q(`INSERT INTO public.db_saturation_samples (sampled_at, origin) VALUES ($1, 'edge'), ($2, 'past')`, [iso(EDGE), iso(EDGE - 1)]);
  await q(`SELECT public.check_db_saturation(0, 60)`);
  const left = (await q(`SELECT array_agg(origin ORDER BY origin) o FROM public.db_saturation_samples`))[0].o;
  check("a sample exactly 14 days old is kept, 1 ms older is deleted", JSON.stringify(left) === JSON.stringify(["edge", "workflow"]), JSON.stringify(left));
}

{
  // Once an hour: a report AT the top of the hour holds the next; one 1 ms before the hour does not.
  const top = Date.UTC(2026, 10, 1, 12, 0, 0);
  await setClock(db, iso(top + 30 * 60_000));
  const after = async (reportMs) => {
    await db.exec(`DELETE FROM public.error_logs;`);
    await q(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES ('error', 'x', '{"source":"db-statement-timeouts","area":"database"}', $1)`, [iso(reportMs)]);
    await q(`SELECT public.check_db_saturation(100, 60)`);
    return (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'db-statement-timeouts'`))[0].n;
  };
  const atTop = await after(top);
  const before = await after(top - 1);
  check("a timeouts report AT the top of the hour holds the next (no new report)", atTop === 1, String(atTop));
  check("a report 1 ms before the hour does not (a new one is filed)", before === 2, String(before));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
