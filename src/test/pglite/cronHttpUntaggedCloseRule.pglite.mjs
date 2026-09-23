#!/usr/bin/env node
/**
 * PGlite proof for 20260923215732_cron_http_untagged_close_rule (docs/OPEN.md
 * Q287): 'cron-http-untagged' ledger items close automatically.
 *
 *   node src/test/pglite/cronHttpUntaggedCloseRule.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/cronHttpUntaggedCloseRule.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture is the Q94 proof's
 * (routeProbeCloseRule.pglite.mjs) with cron.job.active added.
 *
 * Applies the ledger chain through 20260923182022 (the newest
 * ops_alert_condition before this one), then the new migration 3x, and proves:
 *   - the Q94/Q64 branches still answer (the restatement kept them);
 *   - a 'cron-http-untagged' error_logs row for an ACTIVE untagged HTTP job
 *     becomes a ledger item with verify_kind 'sql_condition';
 *   - its condition is TRUE while the job is still untagged and ops_alert_verify
 *     leaves it open (RED: without the migration it is NULL / 'manual');
 *   - tagging the job's command makes it FALSE and ops_alert_verify closes it;
 *   - a paused, an unscheduled and an unnamed job ('jobid <n>') are judged too;
 *   - 'cron-missed-slot' stays manual: the condition is NULL and its item's
 *     verify_kind is 'manual';
 *   - anon/authenticated cannot execute ops_alert_condition.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const CHAIN = [
  "20260923043402_ops_alert_ledger.sql",
  "20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql",
  "20260923052520_seed_alerts_go_to_the_digest.sql",
  "20260923055631_push_token_health_monitor.sql",
  "20260923085642_user_error_screens_reach_the_ledger.sql",
  "20260923090536_db_saturation_monitor.sql",
  "20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql",
  "20260923094457_error_logs_client_identity_and_throttle.sql",
  "20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql",
  "20260923105333_throttle_drops_kind_rename.sql",
  "20260923130621_seed_boundary_honest_skips_and_monitor.sql",
  "20260923133021_cron_missed_slot_catch_up.sql",
  "20260923181420_user_reports_reach_the_ledger.sql",
  // Q94: the newest ops_alert_condition before Q287.
  "20260923182022_ops_route_probe_close_rule.sql",
];
const Q287 = "20260923215732_cron_http_untagged_close_rule.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text DEFAULT 'error', message text, url text, stack text, user_id uuid, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE INDEX idx_error_logs_user ON public.error_logs USING btree (user_id, created_at DESC);
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY anyone_can_insert_errors ON public.error_logs AS PERMISSIVE FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))));
CREATE FUNCTION public.stamp_error_log_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', coalesce(NEW.tags->'origin', '"server"'), true);
  ELSE
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', '"client"', true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
CREATE TABLE public.jobs (id uuid DEFAULT gen_random_uuid(), stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text, platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text, status text, error_message text, created_at timestamptz DEFAULT now());
CREATE TABLE public.email_send_log (recipient_email text, status text, template_name text, created_at timestamptz);
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid,
  reported_type text NOT NULL CHECK (reported_type = ANY (ARRAY['job','message','user','support','review'])),
  reported_id uuid NOT NULL,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','new','investigating','reviewed','resolved','dismissed')),
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
-- cron.job as pg_cron has it for what this reads: jobname is nullable, active defaults true.
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the Q287 migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(Q287));
      check(`apply ${Q287.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${Q287.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

{
  const [{ u, s, e }] = await q(`SELECT public.ops_alert_condition('user-report', '{}'::jsonb, now(), true) u,
                                        public.ops_alert_condition('ops-alert:support_request', '{}'::jsonb, now(), true) s,
                                        public.ops_alert_condition('user-error-screen', '{}'::jsonb, now(), true) e`);
  check("Q64 and Q94 branches still answer", u === true && s === true && e === true, JSON.stringify({ u, s, e }));
}

const POST = "SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/f', body := '{}'::jsonb)";
const TAGGED = (name) => `SELECT public.cron_http_tag(q.request_id, '${name}')\n  FROM (${POST}\n) AS q(request_id);`;
await q(`INSERT INTO cron.job (jobname, schedule, command, active) VALUES
  ('untagged-a', '*/5 * * * *', $1, true),
  ('untagged-b', '*/5 * * * *', $1, true),
  (NULL,         '*/5 * * * *', $1, true)`, [POST]);
const nullId = (await q(`SELECT jobid FROM cron.job WHERE jobname IS NULL`))[0].jobid;

// The row sweep_cron_http_failures (20260923172145) files, in its shape.
const file = (job, source = "cron-http-untagged") =>
  q(`INSERT INTO public.error_logs (severity, message, tags, context) VALUES ('error', $1,
       jsonb_build_object('source', $3::text, 'area', 'cron', 'job', $2::text), '{}'::jsonb)`,
    [`Untagged HTTP cron: ${job} calls net.http_post without public.cron_http_tag()`, job, source]);
for (const j of ["untagged-a", "untagged-b", `jobid ${nullId}`]) await file(j);
await file("some-job", "cron-missed-slot");

const item = async (source, job) =>
  (await q(`SELECT id, status, verify_kind, last_seen, sample_ref FROM public.ops_alert_ledger
             WHERE source = $1 AND sample_ref->>'job' = $2`, [source, job]))[0];
const cond = async (it) =>
  (await q(`SELECT public.ops_alert_condition(source, sample_ref, last_seen, false) c
              FROM public.ops_alert_ledger WHERE id = $1`, [it.id]))[0].c;
const verify = () => q(`SELECT public.ops_alert_verify()`);

const a = await item("cron-http-untagged", "untagged-a");
check("an untagged-cron error reaches the ledger", !!a, JSON.stringify(a ?? null));
if (a) {
  check("its verify_kind is sql_condition (was manual)", a.verify_kind === "sql_condition", a.verify_kind);
  const c1 = await cond(a);
  check("still untagged: condition TRUE (before: NULL)", c1 === true, String(c1));
  await verify();
  const s1 = (await item("cron-http-untagged", "untagged-a")).status;
  check("ops_alert_verify leaves it open while untagged", s1 !== "closed", s1);

  await q(`UPDATE cron.job SET command = $1 WHERE jobname = 'untagged-a'`, [TAGGED("untagged-a")]);
  const c2 = await cond(a);
  check("tagged: condition FALSE", c2 === false, String(c2));
  await verify();
  const s2 = (await item("cron-http-untagged", "untagged-a")).status;
  check("ops_alert_verify then closes it", s2 === "closed", s2);
}

const b = await item("cron-http-untagged", "untagged-b");
if (b) {
  const c1 = await cond(b);
  check("another still-untagged job stays TRUE", c1 === true, String(c1));
  await q(`UPDATE cron.job SET active = false WHERE jobname = 'untagged-b'`);
  const c2 = await cond(b);
  check("paused: condition FALSE (the sweep ignores paused jobs too)", c2 === false, String(c2));
} else check("untagged-b reached the ledger", false);

const n = await item("cron-http-untagged", `jobid ${nullId}`);
if (n) {
  const c1 = await cond(n);
  check("an unnamed job is judged by 'jobid <n>': TRUE", c1 === true, String(c1));
  await q(`DELETE FROM cron.job WHERE jobid = $1`, [nullId]);
  const c2 = await cond(n);
  check("unscheduled: condition FALSE", c2 === false, String(c2));
} else check("the unnamed job reached the ledger", false);

{
  const [{ c }] = await q(`SELECT public.ops_alert_condition('cron-http-untagged', '{}'::jsonb, now(), false) c`);
  check("an item with no job cannot be judged: NULL", c === null, String(c));
}

const m = await item("cron-missed-slot", "some-job");
{
  const [{ c }] = await q(`SELECT public.ops_alert_condition('cron-missed-slot', '{"job":"some-job"}'::jsonb, now(), true) c`);
  check("cron-missed-slot stays manual: condition NULL", c === null, String(c));
}
check("cron-missed-slot item labelled manual", m?.verify_kind === "manual", m?.verify_kind);

for (const role of ["anon", "authenticated"]) {
  const [{ ok }] = await q(`SELECT has_function_privilege($1, 'public.ops_alert_condition(text,jsonb,timestamptz,boolean)', 'EXECUTE') ok`, [role]);
  check(`${role} cannot execute ops_alert_condition`, ok === false);
}
{
  const [{ ok }] = await q(`SELECT has_function_privilege('service_role', 'public.ops_alert_condition(text,jsonb,timestamptz,boolean)', 'EXECUTE') ok`);
  check("service_role can", ok === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
