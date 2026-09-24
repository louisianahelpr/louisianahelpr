/**
 * PGlite proof for 20260924132850_cron_log_keys_survive_pg_net_id_reuse.
 *
 *   node src/test/pglite/cronLogSurvivesIdReuse.pglite.mjs
 *   BEFORE=1 node src/test/pglite/cronLogSurvivesIdReuse.pglite.mjs   # state before: RED
 *
 * pg_net's response ids restarted on prod 2026-09-24 ~10:04Z. The fixture is
 * cronCatchUpHttpOutcome.pglite.mjs's (the same prod-shaped stand-ins, the
 * same migrations up to 20260923172145, which is where every restated
 * function's newest definition lives), then this migration 3x. Proves: a new
 * response reusing a week-old run's id is ingested into cron_run_log and its
 * body filled; a new failed response reusing an old cron-http alert's id is
 * filed; a tag re-used by a new request gets a fresh created_at; a stale tag
 * cannot claim a response it did not send.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BEFORE = !!process.env.BEFORE;
const FIX = mig("20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql");

// sweep_silent_cron_failures as its newest definition before this migration
// left it (the rest of 20260923090536 is the saturation monitor, not needed).
const SILENT_090536 = /CREATE OR REPLACE FUNCTION public\.sweep_silent_cron_failures\(\)[\s\S]*?\n\$function\$;/.exec(
  mig("20260923090536_db_saturation_monitor.sql"))[0]
  + "\nREVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;";
const PRIOR = [
  mig("20260923133021_cron_missed_slot_catch_up.sql"),
  mig("20260923145516_catch_up_too_late_wording.sql"),
  mig("20260923163407_catch_up_schedule_proof_and_timeouts.sql"),
  SILENT_090536,
  mig("20260923170422_cron_http_request_ids.sql"),
];
const MIGRATION = mig("20260923172145_cron_catch_up_http_outcome_and_untagged.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const safeq = async (label, fn) => {
  try { return await fn(); } catch (e) { check(label, false, e.message.split("\n")[0]); return undefined; }
};

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_run_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL,
  status_code int, body jsonb NOT NULL DEFAULT '{}'::jsonb, response_id bigint NOT NULL,
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX cron_run_log_response_idx ON public.cron_run_log (response_id);
CREATE FUNCTION public.fake_sql_job() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds int);
CREATE TABLE net._http_response (id bigint, status_code int, content_type text, headers jsonb,
  content text, timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.http_request_queue (url, body, headers, timeout_milliseconds)
  VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text,
  username text DEFAULT current_user, database text DEFAULT current_database(), active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule),
  command = coalesce(alter_job.command, cron.job.command) WHERE jobid = job_id $$;
`);

// ── fixture crons, scheduled BEFORE Q174 so its rewrite wraps them ─────────
// Every daily slot is exactly 1 hour ago; each missed it (failed run at the
// slot, a success the day before), all catch-up-safe.
const { m, h } = await one(`SELECT extract(minute FROM t)::int m, extract(hour FROM t)::int h
                              FROM (SELECT (now() - interval '1 hour') AT TIME ZONE 'UTC' t) x`);
const daily = `${m} ${h} * * *`;
const http = (fn) => `SELECT net.http_post(timeout_milliseconds := 30000,
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/${fn}',
  body := '{}'::jsonb);`;
const MISSED = { "http-500": http("http-500"), "http-200": http("http-200"), "http-timeout": http("http-timeout"),
  "http-silent": http("http-silent"), "http-pending": http("http-pending"), "sql-only": "SELECT public.fake_sql_job();" };
for (const [name, cmd] of Object.entries(MISSED)) {
  const { jobid } = await one(`SELECT cron.schedule($1, $2, $3) AS jobid`, [name, daily, cmd]);
  await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time) VALUES
    (${jobid}, 'succeeded', '1 row', now() - interval '25 hours', now() - interval '25 hours'),
    (${jobid}, 'failed', 'job startup timeout', now() - interval '1 hour', now() - interval '1 hour')`);
}
// The tick only runs when the database is healthy: one recent success.
const { jobid: hb } = await one(`SELECT cron.schedule('healthbeat', '*/5 * * * *', 'SELECT 1') AS jobid`);
await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time) VALUES (${hb}, 'succeeded', '1 row', now() - interval '2 minutes')`);
// A tagged cron whose body names its fn (silent-sweep input).
await q(`SELECT cron.schedule('silent-cron', '*/15 * * * *', $1)`, [http("silent-cron")]);

for (const [i, sql] of PRIOR.entries()) {
  try { await db.exec(sql); } catch (e) { check(`prior migration ${i} applies`, false, e.message); }
}
await db.exec(`INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason)
  SELECT j, true, interval '6 hours', 'fixture: safe to run late, it is idempotent' FROM unnest(ARRAY[
    'http-500','http-200','http-timeout','http-silent','http-pending','sql-only']) j`);


await db.exec(MIGRATION);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(FIX);

// A week-old run and a week-old cron-http alert, both on id 5.
await db.exec(`INSERT INTO public.cron_run_log (jobname, status_code, body, response_id, occurred_at)
  VALUES ('silent-cron', 200, '{"fn":"silent-cron"}', 5, now() - interval '8 days');
