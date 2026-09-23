#!/usr/bin/env node
/**
 * PGlite proof for 20260923185332_ops_alert_close_rules_and_fair_verify
 * (docs/OPEN.md Q287, Q298, Q291).
 *
 *   node src/test/pglite/opsAlertCloseRulesAndFairVerify.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/opsAlertCloseRulesAndFairVerify.pglite.mjs   # RED: state before
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: the Q94 proof's (routeProbeCloseRule),
 * with cron.job.active as live.
 *
 * Applies the ledger chain through 20260923182022 (Q94), files one
 * 'cron-http-untagged' item BEFORE the new migration, applies it 3x, and proves:
 *   Q287 - the pre-existing item is moved to sql_condition; a new one is filed
 *          sql_condition; still failing while the job is active and untagged,
 *          cleared once wrapped in cron_http_tag( (ops_alert_verify closes it)
 *          or deactivated; 'cron-missed-slot' stays manual (no branch).
 *   Q298 - a screenless (or empty-screen) user-error-screen item stays failing
 *          with a fresh press pass on '/'; a screen item still closes on its own
 *          route's pass (Q94 kept); record_route_probe_passes refuses 1001
 *          routes and keys at most 512 chars.
 *   Q291 (2026-09-23) - 250 fresh still-failing items plus one OLD cleared money item
 *          (detect_stuck_payments): the first ops_alert_verify closes the old
 *          one; two runs ask all 251; a "could not tell" answer is stamped.
 *   grants - anon/authenticated can execute none of the three functions.
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
  // Q94: the newest ops_alert_condition before this one.
  "20260923182022_ops_route_probe_close_rule.sql",
];
const NEW = "20260923185332_ops_alert_close_rules_and_fair_verify.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";

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
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.profiles VALUES ('${REAL}', false);
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}

// ── state BEFORE the migration: an untagged HTTP cron already filed ─────────
const UNTAGGED = "SELECT net.http_post(url := 'https://x/functions/v1/a', body := '{}'::jsonb)";
await q(`INSERT INTO cron.job (jobname, schedule, command) VALUES
           ('untagged-a', '*/5 * * * *', $1), ('untagged-b', '0 * * * *', $1)`, [UNTAGGED]);
// The detector's own row shape (sweep_cron_http_failures, 20260923172145), written server-side.
const fileUntagged = (job) =>
  q(`INSERT INTO public.error_logs (severity, message, tags, context) VALUES ('error', $1, $2::jsonb, '{}'::jsonb)`,
    [`Untagged HTTP cron: ${job} calls net.http_post without public.cron_http_tag(), so its HTTP failures are never filed. Wrap its command as 20260923170422 does.`,
     JSON.stringify({ source: "cron-http-untagged", area: "cron", job })]);
await fileUntagged("untagged-a");
const ledgerOf = (job) =>
  one(`SELECT id, status, verify_kind, verify_ref, last_seen FROM public.ops_alert_ledger
        WHERE source = 'cron-http-untagged' AND sample_ref ->> 'job' = $1`, [job]);
