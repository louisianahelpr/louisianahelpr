/**
 * PGlite proof for 20260925231818_cron_work_visibility (CJ-007).
 *
 *   node src/test/pglite/cronWorkVisibility.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Proves: the migration applies 3x; every listed SQL cron's command is wrapped
 * by cron.alter_job with its live schedule untouched, a plain `SELECT
 * public.<fn>();` job the list does not name is wrapped too, and a void one,
 * an HTTP one and an already-wrapped one are left alone; running a wrapped
 * command records a cron_run_log row (response_id NULL) carrying the count;
 * the void pruners now return what they deleted; the idle rule files one
 * 'cron-silent' / rule 'idle' row per job per day, only for a job with a full
 * window of history and no work in it; the unrecorded check files active SQL
 * crons not going through cron_record_work (not paused, not HTTP); the
 * candidate rule still fires; the register fills work_visibility and its
 * CHECK rejects a bad entry; anon/authenticated cannot execute the new or
 * recreated functions. RED: the previous detector body (20260924132850) run
 * on the same fixture files no idle and no unrecorded row.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = read("20260925231818_cron_work_visibility.sql");
const OLD_FILE = read("20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql");
// The previous detector only (its first function).
const OLD_SWEEP = OLD_FILE.slice(OLD_FILE.indexOf("CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()"),
  OLD_FILE.indexOf("CREATE OR REPLACE FUNCTION public.sweep_cron_http_failures()"));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

-- Prod shapes (20260829020000 + 20260901030926 + 20260924132850).
CREATE TABLE public.cron_run_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL, status_code int NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb, response_id bigint NOT NULL, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX cron_run_log_response_occurred_idx ON public.cron_run_log (response_id, occurred_at);
CREATE TABLE public.cron_work_expectations (
  jobname text PRIMARY KEY, candidate_key text NULL, disposition_keys text[] DEFAULT ARRAY[]::text[],
  min_streak int NOT NULL DEFAULT 2, note text NOT NULL DEFAULT '', expected_max_gap interval NULL,
  registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.analytics_events (id bigserial, created_at timestamptz DEFAULT now());
CREATE TABLE public.stripe_webhook_events (id bigserial, processed_at timestamptz);
CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) RETURNS void
  LANGUAGE sql AS $f$ INSERT INTO public.defects VALUES (p_fn, p_ref, p_err) $f$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE SCHEMA net; CREATE TABLE net.posts (body jsonb);
CREATE TABLE net._http_response (id bigint, status_code int, content text, created timestamptz,
  timed_out boolean, error_msg text);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
  LANGUAGE sql AS $f$ INSERT INTO net.posts VALUES (body) RETURNING 1::bigint $f$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial, jobid bigint, status text, end_time timestamptz);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
  LANGUAGE sql AS $f$ UPDATE cron.job SET schedule = $2, command = $3 WHERE jobname = $1 RETURNING jobid $f$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $f$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule),
    command = coalesce(alter_job.command, cron.job.command) WHERE jobid = job_id $f$;

-- Stand-ins for the job functions the fixture runs.
CREATE FUNCTION public.sweep_release_last_chance() RETURNS integer LANGUAGE sql AS $f$ SELECT 3 $f$;
CREATE FUNCTION public.detect_stuck_payments() RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$;
CREATE FUNCTION public.reap_stranded_instant_payouts() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"reaped":2,"helpers":[]}'::jsonb $f$;
CREATE FUNCTION public.extend_boosts() RETURNS integer LANGUAGE sql AS $f$ SELECT 5 $f$;
CREATE FUNCTION public.void_thing() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
-- The four void pruners as they are on prod before this migration.
CREATE FUNCTION public.prune_cron_run_log() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.prune_cron_http_requests() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.cleanup_observability_tables() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.cleanup_stripe_webhook_events() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);

// cron.job fixture. Schedules are the LIVE (re-timed) ones.
const jobs = [
  [1, "sweep-release-last-chance", "8,23,38,53 * * * *", "SELECT public.sweep_release_last_chance()"],
  [2, "detect-stuck-payments", "*/15 * * * *", "SELECT public.detect_stuck_payments();"],
  [3, "reap-stranded-instant-payouts", "34 * * * *", "SELECT public.reap_stranded_instant_payouts();"],
  [4, "prune-cron-run-details", "17 4 * * *", "DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'"],
  [5, "extend-boosts-hourly", "0 * * * *", "SELECT public.extend_boosts();"],
  [6, "void-job", "0 * * * *", "SELECT public.void_thing();"],
  [7, "paused-void-job", "0 * * * *", "SELECT public.void_thing();"],
  [8, "payment-confirm-reminder", "15 */6 * * *", "SELECT public.cron_http_tag(net.http_post(url := 'x'), 'payment-confirm-reminder')"],
  [9, "prune-cron-http-requests", "28 * * * *", "SELECT public.prune_cron_http_requests();"],
];
for (const [id, name, sched, cmd] of jobs)
  await q(`INSERT INTO cron.job VALUES ($1,$2,$3,$4,$5)`, [id, name, sched, cmd, name !== "paused-void-job"]);