INSERT INTO public.error_logs (severity, message, tags, context, created_at)
  VALUES ('error', 'old', '{"source":"cron-http"}', '{"response_id":6}', now() - interval '8 days');`);
// pg_net restarts: new requests 5 (ok) and 6 (500) reuse those ids.
await db.exec(`SELECT public.cron_http_tag(5, 'silent-cron'); SELECT public.cron_http_tag(6, 'silent-cron');
INSERT INTO net._http_response (id, status_code, content, created)
  VALUES (5, 200, '{"fn":"silent-cron","ok":true}', now()), (6, 500, '{"fn":"silent-cron"}', now());`);
await db.exec(`SELECT public.sweep_silent_cron_failures()`);
await safeq("sweep_cron_http_failures runs", () => db.exec(`SELECT public.sweep_cron_http_failures()`));

const fresh = await one(`SELECT count(*)::int n, max(body->>'ok') ok FROM public.cron_run_log
  WHERE response_id = 5 AND occurred_at > now() - interval '1 hour'`);
check("a new run reusing an old run's response id is ingested", fresh.n === 1, `rows=${fresh.n}`);
check("its body is filled from ITS response, not the old one", fresh.ok === "true", `ok=${fresh.ok}`);
const filed = await one(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'cron-http'
  AND context->>'response_id' = '6' AND created_at > now() - interval '1 hour'`);
check("a new failure reusing an old alert's response id is filed", filed.n === 1, `rows=${filed.n}`);

// A stale tag (same id, a day old) must not claim a new untagged response.
await db.exec(`INSERT INTO public.cron_http_requests (request_id, jobname, created_at) VALUES (9, 'silent-cron', now() - interval '1 day');
INSERT INTO net._http_response (id, status_code, content, created) VALUES (9, 200, '{"fn":"silent-cron"}', now());`);
await db.exec(`SELECT public.sweep_silent_cron_failures()`);
const stale = await one(`SELECT count(*)::int n FROM public.cron_run_log WHERE response_id = 9`);
check("a stale tag does not make a manual probe a cron run", stale.n === 0, `rows=${stale.n}`);
await db.exec(`UPDATE public.cron_http_requests SET created_at = now() - interval '1 day' WHERE request_id = 5;
  SELECT public.cron_http_tag(5, 'silent-cron');`);
const tag = await one(`SELECT created_at > now() - interval '1 minute' AS fresh FROM public.cron_http_requests WHERE request_id = 5`);
check("a re-used tag id is re-stamped", tag.fresh === true);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
