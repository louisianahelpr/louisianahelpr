#!/usr/bin/env node
/**
 * PGlite proof for 20261012202854_cron_first_run_404_grace (Q1690): a 404 on
 * a NEW cron's first run (its edge function not uploaded yet) is not filed;
 * everything else is filed as before.
 *
 *   node src/test/pglite/cronFirstRunRacesItsFunction.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cronFirstRunRacesItsFunction.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: the objects sweep_cron_http_failures
 * reads (net._http_response, cron.job, public.cron_http_requests,
 * public.cron_catchup_runs, public.error_logs) and stubs for net.http_post and
 * vault. The "before" body is cut from 20261004004835 (prod's, md5-checked
 * 2026-10-12).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261012202854_cron_first_run_404_grace.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA net; CREATE SCHEMA cron; CREATE SCHEMA vault;
  CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code int, timed_out boolean, error_msg text,
    created timestamptz, content text);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, command text, active boolean DEFAULT true);
  CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz);
  CREATE TABLE public.cron_catchup_runs (jobname text, slot timestamptz, request_id bigint, decided_at timestamptz,
    action text, http_checked_at timestamptz, http_status int, detail text);
  CREATE TABLE public.error_logs (id uuid DEFAULT gen_random_uuid(), severity text, message text, tags jsonb,
    context jsonb, created_at timestamptz DEFAULT now());
  INSERT INTO cron.job (jobname, command) VALUES ('old-job', 'SELECT public.cron_http_tag(''old-job'', net.http_post(''x''))');
`);
await db.exec(cut("20261004004835_client_rows_cannot_mute_server_alerts.sql", "sweep_cron_http_failures"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

// Crons scheduled by a LATER migration (after the backfill), and their responses.
// new-job:   404 on its first run, then a 2xx (the function arrived) -> skipped.
// never-job: 404 on its first run, 50 minutes ago, nothing since   -> filed.
// young-job: 404 on its first run, 5 minutes ago, nothing since    -> not yet judged.
await db.exec(`
  INSERT INTO cron.job (jobname, command) VALUES
    ('new-job', 'SELECT public.cron_http_tag(''new-job'', net.http_post(''x''))'),
    ('never-job', 'SELECT public.cron_http_tag(''never-job'', net.http_post(''x''))'),
    ('young-job', 'SELECT public.cron_http_tag(''young-job'', net.http_post(''x''))'),
    ('mid-job', 'SELECT public.cron_http_tag(''mid-job'', net.http_post(''x''))');
  INSERT INTO net._http_response VALUES
    (1, 404, false, NULL, now() - interval '20 minutes', 'Requested function was not found'),
    (2, 404, false, NULL, now() - interval '20 minutes', 'Requested function was not found'),
    (3, 500, false, NULL, now() - interval '19 minutes', 'boom'),
    (5, 200, false, NULL, now() - interval '10 minutes', '{}'),
    (6, 404, false, NULL, now() - interval '50 minutes', 'Requested function was not found'),
    (7, 404, false, NULL, now() - interval '5 minutes', 'Requested function was not found'),
    (10, 404, false, NULL, now() - interval '35 minutes', 'Requested function was not found');
  INSERT INTO public.cron_http_requests VALUES
    (10, 'mid-job', now() - interval '35 minutes'),
    (1, 'new-job', now() - interval '20 minutes'),
    (2, 'old-job', now() - interval '20 minutes'),
    (3, 'new-job', now() - interval '19 minutes'),
    (5, 'new-job', now() - interval '10 minutes'),
    (6, 'never-job', now() - interval '50 minutes'),
    (7, 'young-job', now() - interval '5 minutes');
`);

const sweep = async () => (await db.query(`SELECT public.sweep_cron_http_failures() AS r`)).rows[0].r;
const filed = async (rid) => Number((await db.query(`SELECT count(*)::int n FROM public.error_logs WHERE context->>'response_id' = '${rid}'`)).rows[0].n);

const r1 = await sweep();
check("a NEW cron's first-run 404, followed by a success, is not filed", (await filed(1)) === 0, `${await filed(1)} row(s)`);
check("  and the sweep counts it", Number(r1.first_run_404_skipped) >= 1 && (r1.first_run_404_jobs ?? []).includes("new-job"), JSON.stringify(r1));
check("an EXISTING cron's 404 is still filed", (await filed(2)) === 1);
check("a new cron's 500 is still filed (the grace is for 404 only)", (await filed(3)) === 1);
check("a first-run 404 that never recovered, 50 minutes on, is filed", (await filed(6)) === 1, `${await filed(6)} row(s)`);
check("a first-run 404 5 minutes old with nothing since is not judged yet", (await filed(7)) === 0);
check("a first-run 404 35 minutes old with nothing since is filed on the first run that sees it (two runs remain in the lookback)", (await filed(10)) === 1, `${await filed(10)} row(s)`);
await db.exec(`UPDATE net._http_response SET created = now() - interval '50 minutes' WHERE id = 7;
               UPDATE public.cron_http_requests SET created_at = now() - interval '50 minutes' WHERE request_id = 7;
               ${MODE ? "" : "UPDATE public.cron_job_first_seen SET first_seen = now() - interval '50 minutes' WHERE jobname = 'young-job';"}`);
await sweep();
check("  ...and is filed once it is 30+ minutes old with still no success", (await filed(7)) === 1, `${await filed(7)} row(s)`);
await sweep();
check("a re-read never files the recovered 404 later", (await filed(1)) === 0);

// Anchored at the first RUN: a sweep that first sees a job late does not widen
// the window backwards past 20 minutes before that run.
await db.exec(`
  INSERT INTO cron.job (jobname, command) VALUES ('late-seen', 'SELECT public.cron_http_tag(''late-seen'', net.http_post(''x''))');
  INSERT INTO net._http_response VALUES
    (8, 404, false, NULL, now() - interval '55 minutes', 'Requested function was not found'),
    (9, 200, false, NULL, now() - interval '2 minutes', '{}');
  INSERT INTO public.cron_http_requests VALUES (8, 'late-seen', now() - interval '55 minutes'), (9, 'late-seen', now() - interval '2 minutes');
`);
await sweep();
const lateSeen = MODE ? null : (await db.query(`SELECT first_seen FROM public.cron_job_first_seen WHERE jobname = 'late-seen'`)).rows[0]?.first_seen;
check("first_seen is the job's first tagged request, not the sweep's late sighting", MODE ? false : Math.abs(new Date(lateSeen).getTime() - (Date.now() - 55 * 60e3)) < 120e3, String(lateSeen));

// The same new cron, 45 minutes past its first run, with no success in between.
await db.exec(`
  ${MODE ? "" : "UPDATE public.cron_job_first_seen SET first_seen = now() - interval '45 minutes' WHERE jobname = 'new-job';"}
  DELETE FROM net._http_response WHERE id = 5;
  INSERT INTO net._http_response VALUES (4, 404, false, NULL, now() - interval '1 minute', 'Requested function was not found');
  INSERT INTO public.cron_http_requests VALUES (4, 'new-job', now() - interval '1 minute');
`);
await sweep();
check("a 404 more than 30 minutes after the job's first run is filed", (await filed(4)) === 1);

if (!MODE) {
  const priv = async (role) => (await db.query(`SELECT has_table_privilege('${role}', 'public.cron_job_first_seen', 'SELECT') x`)).rows[0].x;
  check("cron_job_first_seen: no client can read it", !(await priv("anon")) && !(await priv("authenticated")));
  const old = (await db.query(`SELECT first_seen::text f FROM public.cron_job_first_seen WHERE jobname = 'old-job'`)).rows[0]?.f;
  check("a job that existed at migration time has no grace (-infinity)", old === "-infinity", old);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
