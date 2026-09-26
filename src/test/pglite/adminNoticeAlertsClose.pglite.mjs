#!/usr/bin/env node
/**
 * PGlite proof for 20260926035647_admin_notice_alerts_close_themselves
 * (docs/OPEN.md Q355, part 2): the admin posts that name no queue close too.
 *
 *   node src/test/pglite/adminNoticeAlertsClose.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminNoticeAlertsClose.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/adminNoticeAlertsClose.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Fixture: the part-1 proof's (adminQueueAlertsClose.pglite.mjs) plus
 * notifications, jobs arrival columns and profiles ban columns.
 *
 * Applies the chain through 20260925155922, records part-2 posts the way the
 * mirror does (they get 'companions'), applies the new migration 3x, proves:
 *   - money-held: open while ANY alerted job's money is held (escrow /
 *     payout_pending), including an earlier job the newest post does not
 *     name and one whose notification has since been deleted; a group job
 *     'released' with a roster member unpaid still counts; closes once all
 *     are paid out or refunded; seed jobs never count;
 *   - arrival-unconfirmed: the reminder's own predicate;
 *   - restriction-review / repeat-offender / low-rating: open until a
 *     moderation DECISION on the person AFTER the alert (an earlier one, a
 *     note or an impersonation does not count), the suspension runs out, the
 *     person is banned, or the flag is reversed;
 *   - notices close on the next verify; no subject at all -> NULL;
 *   - "Cancellation fee transfer failed" is 'manual' (existing re-pointed, new
 *     ones labelled by the trigger), never closed by verify, closed by
 *     ops_alert_close with evidence; unrelated custom posts stay companions;
 *   - part-1 rules still answer; anon/authenticated cannot execute anything new.
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
  // Q355 part 1: the admin-QUEUE rules this one restates.
  "20260925155922_admin_queue_alerts_close_themselves.sql",
];
const NEW = "20260926035647_admin_notice_alerts_close_themselves.sql";
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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean, idv_status text, ban_status text, auto_suspended_until timestamptz);
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
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid,
  helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz, is_group_job boolean);
-- The group roster and the payout ledger the group-job money rule reads.
CREATE TABLE public.group_job_helpers (job_id uuid NOT NULL, helper_id uuid);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  helper_id uuid, status text NOT NULL, amount_cents int NOT NULL DEFAULT 0);
-- notifications as prod has it (types.ts).
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL DEFAULT '', type text NOT NULL, link text, job_id uuid, read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
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
INSERT INTO public.profiles (user_id, is_seed, idv_status) VALUES ('${U}', false, 'verified'), ('${U2}', false, 'verified'),
  ('${SEED}', true, 'verified'), ('${ADMIN}', false, 'verified');
INSERT INTO auth.users (id) VALUES ('${U}'), ('${U2}'), ('${SEED}'), ('${ADMIN}');
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
const J2 = "eeeeeeee-0000-4000-8000-000000000007";
await q(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin')`);
await q(`INSERT INTO public.jobs (id, is_seed, customer_id, payment_status, status) VALUES ('${J2}', false, '${U2}', 'released', 'completed')`);

// ── before the migration: the part-2 titles are 'companions' (unclosable) ──
const post = (title, link, at = "now()") =>
  q(`SELECT public.ops_alert_record('edge_slack', 'ops-alert:custom', $1, 'critical', $1,
       jsonb_build_object('link', null, 'oncePerDayKey', 'admin-push:' || lower($1) || '|' || $2),
       NULL, NULL, ${at}) AS id`, [title, link]);
// What the fan-out itself writes: one operator notification per admin.
const notify = (title, link, jobId = null, at = "now()") =>
  q(`INSERT INTO public.notifications (user_id, title, type, link, job_id, created_at)
     VALUES ('${ADMIN}', $1, 'admin_alert', $2, $3, ${at})`, [title, link, jobId]);
const item = async (title) =>
  (await q(`SELECT * FROM public.ops_alert_ledger WHERE source = 'ops-alert:custom'
             AND title = public.ops_alert_normalise($1)`, [title]))[0];
const cond = async (id) =>
  (await q(`SELECT public.ops_alert_condition(coalesce(verify_ref, source), sample_ref, last_seen, false) c
              FROM public.ops_alert_ledger WHERE id = $1`, [id]))[0].c;
const verify = () => q(`SELECT public.ops_alert_verify()`);

await q(`UPDATE public.jobs SET payment_status = 'payout_pending', status = 'completed' WHERE id = '${J}'`);
await notify("Payout blocked — charge not captured", `/admin?view=jobs&job=${J}`, J, "now() - interval '2 hours'");
await post("Payout blocked — charge not captured", `/admin?view=jobs&job=${J}`, "now() - interval '2 hours'");
await post("Cancellation fee transfer failed", `/admin?view=jobs&job=${J2}`, "now() - interval '2 hours'");
check("before: 'Payout blocked' is companions (the Q355 state)", (await item("Payout blocked — charge not captured"))?.verify_kind === "companions");
check("before: 'Cancellation fee transfer failed' is companions", (await item("Cancellation fee transfer failed"))?.verify_kind === "companions");

// A notification whose link names an account deleted since (no auth.users
// row): the backfill must skip it, not fail the whole migration on the FK.
await notify("Repeat offender: Gone Person", "/admin?view=people&user=99999999-0000-4000-8000-000000000099", null, "now() - interval '3 hours'");

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the part-2 migration (expect FAILs)");
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

// ── money-held ─────────────────────────────────────────────────────────────
{
  const it = await item("Payout blocked — charge not captured");
  check("re-pointed: 'Payout blocked' is sql_condition", it?.verify_kind === "sql_condition", it?.verify_kind);
  check("job still payout_pending: TRUE", (await cond(it.id)) === true);
  await verify();
  check("verify leaves it open", (await item("Payout blocked — charge not captured")).status !== "closed");
  // A second job blocked under the same title; the newest post names J2 only.
  await q(`UPDATE public.jobs SET payment_status = 'payout_pending' WHERE id = '${J2}'`);
  await notify("Payout blocked — charge not captured", `/admin?view=jobs&job=${J2}`, J2);
  await post("Payout blocked — charge not captured", `/admin?view=jobs&job=${J2}`);
  await q(`UPDATE public.jobs SET payment_status = 'released' WHERE id = '${J2}'`);
  check("newest job paid, an earlier notified job still held: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.jobs SET payment_status = 'released' WHERE id = '${J}'`);
  check("every notified job paid out: FALSE", (await cond(it.id)) === false, String(await cond(it.id)));
  await verify();
  check("…and verify closes it", (await item("Payout blocked — charge not captured")).status === "closed");

  for (const t of ["Scheduled payout failed", "Transfer failed", "Payout blocked — exceeds captured amount"]) {
    await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J}'`);
    await notify(t, `/admin?view=jobs&job=${J}`, J);
    await post(t, `/admin?view=jobs&job=${J}`);
    const x = await item(t);
    check(`"${t}": new post is sql_condition`, x?.verify_kind === "sql_condition", x?.verify_kind);
    check(`"${t}": escrow still held: TRUE`, (await cond(x.id)) === true);
    await q(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${J}'`);
    check(`"${t}": refunded: FALSE`, (await cond(x.id)) === false);
  }
  await q(`UPDATE public.jobs SET payment_status = 'payout_pending' WHERE id = '${JSEED}'`);
  await notify("Transfer failed", `/admin?view=jobs&job=${JSEED}`, JSEED);
  check("a seed job's held escrow never holds it open", (await cond((await item("Transfer failed")).id)) === false);

  // Subjects outlive their notifications (a deleted or TTL-swept bell row).
  await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J}'`);
  await q(`DELETE FROM public.notifications WHERE title = 'Transfer failed'`);
  const tf = await item("Transfer failed");
  check("the notification is gone, the job's money still held: TRUE", (await cond(tf.id)) === true, String(await cond(tf.id)));
  await q(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${J}'`);

  // A group job released before every roster member was paid is still owed.
  const JG = "eeeeeeee-0000-4000-8000-000000000008";
  await q(`INSERT INTO public.jobs (id, is_seed, customer_id, payment_status, status, is_group_job)
           VALUES ('${JG}', false, '${U}', 'released', 'completed', true)`);
  await q(`INSERT INTO public.group_job_helpers VALUES ('${JG}', '${U2}'), ('${JG}', '${ADMIN}')`);
  await q(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JG}', '${U2}', 'paid')`);
  await notify("Scheduled payout failed", `/admin?view=jobs&job=${JG}`, JG);
  await post("Scheduled payout failed", `/admin?view=jobs&job=${JG}`);
  const sp = await item("Scheduled payout failed");
  check("group job 'released' with a roster member unpaid: TRUE", (await cond(sp.id)) === true, String(await cond(sp.id)));
  await q(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JG}', '${ADMIN}', 'failed')`);
  check("a FAILED transfer row does not count as paid: TRUE", (await cond(sp.id)) === true);
  await q(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JG}', '${ADMIN}', 'paid')`);
  check("every roster member paid: FALSE", (await cond(sp.id)) === false, String(await cond(sp.id)));
}

// ── arrival-unconfirmed ────────────────────────────────────────────────────
{
  await q(`UPDATE public.jobs SET status = 'in_progress', helper_arrived_at = now() - interval '25 hours',
             poster_confirmed_arrival_at = NULL WHERE id = '${J}'`);
  await notify("Arrival not confirmed in 24h", `/admin?view=jobs&job=${J}`, J);
  await post("Arrival not confirmed in 24h", `/admin?view=jobs&job=${J}`);
  const it = await item("Arrival not confirmed in 24h");
  check("arrival: new post is sql_condition", it?.verify_kind === "sql_condition", it?.verify_kind);
  check("arrival unconfirmed: TRUE", (await cond(it.id)) === true);
  await q(`UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${J}'`);
  check("poster confirmed: FALSE", (await cond(it.id)) === false);
  await q(`UPDATE public.jobs SET poster_confirmed_arrival_at = NULL, status = 'disputed' WHERE id = '${J}'`);
  check("job moved on (disputed): FALSE", (await cond(it.id)) === false);
  await post("Arrival near a wrong pin not confirmed", `/admin?view=jobs&job=${J}`);
  check("near-miss title shares the rule", (await item("Arrival near a wrong pin not confirmed"))?.verify_kind === "sql_condition");
}

// ── restriction-review / repeat-offender / low-rating ─────────────────────
{
  await q(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '7 days' WHERE user_id = '${U}'`);
  await notify("Auto-restricted (7d): Some Name", `/admin?view=people&user=${U}`, null, "now() - interval '1 hour'");
  await post("Auto-restricted (7d): Some Name", `/admin?view=people&user=${U}`, "now() - interval '1 hour'");
  const r = await item("Auto-restricted (7d): Some Name");
  check("auto-restricted: sql_condition", r?.verify_kind === "sql_condition", r?.verify_kind);
  check("suspended, nobody reviewed: TRUE", (await cond(r.id)) === true);
  await q(`INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, created_at)
           VALUES ('${ADMIN}', 'set_ban_status', 'user', '${U}', now() - interval '2 hours')`);
  check("an admin action from BEFORE the alert does not count: TRUE", (await cond(r.id)) === true);
  await q(`UPDATE public.profiles SET auto_suspended_until = now() - interval '1 minute' WHERE user_id = '${U}'`);
  check("suspension ran out: FALSE", (await cond(r.id)) === false);
  await q(`UPDATE public.profiles SET auto_suspended_until = now() + interval '7 days' WHERE user_id = '${U}'`);
  await q(`INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id)
           VALUES ('${ADMIN}', 'admin_note_add', 'user', '${U}'), ('${ADMIN}', 'impersonate_user_start', 'user', '${U}')`);
  check("a note or an impersonation after the alert is not a decision: TRUE", (await cond(r.id)) === true);
  await q(`INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id)
           VALUES ('${ADMIN}', 'set_ban_status', 'user', '${U}')`);
  check("a moderation decision on the person after the alert: FALSE", (await cond(r.id)) === false);
  // Restricted again after that decision: the new alert re-opens the question.
  await notify("Auto-restricted (7d): Some Name", `/admin?view=people&user=${U}`, null, "now() + interval '1 second'");
  check("a new alert after the decision: TRUE again", (await cond(r.id)) === true, String(await cond(r.id)));
  await q(`INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, created_at)
           VALUES ('${ADMIN}', 'reverse_auto_ban', 'profile', '${U}', now() + interval '2 seconds')`);
  check("…and a decision after it clears it: FALSE", (await cond(r.id)) === false);

  await notify("Repeat offender: Other Name", `/admin?view=people&user=${U2}`);
  await post("Repeat offender: Other Name", `/admin?view=people&user=${U2}`);
  const o = await item("Repeat offender: Other Name");
  check("repeat offender, no decision yet: TRUE", (await cond(o.id)) === true);
  await q(`UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = '${U2}'`);
  check("banned: FALSE", (await cond(o.id)) === false);

  await q(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ('${U2}', 'low_ratings', 'warning')`);
  await q(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${U2}'`);
  await notify("Low rating alert", `/admin?view=fraud&user=${U2}`);
  await post("Low rating alert", `/admin?view=fraud&user=${U2}`);
  const l = await item("Low rating alert");
  check("low rating flagged, unreviewed: TRUE", (await cond(l.id)) === true);
  await q(`DELETE FROM public.user_violations WHERE user_id = '${U2}' AND violation_type = 'low_ratings'`);
  check("violation reversed (deleted): FALSE", (await cond(l.id)) === false);
}

// ── notices close; a post naming no subject cannot tell ────────────────────
{
  await post("New member joined", `/admin?view=people&user=${U}`);
  const n = await item("New member joined");
  check("notice: sql_condition", n?.verify_kind === "sql_condition", n?.verify_kind);
  await verify();
  const n2 = await item("New member joined");
  check("notice closes on the next verify", n2.status === "closed", n2.status);
  await post("Dispute auto-resolved", `/admin?view=jobs&job=${J}`);
  check("dispute auto-resolved is a notice: FALSE", (await cond((await item("Dispute auto-resolved")).id)) === false);
  // No named job and no remembered subject at all (rolled back): cannot tell.
  await q("BEGIN");
  await q(`DO $$ BEGIN
             IF to_regclass('public.ops_alert_admin_subjects') IS NOT NULL THEN DELETE FROM public.ops_alert_admin_subjects; END IF;
           END $$`);
  const [{ c }] = await q(`SELECT public.admin_queue_still_pending('money-held', '{}'::jsonb, now()) c`);
  await q("ROLLBACK");
  check("money rule with no subject at all: NULL (cannot tell)", c === null, String(c));
  // A notification AFTER the item's last post still counts (an admin with a
  // push token gets no Slack post, so no new occurrence is recorded).
  await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J2}'`);
  await notify("Transfer failed", `/admin?view=jobs&job=${J2}`, J2, "now() + interval '1 minute'");
  const [{ late }] = await q(`SELECT public.admin_queue_still_pending('money-held', '{}'::jsonb, now()) late`);
  check("a notification newer than the last post still holds it open: TRUE", late === true, String(late));
  await q(`UPDATE public.jobs SET payment_status = 'released' WHERE id = '${J2}'`);
}

// ── manual ─────────────────────────────────────────────────────────────────
{
  const m = await item("Cancellation fee transfer failed");
  check("existing cancellation-fee item re-pointed to manual", m?.verify_kind === "manual", m?.verify_kind);
  await q(`DELETE FROM public.ops_alert_ledger WHERE id = '${m.id}'`);
  await post("Cancellation fee transfer failed", `/admin?view=jobs&job=${J2}`);
  const m2 = await item("Cancellation fee transfer failed");
  check("a NEW cancellation-fee item is labelled manual (trigger)", m2?.verify_kind === "manual", m2?.verify_kind);
  await verify();
  check("verify never closes a manual item", (await item("Cancellation fee transfer failed")).status !== "closed");
  const [{ ok }] = await q(`SELECT public.ops_alert_close($1, 'Stripe transfer tr_x paid the fee by hand', now()) ok`, [m2.id]);
  check("ops_alert_close closes it with evidence", ok === true);
  await post("Notification email refused: the seed-boundary check is failing", "");
  check("an unrelated custom post is still companions", (await item("Notification email refused: the seed-boundary check is failing"))?.verify_kind === "companions");
}

// ── the part-one rules are untouched ─────────────────────────────────────────────────
{
  await q(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ('${U}', 'x', 'pending_ban_review')`);
  const [{ b }] = await q(`SELECT public.admin_queue_still_pending('ban-review', '{}'::jsonb, now()) b`);
  check("the part-one ban-review rule still answers", b === true);
  const [{ r }] = await q(`SELECT public.admin_alert_close_rule('Ban review needed') r`);
  check("the part-one rule table is kept", r === "ban-review");
}

const FNS = [
  "public.admin_alert_subjects(text,jsonb,timestamptz)",
  "public.admin_alert_close_rule(text)",
  "public.admin_alert_manual_close(text)",
  "public.admin_queue_still_pending(text,jsonb,timestamptz)",
  "public.ops_alert_ledger_admin_manual()",
  "public.ops_alert_note_admin_subject()",
];
for (const fn of FNS) {
  let exists = true;
  try { await q(`SELECT $1::regprocedure`, [fn]); } catch { exists = false; }
  if (!exists) { check(`${fn} exists`, false); continue; }
  for (const role of ["anon", "authenticated"]) {
    const [{ ok }] = await q(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, fn]);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
}

const [{ t }] = await q(`SELECT to_regclass('public.ops_alert_admin_subjects') IS NOT NULL t`);
check("ops_alert_admin_subjects exists", t === true);
if (t) {
  const [{ n }] = await q(`SELECT count(*)::int n FROM public.ops_alert_admin_subjects
                            WHERE user_id = '99999999-0000-4000-8000-000000000099'`);
  check("the deleted account's old link was skipped by the backfill", n === 0, String(n));
}
if (t) {
  for (const role of ["anon", "authenticated"]) {
    const [{ ok }] = await q(`SELECT has_table_privilege($1, 'public.ops_alert_admin_subjects', 'SELECT') ok`, [role]);
    check(`${role} cannot read ops_alert_admin_subjects`, ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
