#!/usr/bin/env node
/**
 * PGlite proof for 20260926040011_ops_alert_pending_watchdog (docs/OPEN.md Q1e):
 * nothing watched public.ops_alert_pending.
 *   node src/test/pglite/opsAlertPendingWatchdog.pglite.mjs
 *   WATCHDOG_MIGRATION=skip node src/test/pglite/opsAlertPendingWatchdog.pglite.mjs   # RED
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * schema is the Q94/Q298 proof's (routeProbeCloseRule.pglite.mjs). Applies the
 * ledger chain through Q298, then the new migration 3x (replay-safe), and proves:
 *   - check_ops_alert_pending() folds a queued occurrence into the ledger by
 *     itself (no ops_alert_verify, i.e. with the GitHub hourly job down);
 *   - an occurrence that cannot fold and has sat > 2h is reported ONCE per UTC
 *     day as error_logs source 'ops-alert-pending-stale', which reaches the
 *     ledger as an sql_condition item;
 *   - that item's condition is failing while the stale row is queued and
 *     clears when it is gone; a young (< 2h) queued row is not stale;
 *   - the job is scheduled hourly, has a liveness expectation, and neither
 *     anon nor authenticated can execute the check.
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
  "20260923182022_ops_route_probe_close_rule.sql",
  "20260923215732_cron_http_untagged_close_rule.sql",
  "20260926034740_route_probe_close_rule_hardening.sql",
];
const NEW = "20260926040011_ops_alert_pending_watchdog.sql";

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
-- Q114: RLS and the insert policy exactly as live (pg_policies, prod 2026-09-23).
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
-- public.reports as prod has it (the Q64 proof's fixture, userReportsLedger.pglite.mjs).
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
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
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
  try { await db.exec(mig(f)); } catch (e) { check(`chain ${f}`, false, e.message); }
}
const SKIP = process.env.WATCHDOG_MIGRATION === "skip";
if (SKIP) console.log("WATCHDOG_MIGRATION=skip: running WITHOUT the Q1(e) migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(mig(NEW)); check(`apply ${NEW.slice(0, 14)} pass #${i}`, true); }
    catch (e) { check(`apply ${NEW.slice(0, 14)} pass #${i}`, false, e.message); }
  }
}
const exists = async (sig) => (await q(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig]))[0].ok;
const hasCheck = await exists("public.check_ops_alert_pending()");
check("check_ops_alert_pending() exists", hasCheck);
const watchdog = async () => (hasCheck ? (await q(`SELECT public.check_ops_alert_pending() AS r`))[0].r : null);

// Branches the restatement must keep (newest body before this one is Q298).
{
  const [{ u, p, c }] = await q(`SELECT public.ops_alert_condition('user-report', '{}'::jsonb, now(), true) u,
                                        public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), true) p,
                                        public.ops_alert_condition('cron-http-untagged', '{"job":"x"}'::jsonb, now(), true) c`);
  check("older branches still answer (user-report, push-tokens-empty, cron-http-untagged)", u === true && p === true && c === true, JSON.stringify({ u, p, c }));
}
const [{ probe }] = await q(`SELECT public.ops_alert_condition('ops-alert-pending-stale', '{}'::jsonb, now(), true) probe`);
check("'ops-alert-pending-stale' has a close rule (sql_condition)", probe === true, String(probe));

const queue = (kind, source, title, ageMin) =>
  q(`INSERT INTO public.ops_alert_pending (source_kind, source, title, severity, sample, sample_ref, seen_at, queued_at)
     VALUES ($1, $2, $3, 'error', $3, '{}'::jsonb, now() - make_interval(mins => $4), now() - make_interval(mins => $4))`,
    [kind, source, title, ageMin]);

// 1. A foldable occurrence queued 3h ago: the watchdog folds it by itself.
await queue("workflow", "some-workflow", "queued while the row was busy", 180);
let r = await watchdog();
const [{ n: folded }] = await q(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE source = 'some-workflow'`);
check("the watchdog folds a queued occurrence into the ledger without ops_alert_verify", folded === 1, `ledger rows ${folded}, result ${JSON.stringify(r)}`);
check("a queue it could drain is ok", r?.ok === true, JSON.stringify(r));

// 2. An occurrence that cannot fold (bad source_kind breaks the ledger CHECK), 3h old.
await queue("not-a-kind", "stuck-source", "cannot fold", 180);
r = await watchdog();
check("a row stuck > 2h is reported (ok false)", r?.ok === false, JSON.stringify(r));
const logs = async () => (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'ops-alert-pending-stale'`))[0].n;
check("one error_logs row, source ops-alert-pending-stale", (await logs()) === 1, String(await logs()));
await watchdog();
check("a second run the same UTC day does not report again", (await logs()) === 1, String(await logs()));
const item = (await q(`SELECT verify_kind, status FROM public.ops_alert_ledger WHERE source = 'ops-alert-pending-stale'`))[0];
check("the report reaches the ledger as an sql_condition item", item?.verify_kind === "sql_condition" && item?.status === "open", JSON.stringify(item));
const cond = async () => (await q(`SELECT public.ops_alert_condition('ops-alert-pending-stale', '{}'::jsonb, now() - interval '1 minute') c`))[0].c;
check("its condition is failing while the stale row is queued", (await cond()) === true, String(await cond()));
await q(`DELETE FROM public.ops_alert_pending WHERE source = 'stuck-source'`);
check("its condition clears when the stale row is gone", (await cond()) === false, String(await cond()));

// 3. A young stuck row is not stale.
await queue("not-a-kind", "young-source", "cannot fold, young", 30);
r = await watchdog();
check("a row queued < 2h is not stale", r?.ok === true, JSON.stringify(r));
check("its condition is not failing for a young row", (await cond()) === false, String(await cond()));

// 4. Scheduling, liveness, privileges.
const [job] = await q(`SELECT schedule, command FROM cron.job WHERE jobname = 'ops-alert-pending-watchdog'`);
check("scheduled hourly", job?.schedule === "37 * * * *" && /check_ops_alert_pending\(\)/.test(job?.command ?? ""), JSON.stringify(job));
const [exp] = await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname = 'ops-alert-pending-watchdog'`);
check("has a liveness expectation (3h)", exp?.g === "03:00:00", JSON.stringify(exp));
if (hasCheck) {
  const [priv] = await q(`SELECT has_function_privilege('anon', 'public.check_ops_alert_pending()', 'EXECUTE') a,
                                 has_function_privilege('authenticated', 'public.check_ops_alert_pending()', 'EXECUTE') u,
                                 has_function_privilege('service_role', 'public.check_ops_alert_pending()', 'EXECUTE') s`);
  check("anon and authenticated cannot execute it; service_role can", !priv.a && !priv.u && priv.s, JSON.stringify(priv));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
