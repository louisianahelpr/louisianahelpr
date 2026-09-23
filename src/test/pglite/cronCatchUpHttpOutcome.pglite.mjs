/**
 * PGlite proof for 20260923172145_cron_catch_up_http_outcome_and_untagged
 * (docs/OPEN.md Q207 part 2, Q218).
 *
 *   node src/test/pglite/cronCatchUpHttpOutcome.pglite.mjs
 *   BEFORE=1 node src/test/pglite/cronCatchUpHttpOutcome.pglite.mjs   # state before: RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The state before is every migration this one restates, in order: the Q30
 * catch-up (133021 + 145516 + 163407), sweep_silent_cron_failures as
 * 20260923090536 left it, and Q174 (20260923170422, which wraps the fixture
 * HTTP crons exactly as it wrapped prod's). Stand-ins for pg_cron, pg_net and
 * vault as in cronHttpTag.pglite.mjs / cronCatchUp.pglite.mjs.
 *
 * Proves: applies 3x; a caught-up HTTP job's claim carries the request id its
 * own command tagged; sweep_cron_http_failures turns a caught-up run answered
 * 500, timed out, or unanswered after 2 hours into 'catch_up_failed' with one
 * 'cron-missed-slot' error each, leaves a 2xx one 'caught_up' (status
 * recorded) and a not-yet-answered recent one unchecked, never touches a
 * SQL-only catch-up, and names them in its one Slack post; an ACTIVE HTTP cron
 * without cron_http_tag( files one 'cron-http-untagged' error per day (a
 * paused one, a tagged one and a SQL-only one none) and is named in the Slack
 * post; re-runs file nothing twice; sweep_silent_cron_failures ingests a
 * tagged response with "fn" but not an untagged manual probe; anon and
 * authenticated can execute none of the three functions.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BEFORE = !!process.env.BEFORE;

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

if (BEFORE) {
  console.log("BEFORE set: checks run against the state BEFORE 20260923172145");
} else {
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(MIGRATION); check(`apply pass #${i}`, true); } catch (e) { check(`apply pass #${i}`, false, e.message); }
  }
}

const wrapped = await one(`SELECT count(*)::int n FROM cron.job WHERE command LIKE '%cron_http_tag(%'`);
check("fixture: Q174 wrapped the 6 HTTP crons", wrapped.n === 6, String(wrapped.n));

// Crons added AFTER Q174, the way Q218 fears: dashboard / SQL editor.
await q(`SELECT cron.schedule('dash-made', '*/30 * * * *', $1)`, [http("dash-made")]);
await q(`SELECT cron.schedule('dash-paused', '*/30 * * * *', $1)`, [http("dash-paused")]);
await db.exec(`UPDATE cron.job SET active = false WHERE jobname = 'dash-paused'`);

// ── Q207(2): the catch-up ticks (v_max_runs caps each tick, so several ticks) ───────────────────────
for (let i = 0; i < 3; i++) await safeq(`catch-up tick ${i + 1}`, () => one(`SELECT public.run_missed_cron_catch_up() r`));
const runs = Object.fromEntries((await safeq("read cron_catchup_runs", () =>
  q(`SELECT jobname, action, request_id::int rid, http_status, http_checked_at IS NOT NULL checked, detail FROM public.cron_catchup_runs`))
  ?? (await q(`SELECT jobname, action FROM public.cron_catchup_runs`))).map((r) => [r.jobname, r]));
check("fixture: all six missed slots were caught up", Object.values(runs).length === 6 &&
  Object.values(runs).every((r) => r.action === "caught_up"), JSON.stringify(Object.values(runs).map((r) => [r.jobname, r.action])));

const tagOf = Object.fromEntries((await q(`SELECT jobname, request_id::int rid FROM public.cron_http_requests`)).map((r) => [r.jobname, r.rid]));
const httpJobs = ["http-500", "http-200", "http-timeout", "http-silent", "http-pending"];
check("each caught-up HTTP run carries the request id its own command tagged",
  httpJobs.every((j) => tagOf[j] > 0 && runs[j]?.rid === tagOf[j]),
  JSON.stringify(httpJobs.map((j) => [j, tagOf[j], runs[j]?.rid])));