for (const n of ["sweep-release-last-chance", "detect-stuck-payments", "prune-cron-run-details",
  "prune-cron-http-requests", "sweep-silent-cron-failures", "cron-missed-slot-catch-up", "extend-boosts-hourly"])
  await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ($1, interval '2 hours')`, [n]);
await q(`INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, expected_max_gap)
         VALUES ('payment-confirm-reminder', 'processed', ARRAY['sent'], interval '14 hours')`);

// ── apply 3x ────────────────────────────────────────────────────────────────
let applied = 0;
for (let i = 0; i < 3; i++) {
  try { await db.exec(NEW); applied++; } catch (e) { console.log(`apply ${i + 1}: ${e.message}`); }
}
check("the migration applies 3x", applied === 3, `${applied}/3`);

// ── commands ────────────────────────────────────────────────────────────────
const cmd = async (id) => one(`SELECT command, schedule FROM cron.job WHERE jobid = $1`, [id]);
check("listed SQL cron wrapped", (await cmd(1)).command ===
  "SELECT public.cron_record_work('sweep-release-last-chance', to_jsonb(public.sweep_release_last_chance()));");
check("its live schedule is untouched", (await cmd(1)).schedule === "8,23,38,53 * * * *");
check("raw DELETE job now calls prune_cron_run_details through the recorder, on its own schedule",
  (await cmd(4)).schedule === "17 4 * * *" && (await cmd(4)).command.includes("cron_record_work('prune-cron-run-details', to_jsonb(public.prune_cron_run_details()))"));
check("unlisted plain SELECT job wrapped generically",
  (await cmd(5)).command === "SELECT public.cron_record_work('extend-boosts-hourly', to_jsonb(public.extend_boosts()));");
check("void job left alone", (await cmd(6)).command === "SELECT public.void_thing();");
check("HTTP job left alone", !(await cmd(8)).command.includes("cron_record_work"));

// ── recording ───────────────────────────────────────────────────────────────
for (const id of [1, 3, 5]) await db.exec((await cmd(id)).command);
const rec = await q(`SELECT jobname, body, response_id, status_code FROM public.cron_run_log ORDER BY id`);
check("each run recorded one row, response_id NULL", rec.length === 3 && rec.every((r) => r.response_id === null));
check("an integer result is recorded as {result, fn}",
  JSON.stringify(rec[0].body) === JSON.stringify({ fn: "sweep-release-last-chance", result: 3 }), JSON.stringify(rec[0].body));
check("an object result keeps its keys and gains fn",
  rec[1].body.reaped === 2 && rec[1].body.fn === "reap-stranded-instant-payouts");

// ── pruners report counts ───────────────────────────────────────────────────
await db.exec(`INSERT INTO public.cron_http_requests (request_id, jobname, created_at)
  VALUES (1,'a', now() - interval '3 days'), (2,'a', now() - interval '3 days'), (3,'a', now())`);
check("prune_cron_http_requests returns what it deleted", (await one(`SELECT public.prune_cron_http_requests() n`)).n === 2);
await db.exec(`INSERT INTO cron.job_run_details (jobid, status, end_time) VALUES (1,'succeeded', now() - interval '8 days'), (1,'succeeded', now())`);
check("prune_cron_run_details returns what it deleted", (await one(`SELECT public.prune_cron_run_details() n`)).n === 1);
await db.exec(`INSERT INTO public.stripe_webhook_events (processed_at) VALUES (now() - interval '40 days')`);
check("cleanup_stripe_webhook_events returns what it deleted", (await one(`SELECT public.cleanup_stripe_webhook_events() n`)).n === 1);
await db.exec(`INSERT INTO public.analytics_events (created_at) VALUES (now() - interval '100 days')`);
const obs = (await one(`SELECT public.cleanup_observability_tables() r`)).r;
check("cleanup_observability_tables returns per-table counts", obs.analytics_events === 1 && obs.error_logs === 0, JSON.stringify(obs));
check("prune_cron_run_log returns an integer", (await one(`SELECT pg_typeof(public.prune_cron_run_log())::text t`)).t === "integer");

// ── register + constraint ───────────────────────────────────────────────────
const reg = Object.fromEntries((await q(`SELECT jobname, work_visibility v, work_keys k, max_idle::text i, work_exempt_reason r FROM public.cron_work_expectations`))
  .map((r) => [r.jobname, r]));
check("register: idle job has keys and window", reg["prune-cron-http-requests"].v === "idle" && reg["prune-cron-http-requests"].i === "1 day");
check("register: exempt job has its reason", reg["sweep-release-last-chance"].v === "exempt" && reg["sweep-release-last-chance"].r.includes("log_cron_defect"));
check("register: candidate job marked candidates, key kept", reg["payment-confirm-reminder"].v === "candidates");
let rejected = 0;
for (const bad of [
  `UPDATE public.cron_work_expectations SET work_visibility='exempt', work_exempt_reason='too short' WHERE jobname='detect-stuck-payments'`,
  `UPDATE public.cron_work_expectations SET work_visibility='idle', work_keys=NULL, max_idle=interval '1 day' WHERE jobname='detect-stuck-payments'`,
  `UPDATE public.cron_work_expectations SET work_visibility='sometimes' WHERE jobname='detect-stuck-payments'`,
]) { try { await db.exec(bad); } catch { rejected++; } }
check("the CHECK rejects a short reason, an idle rule without keys, an unknown kind", rejected === 3, `${rejected}/3`);

// ── detector fixture ────────────────────────────────────────────────────────
await db.exec(`DELETE FROM public.cron_run_log; DELETE FROM public.error_logs;`);
// idle, broken: history older than the window, and 5 zero-work runs inside it.
await db.exec(`
INSERT INTO public.cron_run_log (jobname, body, occurred_at) VALUES
  ('prune-cron-http-requests', '{"fn":"prune-cron-http-requests","result":4}', now() - interval '30 hours');
