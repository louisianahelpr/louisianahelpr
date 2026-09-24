#!/usr/bin/env node
/**
 * PGlite proof for 20260924035844_q316_cron_untagged_fingerprint (docs/OPEN.md
 * Q316): 'cron-http-untagged' ledger items are one per job, digits kept.
 *
 *   node src/test/pglite/cronUntaggedFingerprint.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/cronUntaggedFingerprint.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture is cronHttpUntaggedCloseRule's.
 * Applies the ledger chain through Q287 (20260923215732), then the new
 * migration 3x, and proves:
 *   - cleanup-7d / cleanup-30d / 'jobid 12' / 'jobid 13' are FOUR items
 *     (RED: ops_alert_normalise collapses them to two);
 *   - re-filing a job bumps its own item, it does not open another;
 *   - tagging cleanup-7d closes ITS item while cleanup-30d's stays open;
 *   - another source's fingerprint is unchanged (still
 *     md5(source_kind|source|normalised title)), so open items keep matching;
 *   - anon/authenticated/service_role cannot execute ops_alert_apply.
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
  // Q287: the 'cron-http-untagged' close rule this item's bug undermines.
  "20260923215732_cron_http_untagged_close_rule.sql",
];
const Q316 = "20260924035844_q316_cron_untagged_fingerprint.sql";

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
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the Q316 migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(Q316));
      check(`apply ${Q316.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${Q316.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

const POST = "SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/f', body := '{}'::jsonb)";
const TAGGED = (name) => `SELECT public.cron_http_tag(q.request_id, '${name}')\n  FROM (${POST}\n) AS q(request_id);`;
await q(`INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES
  (1,  'cleanup-7d',  '0 3 * * *', $1, true),
  (2,  'cleanup-30d', '0 3 * * *', $1, true),
  (12, NULL,          '0 3 * * *', $1, true),
  (13, NULL,          '0 3 * * *', $1, true)`, [POST]);

// The row sweep_cron_http_failures (20260923172145) files, in its shape.
const file = (job, source = "cron-http-untagged") =>
  q(`INSERT INTO public.error_logs (severity, message, tags, context) VALUES ('error', $1,
       jsonb_build_object('source', $3::text, 'area', 'cron', 'job', $2::text), '{}'::jsonb)`,
    [`Untagged HTTP cron: ${job} calls net.http_post without public.cron_http_tag(), so its HTTP failures are never filed.`, job, source]);
const JOBS = ["cleanup-30d", "cleanup-7d", "jobid 12", "jobid 13"];
for (const j of JOBS) await file(j);

const items = () =>
  q(`SELECT id, status, count, sample_ref->>'job' AS job FROM public.ops_alert_ledger
      WHERE source = 'cron-http-untagged' AND sample_ref ? 'job' ORDER BY 4`);
{
  const [{ t7, t30 }] = await q(`SELECT public.ops_alert_normalise('Untagged HTTP cron: cleanup-7d calls') t7,
                                        public.ops_alert_normalise('Untagged HTTP cron: cleanup-30d calls') t30`);
  check("precondition: the normalised titles collide", t7 === t30, `${t7} | ${t30}`);
  const rows = await items();
  check("four digit-differing jobs are four ledger items", rows.length === 4, `${rows.length}: ${rows.map((r) => r.job).join(", ")}`);
  check("each item names its own job", JSON.stringify(rows.map((r) => r.job)) === JSON.stringify(JOBS), rows.map((r) => r.job).join(", "));
}

await file("cleanup-30d");
{
  const rows = await items();
  const n = (j) => rows.find((r) => r.job === j)?.count;
  check("re-filing cleanup-30d bumps its own item, opens no new one",
    rows.length === 4 && n("cleanup-30d") === 2 && n("cleanup-7d") === 1, JSON.stringify(rows.map((r) => [r.job, r.count])));
}

await q(`UPDATE cron.job SET command = $1 WHERE jobname = 'cleanup-7d'`, [TAGGED("cleanup-7d")]);
await q(`SELECT public.ops_alert_verify()`);
{
  const rows = await items();
  const s = (j) => rows.find((r) => r.job === j)?.status;
  check("tagging cleanup-7d closes its item", s("cleanup-7d") === "closed", String(s("cleanup-7d")));
  check("cleanup-30d, still untagged, stays open", s("cleanup-30d") === "open", String(s("cleanup-30d")));
}

// Another source, and a cron-http-untagged row with no job, keep the old fingerprint.
await file("nightly-9", "cron-dead");
await q(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error', 'Untagged HTTP cron: 42 without a job tag',
          jsonb_build_object('source', 'cron-http-untagged', 'area', 'cron'))`);
{
  const rows = await q(`SELECT source, title, fingerprint, md5(source_kind || '|' || source || '|' || title) AS old_fp
                          FROM public.ops_alert_ledger
                         WHERE source = 'cron-dead' OR (source = 'cron-http-untagged' AND NOT sample_ref ? 'job')`);
  const dead = rows.find((r) => r.source === "cron-dead");
  const nojob = rows.find((r) => r.source === "cron-http-untagged");
  check("an unrelated source's fingerprint is unchanged", !!dead && dead.fingerprint === dead.old_fp, JSON.stringify(dead ?? null));
  check("an untagged row with no job keeps the old fingerprint", !!nojob && nojob.fingerprint === nojob.old_fp, JSON.stringify(nojob ?? null));
}

for (const role of ["anon", "authenticated", "service_role"]) {
  const [{ ok }] = await q(`SELECT has_function_privilege($1, 'public.ops_alert_apply(text,text,text,text,text,jsonb,text,text,timestamptz)', 'EXECUTE') ok`, [role]);
  check(`${role} cannot execute ops_alert_apply`, ok === false);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