check("a caught-up SQL-only job has no request id", "rid" in (runs["sql-only"] ?? {}) && runs["sql-only"].rid === null,
  JSON.stringify(runs["sql-only"]));
const warn = await one(`SELECT context->>'request_id' rid FROM public.error_logs WHERE tags->>'source' = 'cron-caught-up' AND tags->>'job' = 'http-500'`);
check("the caught-up warning names the request id", warn?.rid === String(tagOf["http-500"]), JSON.stringify(warn));

// pg_net's answers.
const rid = (j) => tagOf[j] ?? -1;
await db.exec(`INSERT INTO net._http_response (id, status_code, content, timed_out, error_msg) VALUES
  (${rid("http-500")}, 500, '{"error":"boom"}', false, NULL),
  (${rid("http-200")}, 200, '{"ok":true}', false, NULL),
  (${rid("http-timeout")}, NULL, NULL, true, 'Timeout of 30000 ms reached')`);
// http-silent: never answered, decided 3 hours ago. http-pending: decided just now.
await safeq("backdate http-silent", () => db.exec(`UPDATE public.cron_catchup_runs SET decided_at = now() - interval '3 hours' WHERE jobname = 'http-silent'`));

// Silent-sweep input: a tagged response naming its fn, and a manual probe.
// Fired the way pg_cron fires it: its wrapped command as-is.
const silentId = Number(Object.values(await one((await one(`SELECT command FROM cron.job WHERE jobname = 'silent-cron'`)).command))[0]);
const { id: probeId } = await one(`SELECT net.http_post(url := 'https://x/functions/v1/silent-cron?include_seed=1')::int AS id`);
await db.exec(`INSERT INTO net._http_response (id, status_code, content, timed_out) VALUES
  (${silentId}, 200, '{"fn":"silent-cron","candidates":0}', false),
  (${probeId}, 200, '{"fn":"silent-cron","candidates":3}', false)`);

const slackBefore = (await one(`SELECT coalesce(max(id), 0)::int n FROM net.http_request_queue`)).n;
const s1 = (await safeq("sweep_cron_http_failures()", () => one(`SELECT public.sweep_cron_http_failures() r`)))?.r ?? {};
const after = Object.fromEntries((await safeq("re-read cron_catchup_runs", () =>
  q(`SELECT jobname, action, http_status, http_checked_at IS NOT NULL checked, detail FROM public.cron_catchup_runs`)) ?? []).map((r) => [r.jobname, r]));
const missed = async (j) => (await q(`SELECT context FROM public.error_logs WHERE tags->>'source' = 'cron-missed-slot' AND tags->>'job' = $1`, [j]));

let e = await missed("http-500");
check("a caught-up run answered 500 becomes catch_up_failed with one cron-missed-slot error naming the request",
  after["http-500"]?.action === "catch_up_failed" && /answered 500/.test(after["http-500"]?.detail ?? "") &&
  e.length === 1 && e[0].context.action === "catch_up_failed" && Number(e[0].context.request_id) === tagOf["http-500"],
  JSON.stringify({ run: after["http-500"], e }));
check("a caught-up run answered 200 stays caught_up, status recorded, no alert",
  after["http-200"]?.action === "caught_up" && after["http-200"]?.http_status === 200 && after["http-200"]?.checked === true &&
  (await missed("http-200")).length === 0, JSON.stringify(after["http-200"]));
e = await missed("http-timeout");
check("a caught-up run that timed out becomes catch_up_failed and is alerted",
  after["http-timeout"]?.action === "catch_up_failed" && /timed out/.test(after["http-timeout"]?.detail ?? "") && e.length === 1,
  JSON.stringify(after["http-timeout"]));
