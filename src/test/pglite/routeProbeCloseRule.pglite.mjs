#!/usr/bin/env node
/**
 * PGlite proof for 20260923182022_ops_route_probe_close_rule (docs/OPEN.md Q94):
 * the SYNTHETIC half of the user-error-screen close rule.
 *
 *   node src/test/pglite/routeProbeCloseRule.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/routeProbeCloseRule.pglite.mjs   # RED: 24h half only
 *   Q298_MIGRATION=skip node src/test/pglite/routeProbeCloseRule.pglite.mjs  # RED: screenless closes via /, unbounded
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture schema is the Q96 proof's
 * (userErrorScreenRepeatCap.pglite.mjs, RLS on error_logs as live).
 *
 * Applies the ledger + user-error-screen chain through 20260923105333, then the
 * new migration 3x (replay-safe), and proves:
 *   - ops_route_key: query/hash/trailing slash dropped, uuid and numeric
 *     segments become :id, "/" stays "/".
 *   - a real person's /jobs/<uuid> screen whose last occurrence is 30h old is
 *     STILL FAILING with no probe pass (was: cleared by the 24h rule alone),
 *     and ops_alert_verify leaves it open;
 *   - a probe pass OLDER than the item's last_seen does not count;
 *   - record_route_probe_passes(['/jobs/<another uuid>?tab=x']) after last_seen
 *     clears it and ops_alert_verify closes it;
 *   - a pass does not override a real occurrence < 24h old;
 *   - an item with no screen stays failing; the overflow item keeps the 24h
 *     rule alone;
 *   - Q298 (20260926034740, applied 3x after Q287's restatement): an item with
 *     no screen (missing or '') stays failing even with a clean pass on '/'
 *     (ops_route_key(null/'') = '/'); record_route_probe_passes refuses a call
 *     over its route cap and truncates each route before keying it (the caps
 *     are the migration's constants, asserted below);
 *   - anon/authenticated can execute neither new function and have no
 *     privilege on ops_route_probe; service_role can.
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
  // Q64: the newest ops_alert_condition before Q94 (adds the user-report branches).
  "20260923181420_user_reports_reach_the_ledger.sql",
];
const Q94 = "20260923182022_ops_route_probe_close_rule.sql";
// Q287 restated ops_alert_condition after Q94 (the newest body Q298 restates).
const Q287 = "20260923215732_cron_http_untagged_close_rule.sql";
const Q298 = "20260926034740_route_probe_close_rule_hardening.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const REAL2 = "aaaaaaaa-0000-0000-0000-000000000002";
const JOB_A = "11111111-2222-4333-8444-555555555555";
const JOB_B = "99999999-8888-4777-8666-555555555555";

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
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${REAL2}', false);
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
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the Q94 migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(Q94));
      check(`apply ${Q94.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${Q94.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
  try { await db.exec(mig(Q287)); } catch (e) { check(`chain ${Q287}`, false, e.message); }
}
const SKIP298 = SKIP || process.env.Q298_MIGRATION === "skip";
if (SKIP298) console.log("Q298_MIGRATION=skip: running WITHOUT the Q298 migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(Q298));
      check(`apply ${Q298.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${Q298.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

// Q64's branches must survive the restatement (it is the newest body before Q94).
{
  const [{ u, s }] = await q(`SELECT public.ops_alert_condition('user-report', '{}'::jsonb, now(), true) u,
                                     public.ops_alert_condition('ops-alert:support_request', '{}'::jsonb, now(), true) s`);
  check("Q64 user-report and ops-alert:support_request branches still answer", u === true && s === true, JSON.stringify({ u, s }));
}

const asClient = async (sub, fn) => {
  await db.exec(`SET ROLE ${sub ? "authenticated" : "anon"}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const ins = (uid, screen, msg) =>
  asClient(uid, () =>
    db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags) VALUES ($1, 'warning', $2, $3::jsonb)`,
      [uid, msg, JSON.stringify({ source: "ErrorState", kind: "user-error-screen", screen })]));
const item = async (like) =>
  (await q(`SELECT id, status, last_seen, sample_ref FROM public.ops_alert_ledger
             WHERE source_kind = 'user-error-screen' AND title LIKE $1`, [like]))[0];
// Age an item: its rows and its last_seen move back by `hours`.
const age = async (screenLike, id, hours) => {
  await q(`UPDATE public.error_logs SET created_at = created_at - make_interval(hours => $2) WHERE tags->>'screen' LIKE $1`, [screenLike, hours]);
  await q(`UPDATE public.ops_alert_ledger SET last_seen = last_seen - make_interval(hours => $2),
             first_seen = first_seen - make_interval(hours => $2) WHERE id = $1`, [id, hours]);
};
const condOf = async (id) =>
  (await q(`SELECT public.ops_alert_condition('user-error-screen', sample_ref, last_seen, false) c
              FROM public.ops_alert_ledger WHERE id = $1`, [id]))[0].c;
const verify = () => q(`SELECT public.ops_alert_verify()`);
const hasFn = async (name) => (await q(`SELECT to_regprocedure($1) IS NOT NULL ok`, [name]))[0].ok;

// ── route key ───────────────────────────────────────────────────────────────
if (await hasFn("public.ops_route_key(text)")) {
  for (const [inp, want] of [
    [`/jobs/${JOB_A}`, "/jobs/:id"], [`/jobs/${JOB_A}/`, "/jobs/:id"], ["/profile?tab=availability", "/profile"],
    ["/admin#health", "/admin"], ["/", "/"], ["/jobs/123", "/jobs/:id"], [`/user/${JOB_B}/reviews`, "/user/:id/reviews"],
    ["/jobs123", "/jobs123"],
  ]) {
    const [{ k }] = await q(`SELECT public.ops_route_key($1) k`, [inp]);
    check(`ops_route_key(${inp.replace(JOB_A, "<uuid>").replace(JOB_B, "<uuid>")}) = ${want}`, k === want, k);
  }
} else check("ops_route_key exists", false);

// ── the synthetic half ──────────────────────────────────────────────────────
await ins(REAL, `/jobs/${JOB_A}`, "Error screen shown: Couldn't load this job.");
let it = await item("/jobs/%");
check("a real person's /jobs/<uuid> error screen opens an item", it?.status === "open", JSON.stringify(it));
check("the item carries its screen", it?.sample_ref?.screen === `/jobs/${JOB_A}`, JSON.stringify(it?.sample_ref));
await age("/jobs/%", it.id, 30);
check("30h old, NO probe pass: still failing (the 24h rule alone used to clear it)", (await condOf(it.id)) === true);
await verify();
check("ops_alert_verify leaves it open", (await item("/jobs/%")).status !== "closed", (await item("/jobs/%")).status);

if (!SKIP) await q(`INSERT INTO public.ops_route_probe (route, passed_at) VALUES ('/jobs/:id', now() - interval '40 hours')`);
check("a probe pass OLDER than last_seen does not count", (await condOf(it.id)) === true);

let n = null;
try { [{ n }] = await q(`SELECT public.record_route_probe_passes(ARRAY[$1, '/home', 'not-a-path'], 'run-1') n`, [`/jobs/${JOB_B}?tab=x`]); }
catch (e) { check("record_route_probe_passes callable", false, e.message); }
check("record_route_probe_passes upserts path keys only (2 of 3)", n === 2, String(n));
check("a pass AFTER last_seen, for another job id on the same route, clears it", (await condOf(it.id)) === false);
await verify();
check("ops_alert_verify then closes it", (await item("/jobs/%")).status === "closed", (await item("/jobs/%")).status);

// A fresh occurrence: the pass is older than the new last_seen, and the row is < 24h.
await ins(REAL2, `/jobs/${JOB_B}`, "Error screen shown: Couldn't load this job.");
it = await item("/jobs/%");
check("a new occurrence re-opens it", it.status === "open", it.status);
if (!SKIP) await q(`SELECT public.record_route_probe_passes(ARRAY['/jobs/x'], 'run-2')`);
await q(`UPDATE public.ops_route_probe SET passed_at = now() + interval '1 minute' WHERE route = '/jobs/:id'`).catch(() => {});
check("a probe pass does not override a real occurrence < 24h old", (await condOf(it.id)) === true);

// No screen → nothing to probe → stays failing.
const noScreen = (await q(`SELECT public.ops_alert_condition('user-error-screen',
    jsonb_build_object('title_norm', 'no screen · boom'), now() - interval '30 hours', false) c`))[0].c;
check("an item with no screen stays failing (nothing to probe)", noScreen === true, String(noScreen));

// Q298: ops_route_key(null/'') = '/', so a clean pass on / must not close a screenless item.
try { await q(`SELECT public.record_route_probe_passes(ARRAY['/'], 'run-root')`); }
catch (e) { check("record a pass on /", false, e.message); }
const rootPass = await q(`SELECT count(*)::int n FROM public.ops_route_probe WHERE route = '/' AND passed_at > now() - interval '30 hours'`)
  .then((r) => r[0].n, (e) => e.message);
check("a pass on / after p_since exists (the precondition)", rootPass === 1, String(rootPass));
for (const [label, ref] of [
  ["no screen key", { title_norm: "no screen · boom" }],
  ["screen ''", { title_norm: "no screen · boom", screen: "" }],
  ["screen null", { title_norm: "no screen · boom", screen: null }],
]) {
  const c = (await q(`SELECT public.ops_alert_condition('user-error-screen', $1::jsonb, now() - interval '30 hours', false) c`,
    [JSON.stringify(ref)]))[0].c;
  check(`Q298: ${label} + a pass on / stays failing (not closed via /)`, c === true, String(c));
}
// ...while a real screen on / still clears on that pass (the probe check is not bypassed).
const rootScreen = (await q(`SELECT public.ops_alert_condition('user-error-screen',
    '{"title_norm":"root · boom","screen":"/?x=1"}'::jsonb, now() - interval '30 hours', false) c`))[0].c;
check("Q298: an item on screen / still clears on a pass on /", rootScreen === false, String(rootScreen));

// Q298 (b): bounded input.
const many = (n) => Array.from({ length: n }, (_, i) => `/bound/r${i}`);
let tooMany = null;
try { await q(`SELECT public.record_route_probe_passes($1::text[], 'run-big')`, [many(1001)]); tooMany = "accepted"; }
catch (e) { tooMany = e.message; }
check("Q298: 1001 routes in one call are refused", /at most 1000/.test(String(tooMany)), String(tooMany).slice(0, 80));
let atCap = null;
try { [{ n: atCap }] = await q(`SELECT public.record_route_probe_passes($1::text[], 'run-cap') n`, [many(1000)]); }
catch (e) { atCap = e.message; }
check("Q298: 1000 routes in one call are accepted", atCap === 1000, String(atCap));
let longest = null;
try {
  await q(`SELECT public.record_route_probe_passes(ARRAY[$1], 'run-long')`, ["/long/" + "a".repeat(2000)]);
  longest = (await q(`SELECT max(length(route))::int l FROM public.ops_route_probe WHERE route LIKE '/long/%'`))[0].l;
  await q(`DELETE FROM public.ops_route_probe WHERE route LIKE '/bound/%' OR route LIKE '/long/%'`);
} catch (e) { longest = e.message; }
check("Q298: a route key is at most 512 characters", typeof longest === "number" && longest <= 512, String(longest));

// Overflow keeps the 24h rule alone: no real rows at all in the last 24h -> cleared.
await q(`UPDATE public.error_logs SET created_at = created_at - interval '48 hours'`);
const overflow = (await q(`SELECT public.ops_alert_condition('user-error-screen', '{"overflow":true}'::jsonb, now() - interval '30 hours', false) c`))[0].c;
check("the overflow item keeps the 24h rule alone", overflow === false, String(overflow));

// ── grants ──────────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["public.ops_route_key(text)", "public.record_route_probe_passes(text[], text)"]) {
    const ok = (await hasFn(fn)) ? (await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`))[0].ok : null;
    check(`${role} cannot execute ${fn}`, ok === false, String(ok));
  }
  const t = (await q(`SELECT to_regclass('public.ops_route_probe') IS NOT NULL e`))[0].e
    ? (await q(`SELECT has_table_privilege('${role}', 'public.ops_route_probe', 'SELECT,INSERT,UPDATE,DELETE') t`))[0].t : null;
  check(`${role} has no privilege on ops_route_probe`, t === false, String(t));
}
const sr = (await hasFn("public.record_route_probe_passes(text[], text)"))
  ? (await q(`SELECT has_function_privilege('service_role', 'public.record_route_probe_passes(text[], text)', 'EXECUTE') ok`))[0].ok : null;
check("service_role can execute record_route_probe_passes", sr === true, String(sr));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