INSERT INTO public.cron_run_log (jobname, body, occurred_at)
  SELECT 'prune-cron-http-requests', '{"fn":"prune-cron-http-requests","result":0}', now() - make_interval(hours => h)
    FROM generate_series(1, 5) h;
-- idle, healthy: one run inside the window did work.
INSERT INTO public.cron_run_log (jobname, body, occurred_at) VALUES
  ('prune-cron-run-details', '{"fn":"prune-cron-run-details","result":0}', now() - interval '4 days'),
  ('prune-cron-run-details', '{"fn":"prune-cron-run-details","result":0}', now() - interval '2 days'),
  ('prune-cron-run-details', '{"fn":"prune-cron-run-details","result":7}', now() - interval '1 day');
-- idle, too new to judge: only zero runs and no history older than its window.
INSERT INTO public.cron_run_log (jobname, body, occurred_at) VALUES
  ('cron-missed-slot-catch-up', '{"fn":"cron-missed-slot-catch-up","succeeded_15m":0}', now() - interval '10 minutes');
-- candidate rule: two consecutive runs that found work and sent none.
INSERT INTO public.cron_run_log (jobname, body, response_id, status_code, occurred_at) VALUES
  ('payment-confirm-reminder', '{"fn":"payment-confirm-reminder","processed":4,"sent":0}', 101, 200, now() - interval '6 hours'),
  ('payment-confirm-reminder', '{"fn":"payment-confirm-reminder","processed":3,"sent":0}', 102, 200, now() - interval '1 hour');
`);

const filed = async () => q(`SELECT tags->>'job' job, tags->>'rule' rule FROM public.error_logs
                              WHERE tags->>'source' = 'cron-silent' ORDER BY 1, 2`);

// RED: the previous body on this fixture.
await db.exec(OLD_SWEEP);
await q(`SELECT public.sweep_silent_cron_failures()`);
const oldRows = await filed();
check("RED: the previous detector files no idle and no unrecorded row",
  !oldRows.some((r) => ["prune-cron-http-requests", "void-job"].includes(r.job)), JSON.stringify(oldRows));
await db.exec(`DELETE FROM public.error_logs; DELETE FROM net.posts;`);

// GREEN: this migration's body.
await db.exec(NEW);
const res = (await one(`SELECT public.sweep_silent_cron_failures() r`)).r;
const rows = await filed();
const got = rows.map((r) => `${r.job}:${r.rule}`);
check("idle job with a whole window of zero work is filed as idle", got.includes("prune-cron-http-requests:idle"), got.join(" "));
check("idle job that did work in the window is not filed", !got.some((g) => g.startsWith("prune-cron-run-details")));
check("idle job without a full window of history is not filed", !got.some((g) => g.startsWith("cron-missed-slot-catch-up")));
check("active SQL cron not recording is filed as unrecorded", got.includes("void-job:unrecorded"));
check("paused SQL cron and HTTP cron are not filed as unrecorded",
  !got.some((g) => g.startsWith("paused-void-job") || g.startsWith("payment-confirm-reminder:unrecorded")));
check("candidate rule still fires, tagged rule candidates", got.includes("payment-confirm-reminder:candidates"));
check("result reports idle and unrecorded counts", res.idle === 1 && res.unrecorded === 1 && res.flagged === 1, JSON.stringify(res));
check("one Slack post for the run", (await one(`SELECT count(*)::int n FROM net.posts`)).n === 1);
await q(`SELECT public.sweep_silent_cron_failures()`);
check("a second sweep the same day files nothing twice", (await filed()).length === rows.length);

// ── ACL ─────────────────────────────────────────────────────────────────────
for (const sig of ["public.cron_record_work(text, jsonb)", "public.prune_cron_run_details()", "public.prune_cron_run_log()",
  "public.prune_cron_http_requests()", "public.cleanup_observability_tables()", "public.cleanup_stripe_webhook_events()",
  "public.sweep_silent_cron_failures()"]) {
  const a = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') anon,
                              has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [sig]);
  check(`anon/authenticated cannot execute ${sig}`, !a.anon && !a.auth);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