e = await missed("http-silent");
check("a caught-up run with no response 2 hours on becomes catch_up_failed and is alerted",
  after["http-silent"]?.action === "catch_up_failed" && /no HTTP response/.test(after["http-silent"]?.detail ?? "") && e.length === 1,
  JSON.stringify(after["http-silent"]));
check("a recent unanswered caught-up run is left unchecked, not alerted",
  after["http-pending"]?.action === "caught_up" && after["http-pending"]?.checked === false && (await missed("http-pending")).length === 0,
  JSON.stringify(after["http-pending"]));
check("a caught-up SQL-only run is never touched by the HTTP check",
  after["sql-only"]?.action === "caught_up" && after["sql-only"]?.checked === false, JSON.stringify(after["sql-only"]));

// ── Q218: untagged HTTP crons ───────────────────────────────────────────────
const untagged = await q(`SELECT tags->>'job' job, severity FROM public.error_logs WHERE tags->>'source' = 'cron-http-untagged' ORDER BY 1`);
check("an active HTTP cron without cron_http_tag( files one cron-http-untagged error; paused/tagged/SQL-only none",
  JSON.stringify(untagged) === JSON.stringify([{ job: "dash-made", severity: "error" }]), JSON.stringify(untagged));
check("sweep reports catch_up_failed 3 and untagged 1",
  s1.catch_up_failed === 3 && s1.untagged === 1 && s1.paged === true, JSON.stringify(s1));
const slack = await q(`SELECT body FROM net.http_request_queue WHERE id > $1 AND url LIKE '%slack-ops-alert'`, [slackBefore]);
const msg = slack[0]?.body?.message ?? "";
check("one Slack post names the failed catch-ups and the untagged cron",
  slack.length === 1 && ["http-500", "http-timeout", "http-silent", "dash-made"].every((j) => msg.includes(j)) && !msg.includes("http-200"),
  JSON.stringify(slack.map((s) => s.body)));

const s2 = (await safeq("sweep again", () => one(`SELECT public.sweep_cron_http_failures() r`)))?.r ?? {};
const nMissed = (await one(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' IN ('cron-missed-slot', 'cron-http-untagged')`)).n;
check("re-running the same day files nothing twice and does not page", s2.catch_up_failed === 0 && s2.untagged === 0 && s2.paged === false && nMissed === 4,
  JSON.stringify({ s2, nMissed }));

// Tag the dashboard cron: next day it would not be filed (today: nothing new either way).
await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '1 day' WHERE tags->>'source' = 'cron-http-untagged'`);
const s3 = (await safeq("sweep next day", () => one(`SELECT public.sweep_cron_http_failures() r`)))?.r ?? {};
check("still untagged the next day: filed again (one per job per day)", s3.untagged === 1, JSON.stringify(s3));

// ── Q218 sibling: sweep_silent_cron_failures ────────────────────────────────
await safeq("sweep_silent_cron_failures()", () => one(`SELECT public.sweep_silent_cron_failures() r`));
const logged = (await q(`SELECT response_id::int rid FROM public.cron_run_log ORDER BY 1`)).map((r) => r.rid);
check("silent sweep ingests the tagged cron response", logged.includes(silentId), JSON.stringify({ logged, silentId }));
check("silent sweep does NOT count an untagged manual probe as a cron run", !logged.includes(probeId), JSON.stringify({ logged, probeId }));

// ── access ──────────────────────────────────────────────────────────────────
for (const fn of ["public.run_missed_cron_catch_up()", "public.sweep_cron_http_failures()", "public.sweep_silent_cron_failures()"]) {
  for (const role of ["anon", "authenticated"]) {
    const g = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, fn]);
    check(`${role} cannot execute ${fn}`, g.ok === false);
  }
}
for (const role of ["anon", "authenticated"]) {
  const g = await one(`SELECT has_table_privilege($1, 'public.cron_catchup_runs', 'SELECT,UPDATE') ok`, [role]);
  check(`${role} cannot read or write cron_catchup_runs`, g.ok === false);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
