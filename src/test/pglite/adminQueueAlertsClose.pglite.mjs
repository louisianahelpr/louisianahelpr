#!/usr/bin/env node
/**
 * PGlite proof for 20260925155922_admin_queue_alerts_close_themselves
 * (docs/OPEN.md Q355): admin-queue Slack posts close themselves.
 *
 *   node src/test/pglite/adminQueueAlertsClose.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminQueueAlertsClose.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/adminQueueAlertsClose.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The fixture is the Q287 proof's (cronHttpUntaggedCloseRule.pglite.mjs) plus
 * the queue tables the new rules read, in their prod shape.
 *
 * Applies the ledger chain through the newest ops_alert_condition
 * (20260923215732) and ops_alert_verify/apply (20260924041136), records a
 * "Ban review needed" item the way the ledger backfill did (sample_ref
 * {error_log_id}, verify 'companions'), then applies the new migration 3x and
 * proves:
 *   - the existing item is re-pointed to sql_condition, title + deep link kept;
 *   - BAN REVIEW: it stays open while the named user's violation is
 *     pending_ban_review and closes once it leaves it (RED without the
 *     migration: companions, never closes); a new post re-opens it; another
 *     real user still pending holds it open, a seed user's does not;
 *   - a NEW post of each queue title gets sql_condition from the default hook
 *     (the mirror's own sample_ref: link null, oncePerDayKey) and re-asks its
 *     queue: IDV review, reported user (direct and via an application),
 *     dispute open, dispute split unsettled, stalled job, stuck payment;
 *   - any other 'custom' post keeps 'companions' (condition NULL);
 *   - the Q64 / Q94 / Q287 branches still answer (restatement kept them);
 *   - anon/authenticated cannot execute any new function.
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
  // Q287: the newest ops_alert_condition before Q355.
  "20260923215732_cron_http_untagged_close_rule.sql",
  "20260924005818_ops_alert_verify_is_fair.sql",
  "20260924035844_q316_cron_untagged_fingerprint.sql",
  // Q316: the newest ops_alert_verify / ops_alert_apply.
  "20260924041136_q316_shared_ops_alert_fingerprint.sql",
];
const NEW = "20260925155922_admin_queue_alerts_close_themselves.sql";
const MIGRATION = process.env.MIGRATION_PATH ? readFileSync(process.env.MIGRATION_PATH, "utf8") : mig(NEW);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = "aaaaaaaa-0000-4000-8000-000000000001"; // real, the named subject
const U2 = "aaaaaaaa-0000-4000-8000-000000000002"; // another real user
const SEED = "bbbbbbbb-0000-4000-8000-000000000003";
const ADMIN = "dddddddd-0000-4000-8000-000000000004";
const J = "eeeeeeee-0000-4000-8000-000000000005";
const JSEED = "eeeeeeee-0000-4000-8000-000000000006";

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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean, idv_status text);
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
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text, platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text, status text, error_message text, created_at timestamptz DEFAULT now());
CREATE TABLE public.email_send_log (recipient_email text, status text, template_name text, created_at timestamptz);
-- public.reports as prod has it after 20260924182505 ('application' admitted).
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid,
  reported_type text NOT NULL CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application'])),
  reported_id uuid NOT NULL,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','new','investigating','reviewed','resolved','dismissed')),
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
-- The queue tables the Q355 rules read, prod columns (src/integrations/supabase/types.ts).
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  violation_type text NOT NULL, action_taken text NOT NULL, description text, job_id uuid, reported_by uuid,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_id text, target_type text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, job_id uuid);
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, opener_id uuid,
  reason text NOT NULL DEFAULT 'x', status text NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open','decided','withdrawn','superseded'])),
  execution_status text, execution_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.job_completion_nudges (job_id uuid PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz,
  escalated_at timestamptz, resolved_at timestamptz);
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
INSERT INTO public.profiles VALUES ('${U}', false, 'verified'), ('${U2}', false, 'verified'),
  ('${SEED}', true, 'verified'), ('${ADMIN}', false, 'verified');
INSERT INTO public.jobs (id, is_seed, customer_id) VALUES ('${J}', false, '${U}'), ('${JSEED}', true, '${SEED}');
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}

// ── before the migration: the Q355 item as prod had it ─────────────────────
// The ledger backfill's shape (20260923043402 §8): the transport's own
// error_logs row (source ops-alert), recorded edge_slack/ops-alert:custom with
// sample_ref {error_log_id}. The mirror put the link in context.fields.deep_link.
const [{ id: elId }] = await q(`INSERT INTO public.error_logs (severity, message, tags, context) VALUES
  ('error', 'Ban review needed — Some Name has cancelled 3 jobs',
   '{"source":"ops-alert","kind":"custom"}',
   jsonb_build_object('fields', jsonb_build_object('deep_link', '/admin?view=banreview&user=${U}'), 'link', null))
  RETURNING id`);
await q(`SELECT public.ops_alert_record('edge_slack', 'ops-alert:custom', 'Ban review needed', 'critical',
           'Ban review needed — Some Name has cancelled 3 jobs', jsonb_build_object('error_log_id', $1::text),
           NULL, NULL, now() - interval '2 hours')`, [elId]);
await q(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ('${U}', 'cancellation', 'pending_ban_review')`);
const ban = async () =>
  (await q(`SELECT * FROM public.ops_alert_ledger WHERE source = 'ops-alert:custom' AND title = 'ban review needed'`))[0];
check("before: the ban-review item is 'companions' (the Q355 state)", (await ban())?.verify_kind === "companions");

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the Q355 migration (expect FAILs)");
else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`apply ${NEW.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${NEW.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

const verify = () => q(`SELECT public.ops_alert_verify()`);
const cond = async (id) =>
  (await q(`SELECT public.ops_alert_condition(coalesce(verify_ref, source), sample_ref, last_seen, false) c
              FROM public.ops_alert_ledger WHERE id = $1`, [id]))[0].c;
// A post the way send-push-notification's mirror records it.
const post = (title, link, at = "now()") =>
  q(`SELECT public.ops_alert_record('edge_slack', 'ops-alert:custom', $1, 'critical', $1,
       jsonb_build_object('link', null, 'oncePerDayKey', 'admin-push:' || lower($1) || '|' || $2),
       NULL, NULL, ${at}) AS id`, [title, link]);
const item = async (title) =>
  (await q(`SELECT * FROM public.ops_alert_ledger WHERE source = 'ops-alert:custom'
             AND title = public.ops_alert_normalise($1)`, [title]))[0];

// ── the Q355 item: ban review ──────────────────────────────────────────────
{
  const b = await ban();
  check("re-pointed: verify_kind sql_condition, verify_ref ops-alert:custom",
    b?.verify_kind === "sql_condition" && b?.verify_ref === "ops-alert:custom", `${b?.verify_kind}/${b?.verify_ref}`);
  check("re-point kept the title and the backfilled row's deep link",
    b?.sample_ref?.admin_title === "ban review needed" && b?.sample_ref?.admin_link === `/admin?view=banreview&user=${U}`,
    JSON.stringify(b?.sample_ref));
  check("violation pending_ban_review: condition TRUE", (await cond(b.id)) === true, String(await cond(b.id)));
  await verify();
  check("ops_alert_verify leaves it open while pending", (await ban()).status !== "closed", (await ban()).status);

  await q(`UPDATE public.user_violations SET action_taken = 'banned' WHERE user_id = '${U}'`);
  check("violation left pending_ban_review: condition FALSE", (await cond(b.id)) === false, String(await cond(b.id)));
  await verify();
  const closed = await ban();
  check("ops_alert_verify closes it", closed.status === "closed", `${closed.status} ${closed.closed_evidence ?? ""}`);

  // A new post for another real user re-opens it; the mirror's own sample_ref.
  await q(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ('${U2}', 'no_show', 'pending_ban_review')`);
  await post("Ban review needed", `/admin?view=banreview&user=${U2}`);
  const re = await ban();
  check("a new post re-opens it, still sql_condition", re.status === "open" && re.verify_kind === "sql_condition", `${re.status}/${re.verify_kind}`);
  check("its subject is read from the mirror's oncePerDayKey", (await cond(re.id)) === true);

  // Named subject cleared, but ANOTHER real user still waits -> still open.
  await q(`SELECT public.ops_alert_record('edge_slack', 'ops-alert:custom', 'Ban review needed', 'critical', 'x',
             jsonb_build_object('link', null, 'oncePerDayKey', 'admin-push:ban review needed|/admin?view=banreview&user=${U}'),
             NULL, NULL, now())`);
  check("named user clear, another real user pending: still TRUE", (await cond(re.id)) === true);
  await q(`UPDATE public.user_violations SET action_taken = 'dismissed' WHERE user_id = '${U2}'`);
  // A seed user's pending review never holds the item open.
  await q(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ('${SEED}', 'no_show', 'pending_ban_review')`);
  check("only a seed user pending: FALSE", (await cond(re.id)) === false, String(await cond(re.id)));
  await verify();
  check("…and it closes", (await ban()).status === "closed", (await ban()).status);
}

// ── every other queue title: new posts get sql_condition and re-ask ────────
const newItem = async (title, link) => {
  await post(title, link);
  const it = await item(title);
  check(`"${title}": new post is sql_condition`, it?.verify_kind === "sql_condition", it?.verify_kind);
  return it;
};

{ // IDV review
  await q(`UPDATE public.profiles SET idv_status = 'manual_review' WHERE user_id = '${U}'`);
  const it = await newItem("Identity verification needs review", `/admin?view=people&user=${U}`);
  check("IDV manual_review: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.profiles SET idv_status = 'failed' WHERE user_id = '${U}'`);
  check("IDV failed, no admin decision yet: TRUE", (await cond(it.id)) === true);
  await q(`INSERT INTO public.admin_audit_log (admin_id, action, target_id, created_at)
           VALUES ('${ADMIN}', 'idv_reject', '${U}', now() + interval '1 second')`);
  check("IDV rejected by an admin after the post: FALSE", (await cond(it.id)) === false, String(await cond(it.id)));
  await q(`UPDATE public.profiles SET idv_status = 'manual_review' WHERE user_id = '${U2}'`);
  check("another real person in manual_review: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = '${U2}'`);
  await q(`UPDATE public.profiles SET idv_status = 'manual_review' WHERE user_id = '${SEED}'`);
  check("only a seed person in manual_review: FALSE", (await cond(it.id)) === false);
}

{ // reported user (auto_escalate_reports)
  const [{ id: appId }] = await q(`INSERT INTO public.applications (helper_id, job_id) VALUES ('${U}', '${J}') RETURNING id`);
  const it = await newItem("User flagged — 3+ reports", `/admin?view=people&user=${U}`);
  check("no open report: FALSE", (await cond(it.id)) === false);
  const [{ id: r1 }] = await q(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason)
                                 VALUES ('${U2}', 'application', '${appId}', 'rude') RETURNING id`);
  check("open report via the person's application: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.reports SET status = 'resolved' WHERE id = '${r1}'`);
  await q(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ('${U2}', 'user', '${U}', 'rude')`);
  check("open report on the person: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.reports SET status = 'dismissed' WHERE reported_type = 'user'`);
  check("all resolved/dismissed: FALSE", (await cond(it.id)) === false);
}

{ // disputes: the /admin?view=disputes queue (jobs.status 'disputed' + unsettled decided splits)
  const it = await newItem("Dispute escalated", `/admin?view=disputes&job=${J}`);
  check("no disputed job, nothing unsettled: FALSE", (await cond(it.id)) === false);
  await q(`UPDATE public.jobs SET status = 'disputed' WHERE id = '${J}'`);
  check("job disputed: TRUE", (await cond(it.id)) === true);
  const [{ id: d }] = await q(`INSERT INTO public.disputes (job_id, status, execution_status) VALUES ('${J}', 'decided', NULL) RETURNING id`);
  await q(`UPDATE public.jobs SET status = 'completed' WHERE id = '${J}'`);
  check("decided, execution NULL (never executed): still TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.disputes SET execution_status = 'executed' WHERE id = '${d}'`);
  check("settlement executed: FALSE", (await cond(it.id)) === false);
  await q(`UPDATE public.jobs SET status = 'disputed' WHERE id = '${JSEED}'`);
  await q(`INSERT INTO public.disputes (job_id, status, execution_status) VALUES ('${JSEED}', 'decided', 'failed')`);
  check("only a seed job disputed / unsettled: FALSE", (await cond(it.id)) === false);

  const s = await newItem("Dispute split did not settle", `/admin?view=disputes&job=${J}`);
  await q(`UPDATE public.disputes SET execution_status = 'executing' WHERE id = '${d}'`);
  check("decided, execution 'executing': TRUE", (await cond(s.id)) === true);
  await q(`UPDATE public.disputes SET execution_status = 'executed' WHERE id = '${d}'`);
  check("execution 'executed': FALSE", (await cond(s.id)) === false);

  // "Dispute stuck" is also sent for split_pending: a DECIDED split, job no longer disputed.
  const st = await newItem("Dispute stuck — escrow cannot auto-settle", `/admin?view=disputes&job=${J}`);
  await q(`UPDATE public.disputes SET execution_status = 'pending' WHERE id = '${d}'`);
  check("\"Dispute stuck\" on a decided, pending split: TRUE", (await cond(st.id)) === true);
  await q(`UPDATE public.disputes SET execution_status = 'executed' WHERE id = '${d}'`);
  check("\"Dispute stuck\" once executed: FALSE", (await cond(st.id)) === false);
  const o = await newItem("Escalated dispute overdue", `/admin?view=disputes&job=${J}`);
  check("\"Escalated dispute overdue\" with the queue clear: FALSE", (await cond(o.id)) === false);
}

{ // stalled job
  await q(`INSERT INTO public.job_completion_nudges (job_id, escalated_at) VALUES ('${J}', now())`);
  const it = await newItem("Job stalled — nobody marked it done", `/admin?view=stalled&job=${J}`);
  check("escalated, not resolved: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.job_completion_nudges SET resolved_at = now() WHERE job_id = '${J}'`);
  check("resolved: FALSE", (await cond(it.id)) === false);
}

{ // stuck payment -> the detector's own branch
  const it = await newItem("Stuck payment — webhook may be failing", `/admin?view=people&user=${U}`);
  await q(`UPDATE public.jobs SET stripe_session_id = 'cs_test_1', payment_status = 'unpaid', status = 'open',
             created_at = now() - interval '1 hour' WHERE id = '${J}'`);
  check("an unsettled real checkout: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.jobs SET payment_status = 'paid' WHERE id = '${J}'`);
  check("settled: FALSE", (await cond(it.id)) === false);
}

{ // not an admin-queue post: unchanged
  await post("Notification email refused: the seed-boundary check is failing", "");
  const o = await q(`SELECT * FROM public.ops_alert_ledger WHERE title LIKE 'notification email refused%'`);
  check("any other 'custom' post keeps companions", o[0]?.verify_kind === "companions", o[0]?.verify_kind);
  const [{ c }] = await q(`SELECT public.ops_alert_condition('ops-alert:custom', '{"oncePerDayKey":"send-notification-email:x"}'::jsonb, now(), true) c`);
  check("…its condition is NULL", c === null, String(c));
  const [{ n }] = await q(`SELECT public.ops_alert_condition('ops-alert:custom', '{}'::jsonb, now(), true) n`);
  check("a custom post with no title: NULL", n === null, String(n));
}

{ // the restatement kept every branch
  const [{ u, s, e, h }] = await q(`SELECT public.ops_alert_condition('user-report', '{}'::jsonb, now(), true) u,
      public.ops_alert_condition('ops-alert:support_request', '{}'::jsonb, now(), true) s,
      public.ops_alert_condition('user-error-screen', '{}'::jsonb, now(), true) e,
      public.ops_alert_condition('cron-http-untagged', '{"job":"x"}'::jsonb, now(), true) h`);
  check("Q64, Q94 and Q287 branches still answer", u && s && e && h, JSON.stringify({ u, s, e, h }));
}

const FNS = [
  "public.admin_alert_close_rule(text)",
  "public.admin_alert_ref(jsonb)",
  "public.admin_queue_still_pending(text,jsonb,timestamptz)",
  "public.ops_alert_condition(text,jsonb,timestamptz,boolean)",
];
for (const fn of FNS) {
  let exists = true;
  try { await q(`SELECT $1::regprocedure`, [fn]); } catch { exists = false; }
  if (!exists) { check(`${fn} exists`, false); continue; }
  for (const role of ["anon", "authenticated"]) {
    const [{ ok }] = await q(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, fn]);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
  const [{ ok }] = await q(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') ok`, [fn]);
  check(`service_role can execute ${fn}`, ok === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