check("before: an untagged-cron item is filed 'manual' (no branch)", (await ledgerOf("untagged-a"))?.verify_kind === "manual",
  JSON.stringify(await ledgerOf("untagged-a")));

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(NEW));
      check(`apply ${NEW.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${NEW.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

const cond = async (source, ref, since = "now() - interval '1 hour'") =>
  (await one(`SELECT public.ops_alert_condition($1, $2::jsonb, ${since}, false) c`, [source, JSON.stringify(ref)])).c;
const probe = async (source, ref) => (await one(`SELECT public.ops_alert_condition($1, $2::jsonb, now(), true) c`, [source, JSON.stringify(ref)])).c;
const verify = () => q(`SELECT public.ops_alert_verify()`);

// Earlier branches survive the restatement.
{
  const r = await one(`SELECT public.ops_alert_condition('user-report', '{}'::jsonb, now(), true) u,
                              public.ops_alert_condition('ops-alert:support_request', '{}'::jsonb, now(), true) s,
                              public.ops_alert_condition('cron-dead', '{"job":"x"}'::jsonb, now(), true) d`);
  check("Q64 and cron-dead branches still answer", r.u === true && r.s === true && r.d === true, JSON.stringify(r));
}

// ── Q287 ────────────────────────────────────────────────────────────────────
{
  const a = await ledgerOf("untagged-a");
  check("Q287: the item filed before the migration now closes by sql_condition",
    a?.verify_kind === "sql_condition" && a?.verify_ref === "cron-http-untagged", JSON.stringify(a));
  await fileUntagged("untagged-b");
  const b = await ledgerOf("untagged-b");
  check("Q287: a new untagged-cron item is filed sql_condition", b?.verify_kind === "sql_condition", JSON.stringify(b));
  check("Q287: still failing while active and untagged", (await cond("cron-http-untagged", { job: "untagged-a" })) === true);
  await verify();
  check("Q287: ops_alert_verify leaves it open", (await ledgerOf("untagged-a"))?.status === "open");
  await q(`UPDATE cron.job SET command = 'SELECT public.cron_http_tag(q.request_id, ''untagged-a'') FROM (' || command || ') AS q(request_id);'
            WHERE jobname = 'untagged-a'`);
  check("Q287: wrapped in cron_http_tag( clears it", (await cond("cron-http-untagged", { job: "untagged-a" })) === false);
  await verify();
  check("Q287: ops_alert_verify closes it", (await ledgerOf("untagged-a"))?.status === "closed", (await ledgerOf("untagged-a"))?.status);
  check("Q287: the other job is still failing", (await cond("cron-http-untagged", { job: "untagged-b" })) === true);
  await q(`UPDATE cron.job SET active = false WHERE jobname = 'untagged-b'`);
  check("Q287: deactivated clears it", (await cond("cron-http-untagged", { job: "untagged-b" })) === false);
  check("Q287: an unscheduled job clears it", (await cond("cron-http-untagged", { job: "gone" })) === false);
  check("Q287: an item with no job cannot be judged", (await probe("cron-http-untagged", {})) === null);
  check("Q287: 'cron-missed-slot' stays manual (no branch)", (await probe("cron-missed-slot", { job: "untagged-a" })) === null);
}

// ── Q298 ────────────────────────────────────────────────────────────────────
{
  // A fresh press pass on '/' AFTER the item's last_seen.
  await q(`SELECT public.record_route_probe_passes(ARRAY['/'], 'run-q298')`);
  const since = "now() - interval '30 hours'";
  check("Q298(a): no screen + a pass on '/' stays failing",
    (await cond("user-error-screen", { title_norm: "no screen · boom" }, since)) === true);
  check("Q298(a): empty screen + a pass on '/' stays failing",
    (await cond("user-error-screen", { title_norm: "no screen · boom", screen: "" }, since)) === true);
  check("Q298(a): a real '/' screen still closes on the '/' pass (Q94 kept)",
    (await cond("user-error-screen", { title_norm: "/ · boom", screen: "/" }, since)) === false);
  check("Q298(a): a screen with no pass stays failing (Q94 kept)",
    (await cond("user-error-screen", { title_norm: "/help · boom", screen: "/help" }, since)) === true);

  let err = null;
  try { await q(`SELECT public.record_route_probe_passes(array_fill('/x'::text, ARRAY[1001]), 'big')`); }
  catch (e) { err = e.message; }
  check("Q298(b): 1001 routes are refused", err !== null && /at most 1000/.test(err), String(err));
  const ok1000 = await one(`SELECT public.record_route_probe_passes(array_fill('/y'::text, ARRAY[1000]), 'max') n`).catch((e) => ({ n: e.message }));
  check("Q298(b): 1000 routes are accepted", ok1000.n === 1, String(ok1000.n));
  await q(`SELECT public.record_route_probe_passes(ARRAY['/' || repeat('a', 700)], 'long')`);
  const long = await one(`SELECT max(length(route)) m FROM public.ops_route_probe`);
  check("Q298(b): a route key is at most 512 chars", long.m <= 512, String(long.m));
}

// ── Q291 ────────────────────────────────────────────────────────────────────
{
  await q(`UPDATE public.ops_alert_ledger SET status = 'closed', closed_at = now(), closed_evidence = 'fixture reset' WHERE status <> 'closed'`);
  // No real push token -> 'push-tokens-empty' is still failing: 250 fresh items (fixture, 2026-09-23).
  await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, last_seen, first_seen, verify_kind, verify_ref)
           SELECT 'burst-' || g, 'error_logs', 'push-tokens-empty', 'burst ' || g, 'error', now() - make_interval(secs => g), now(),
                  'sql_condition', 'push-tokens-empty'
             FROM generate_series(1, 250) g`);
  // An OLD money item whose condition has cleared (no stuck job exists).
  await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, last_seen, first_seen, verify_kind, verify_ref)
           VALUES ('old-money', 'error_logs', 'detect_stuck_payments', 'stuck payment', 'critical', now() - interval '3 days',
                   now() - interval '3 days', 'sql_condition', 'detect_stuck_payments')`);
  // A fresh item nobody can judge yet (no complete minute after it).
  await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, last_seen, first_seen, verify_kind, verify_ref)
           VALUES ('cannot-tell', 'error_logs', 'error-log-throttled', 'throttled', 'error', now() + interval '1 hour',
                   now(), 'sql_condition', 'error-log-throttled')`);
  const cleared = (await cond("detect_stuck_payments", {}, "now() - interval '3 days'")) === false;
  check("Q291: the old money item's condition has cleared", cleared);
  await verify();
  const old = await one(`SELECT status, verify_started_at FROM public.ops_alert_ledger WHERE fingerprint = 'old-money'`);
  check("Q291: one ops_alert_verify closes the old item despite 250 fresh ones", old.status === "closed",
    `status=${old.status} verify_started_at=${old.verify_started_at}`);
  const ct = await one(`SELECT verify_started_at FROM public.ops_alert_ledger WHERE fingerprint = 'cannot-tell'`);
  check("Q291: a 'could not tell' answer is stamped as asked", ct.verify_started_at !== null, String(ct.verify_started_at));
  await verify();
  const never = await one(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE fingerprint LIKE 'burst-%' AND verify_started_at IS NULL`);
  check("Q291: two runs ask every one of the 250 burst items", never.n === 0, `${never.n} never asked`);
}

// ── grants ──────────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["public.ops_alert_condition(text, jsonb, timestamptz, boolean)", "public.ops_alert_verify()",
                    "public.record_route_probe_passes(text[], text)"]) {
    const ok = (await one(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`)).ok;
    check(`${role} cannot execute ${fn}`, ok === false, String(ok));
  }
}
for (const fn of ["public.ops_alert_condition(text, jsonb, timestamptz, boolean)", "public.ops_alert_verify()",
                  "public.record_route_probe_passes(text[], text)"]) {
  const ok = (await one(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE') ok`)).ok;
  check(`service_role can execute ${fn}`, ok === true, String(ok));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
