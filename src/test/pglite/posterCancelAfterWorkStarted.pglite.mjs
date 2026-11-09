#!/usr/bin/env node
/**
 * PGlite proof for 20261108200000_poster_cancel_refused_once_work_started (Jobs audit 11-08 #1 High, #5 Medium).
 *
 *   node src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs # RED (20261102074317's cancel)
 *   MUTANT=<name> node src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs      # a planted defect: must FAIL
 *
 * Fixture: cancelFeeWaivedPayeeUnderReview.pglite.mjs's schema and stubs (cancellation_fee_percent 50% after the start),
 * plus jobs.poster_confirmed_arrival_at and job_continue_days. Base: 20261031220849, 20261102070622, 20261102074317.
 * Checks:
 *   W1 a single job in progress with the Helpr on site: refused work_started, the job untouched, nobody told
 *      (RED before: cancelled, the poster got half the budget back for worked-on work)
 *   W1b auto-started in progress, nobody on site: still cancels (in_progress alone is not work)
 *   W1c tracker 'working': refused    W1d being fixed: refused    W4b a frozen Helpr who never came: free cancel kept
 *   B1 a poster's block mid-job: block stands, job untouched, admins alerted once   B2/B3 controls: a block still settles
 *   W2 accepted but the Helpr arrived (stamp kept): refused
 *   W3 accepted, only the poster confirmed the arrival: NOT work (the poster can write that stamp, Q423): cancels
 *   W4 in progress on an agreed continue day (done cleared): refused
 *   W5 crew in progress with a member still on it: refused         W6 crew in progress, roster empty: cancels, fee 0
 *   W7 control: accepted, nobody set out, 30 h out: cancels with no fee (unchanged)
 *   W8 #5: the Helpr's no-money "Job cancelled" is a job update carrying its job (was 'warning', no job_id)
 *   W9 #5: sms_kind_for reads the new types as it read 'warning'; the last chance notice is 'work_status'
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(DIR + f, "utf8");
const BASE = "20261102074317_cancel_fee_waived_payee_under_review.sql";
const THIS = "20261108200000_poster_cancel_refused_once_work_started.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // 'in_progress' alone counts as work again (the auto-started no-show job is refused).
  inProgressAlone: ["OR j.status::text = 'revision_requested'))", "OR j.status::text IN ('revision_requested', 'in_progress')))"],
  // An arrival stamp no longer counts.
  arrived: ["(j.helper_arrived_at IS NOT NULL OR j.status::text", "(false OR j.status::text"],
  // The poster's own (poster-writable) confirm of the arrival counts as work again (Q423).
  posterConfirmed: ["(j.helper_arrived_at IS NOT NULL OR j.status::text", "(j.helper_arrived_at IS NOT NULL OR j.poster_confirmed_arrival_at IS NOT NULL OR j.status::text"],
  // The tracker no longer counts.
  tracking: ["WHERE t.job_id = p_job_id AND t.status IN ('arrived', 'working', 'done'))", "WHERE false)"],
  // An agreed continue day no longer counts.
  continueDay: ["WHERE c.job_id = p_job_id AND c.status = 'set')", "WHERE false)"],
  // The crew rule is dropped.
  crew: ["         AND (g.helper_arrived_at IS NOT NULL OR v_job.status::text", "         AND false AND (g.helper_arrived_at IS NOT NULL OR v_job.status::text"],
  // The empty-roster crew exit is closed (the single-job rule applied to every crew, with in_progress as work).
  crewEmpty: ["  IF v_job.is_group_job IS NOT TRUE AND public.job_work_started(v_job.id) THEN", "  IF public.job_work_started(v_job.id) OR v_job.status::text = 'in_progress' THEN"],
  // A block settles a worked-on job again.
  block: ["    IF public.job_work_started(v_job.id) THEN\n      INSERT INTO public.notifications", "    IF false THEN\n      INSERT INTO public.notifications"],
  // The no-money notice is a System alert again.
  noticeType: ["CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'job_updates' END,\n      '/jobs?job=' || v_job.id::text,\n      v_job.id", "CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'warning' END,\n      '/jobs?job=' || v_job.id::text,\n      v_job.id"],
  // The SMS kind is lost for the retyped cancel.
  sms: ["WHEN p_type IN ('payment', 'warning', 'job_updates') AND p_title IN ('Job cancelled'", "WHEN p_type IN ('payment', 'warning') AND p_title IN ('Job cancelled'"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < BASE).sort();

const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
function cut(name) {
  const file = FILES.filter((f) => defRe(name).test(mig(f))).at(-1);
  if (!file) throw new Error(`${name}: no definition before ${BASE}`);
  const sql = mig(file);
  const m = [...sql.matchAll(defRe(name))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], start);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, HELPR, MEMBER1, MEMBER2] = [1, 2, 3, 4].map(id);
const JOB = id(11);
const CREW = id(12);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','revision_requested','completed','cancelled','disputed','pending_approval');
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
INSERT INTO public.feature_switches VALUES ('identity_check','off',''),('payout_after_hire','off',''),('payout_setup','everyone','');
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, idv_status text,
  stripe_identity_verified boolean NOT NULL DEFAULT false, stripe_account_id text, stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  idv_attempt_count int NOT NULL DEFAULT 0, idv_attempted_at timestamptz, ban_status text);
CREATE TABLE public.helper_verifications (user_id uuid, field text, old_value text, new_value text, changed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, opener_id uuid, reason text, evidence_urls text[]);
CREATE TABLE public.job_tracking (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, latitude numeric, longitude numeric,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, user_id uuid, violation_type text, reported_by uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, budget numeric, date_needed date, start_time time, customer_id uuid, helper_id uuid,
  status public.job_status, helper_fee_percent numeric, helper_fee_flat_cents int, helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  helper_completed_at timestamptz, is_group_job boolean DEFAULT false, helpers_needed int, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  helper_arrival_near_miss_at timestamptz, payment_status text, stripe_session_id text, stripe_payment_intent_id text, accepted_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text,
  require_photo_proof boolean, response_deadline timestamptz, dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz,
  start_reminder_sent_at timestamptz, revision_requested_at timestamptz, revision_note text, revision_deadline timestamptz,
  proof_before_urls text[], proof_after_urls text[], parent_job_id uuid, recurrence_days int[], offered_to_helper_id uuid, direct_offer_status text,
  direct_offer_expires_at timestamptz, is_seed boolean DEFAULT false, disputed_by uuid, disputed_at timestamptz, dispute_reason text, dispute_status text,
  poster_confirmed_arrival_at timestamptz);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, new_date date, new_start_time time);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, PRIMARY KEY (blocker_id, blocked_id));
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, joined_at timestamptz, share_cents bigint, slot_no int,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_completed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_arrival_near_miss_ft numeric, poster_confirmed_arrival_at timestamptz,
  poster_confirmed_working_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[], response_deadline timestamptz);
CREATE TABLE public.crew_cancellation_fee_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, committed boolean,
  share_basis_cents bigint, fee_percent int, share_amount numeric, UNIQUE (job_id, helper_id));
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, stripe_transfer_id text, status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.payout_setup_reminders (helper_id uuid, reminder_key text, reminder_stage text, job_id uuid, claimed_at timestamptz DEFAULT now(), sent_at timestamptz, PRIMARY KEY (helper_id, reminder_key));
CREATE TABLE public.notification_preferences (user_id uuid, remind_payout_followups boolean);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid);
CREATE TABLE public.declutter_cart_items (buyer_id uuid);
CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, payee_id uuid, category text, paged_category text,
  first_waiting_at timestamptz DEFAULT now(), last_checked_at timestamptz, last_reason text, last_reminded_at timestamptz, ops_paged_at timestamptz, PRIMARY KEY (payout_kind, payout_id));
CREATE TABLE public.payout_payee_reminders (payee_id uuid PRIMARY KEY, last_reminded_at timestamptz);
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY);
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  review_state text NOT NULL DEFAULT 'open' CHECK (review_state IN ('open', 'confirmed', 'lifted')));
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
-- The live UPDATE policies: whole-row, which is why the column locks are triggers.
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE USING (auth.uid() = helper_id);
ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.group_job_helpers FOR SELECT USING (true);
CREATE POLICY "Job owner can update group helpers" ON public.group_job_helpers FOR UPDATE
  USING ((SELECT auth.uid()) IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id))
  WITH CHECK ((SELECT auth.uid()) IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id));
CREATE FUNCTION public.declutter_identity_before_buy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_declutter_cart_identity_before_buy BEFORE INSERT ON public.declutter_cart_items FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ($1, $3, $4, $2, $5) $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_v boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_v IS NOT NULL $$;
CREATE FUNCTION public.is_identity_verified(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT public.feature_enabled_for_user('identity_check', p_user_id) $$;
CREATE FUNCTION public.job_hours_until_start(d date, t time, n timestamptz) RETURNS numeric LANGUAGE sql STABLE AS
  $$ SELECT extract(epoch FROM ((d + COALESCE(t, '00:00'::time))::timestamptz - n)) / 3600.0 $$;
CREATE FUNCTION public.cancellation_fee_percent(c boolean, h numeric) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN NOT c THEN 0 WHEN h < 2 THEN 50 WHEN h < 24 THEN 25 ELSE 0 END $$;
CREATE FUNCTION public.is_late_cancellation(c boolean, h numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT c AND h < 24 $$;
CREATE FUNCTION public.crew_fee_pays_unconfirmed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.crew_slot_share_cents(b bigint, n int, i int) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT b / n $$;
CREATE FUNCTION public.helpr_flat_fee_cents(a numeric, p numeric, f int) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT round(a * COALESCE(p, 5) / 100.0) + COALESCE(f, 70) $$;
CREATE TABLE public.strikes (job_id uuid);
GRANT INSERT, SELECT ON public.strikes TO authenticated;
CREATE FUNCTION public.apply_cancellation_violation_consequence(p uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO public.strikes VALUES ($1) RETURNING jsonb_build_object('action','strike','prior_count',0) $$;
CREATE FUNCTION public.apply_job_denial_consequence(u uuid, j uuid, d text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action','record') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_violations (user_id, violation_type, job_id) VALUES (p_user, p_violation_type, p_job_id);
  RETURN jsonb_build_object('action', 'warning', 'prior_count', p_prior_count);
END $$;
CREATE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT s = 'escrow' $$;
CREATE FUNCTION public.payout_waits_on_identity(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
for (const fn of ["is_server_context", "job_posted_by_seed", "ban_settlement_action", "helpr_payout_round_down_cents",
  "settle_one_off_jobs_for_banned_account", "enforce_group_member_lifecycle_server_owned"]) await db.exec(cut(fn));
await db.exec(mig("20261031220849_id_check_asked_when_hired_restated.sql"));
await db.exec(mig("20261102070622_late_cancel_notice_whole_dollars.sql"));
await db.exec(mig(BASE));
// The live block_user_and_settle (20261102131745), so NEW_MIGRATION=skip is the live state for B1-B3.
{
  const f = mig("20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql");
  const at = f.indexOf("CREATE OR REPLACE FUNCTION public.block_user_and_settle(");
  const open = /\bAS\s+(\$\w*\$)/i.exec(f.slice(at));
  const start = at + open.index + open[0].length;
  await db.exec(f.slice(at, f.indexOf(open[1], start) + open[1].length) + ";");
}
if (!skip) {
  let sql = mig(THIS);
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: 20261102074317's poster_cancel_job");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed++;
};
const rows = async (q) => (await db.query(q)).rows;
const as = async (uid, q) => {
  await db.exec(`SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${uid}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
};
await db.exec(`INSERT INTO public.profiles (user_id, idv_status, stripe_identity_verified) VALUES
  ('${POSTER}','verified',true), ('${HELPR}','verified',true), ('${MEMBER1}','verified',true), ('${MEMBER2}','verified',true);`);

/** A funded, hired, confirmed $100 solo job whose start was `startOffset` from now, in `status`, with `extra` set. */
const solo = (status, startOffset, extra = "", confirmed = true) => db.exec(`
  DELETE FROM public.notifications; DELETE FROM public.strikes; DELETE FROM public.job_cancel_id_waivers; DELETE FROM public.job_continue_days;
  DELETE FROM public.jobs WHERE id = '${JOB}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, helper_id, status, helper_confirmed_at,
                           payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents)
  VALUES ('${JOB}', 'Yard', 100, (now() + interval '${startOffset}')::date, (now() + interval '${startOffset}')::time, '${POSTER}', '${HELPR}', '${status}',
          ${confirmed ? "now() - interval '2 days'" : "NULL"}, 'escrow', 'cs_x', 5, 70);
  ${extra}`);
const crew = (status, roster) => db.exec(`
  DELETE FROM public.notifications; DELETE FROM public.group_job_helpers; DELETE FROM public.crew_cancellation_fee_shares; DELETE FROM public.jobs WHERE id='${CREW}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, status, payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents, is_group_job, helpers_needed)
    VALUES ('${CREW}', 'Crew', 200, (now() - interval '3 hours')::date, (now() - interval '3 hours')::time, '${POSTER}', '${status}', 'escrow', 'cs_c', 5, 70, true, 2);
  ${roster ? `INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, share_cents, helper_confirmed_at, helper_on_the_way_at) VALUES
    ('${CREW}', '${MEMBER1}', now(), 10000, now() - interval '1 day', now() - interval '4 hours');` : ""}`);
const cancel = (job) => as(POSTER, `SELECT public.poster_cancel_job('${job}') AS r`);
const job = async (j = JOB) => (await rows(`SELECT status::text AS status, cancellation_fee FROM public.jobs WHERE id = '${j}'`))[0];
const notices = async () => Number((await rows(`SELECT count(*) AS n FROM public.notifications`))[0].n);
const refusedStarted = (r) => r.error != null && /work_started/.test(r.error);

const ADMIN = id(9);
await db.exec(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');`);
const tracking = (status) => `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${JOB}', '${HELPR}', '${status}');`;

// W1: in progress, the Helpr arrived 3 h ago and is working, not marked done.
await solo("in_progress", "-3 hours", `UPDATE public.jobs SET helper_on_the_way_at = now() - interval '4 hours', helper_arrived_at = now() - interval '3 hours' WHERE id = '${JOB}';`);
const w1 = await cancel(JOB);
const j1 = await job();
ok("W1 in progress with the Helpr on site: refused work_started", refusedStarted(w1), JSON.stringify({ w1, j1 }));
ok("W1 the job is untouched and nobody is told", j1.status === "in_progress" && j1.cancellation_fee == null && (await notices()) === 0, JSON.stringify(j1));

// W1b: auto-started at the start time with nobody on site (auto_start_due_jobs): NOT work, the cancel still runs.
await solo("in_progress", "-1 hours", `DELETE FROM public.job_tracking;`);
const w1b = await cancel(JOB);
const j1b = await job();
ok("W1b in progress with no arrival or tracker step (auto-started): cancels on the ladder (50%)", w1b.error == null && j1b.status === "cancelled" && Number(j1b.cancellation_fee) === 50, JSON.stringify({ w1b, j1b }));

// W1c: the tracker says working (no arrival stamp).
await solo("in_progress", "-1 hours", `DELETE FROM public.job_tracking; ${tracking("working")}`);
const w1c = await cancel(JOB);
ok("W1c the tracker says working: refused work_started", refusedStarted(w1c), JSON.stringify(w1c));
await db.exec(`DELETE FROM public.job_tracking`);

// W1d: being fixed.
await solo("revision_requested", "-1 days");
ok("W1d being fixed (revision_requested): refused work_started", refusedStarted(await cancel(JOB)));

// W2: still 'accepted' but the arrival stamp is set.
await solo("accepted", "-1 hours", `UPDATE public.jobs SET helper_arrived_at = now() - interval '1 hour' WHERE id = '${JOB}';`);
const w2 = await cancel(JOB);
ok("W2 accepted with the Helpr's arrival stamped: refused work_started", refusedStarted(w2) && (await job()).status === "accepted", JSON.stringify(w2));

// W3: only the poster confirmed the arrival (no Helpr stamp). The poster can write that stamp, so it is not evidence
// (Q423): the cancel runs on the ladder as before.
await solo("accepted", "-1 hours", `UPDATE public.jobs SET poster_confirmed_arrival_at = now() - interval '50 minutes' WHERE id = '${JOB}';`);
const w3 = await cancel(JOB);
const j3 = await job();
ok("W3 accepted with only the poster's confirm of the arrival: not work, cancels on the ladder (50%)", w3.error == null && j3.status === "cancelled" && Number(j3.cancellation_fee) === 50, JSON.stringify({ w3, j3 }));

// W4: a continue day agreed (the done cleared; this fixture's day-1 stamps omitted to isolate the rule).
await solo("in_progress", "-7 days", `INSERT INTO public.job_continue_days (job_id, status, new_date, new_start_time) VALUES ('${JOB}', 'set', current_date - 2, '15:15');`);
const w4 = await cancel(JOB);
ok("W4 in progress on an agreed continue day: refused work_started", refusedStarted(w4), JSON.stringify(w4));

// W4b: the frozen-payee free exit is kept for a no-arrival job: Helpr under a ban review, auto-started, never came.
await solo("in_progress", "-1 hours");
await db.exec(`INSERT INTO public.ban_settlement_queue (user_id) VALUES ('${HELPR}')`);
const w4b = await cancel(JOB);
const j4b = await job();
ok("W4b a frozen Helpr who never arrived: the cancel is free and strike-free", w4b.error == null && j4b.status === "cancelled" && Number(j4b.cancellation_fee) === 0 && w4b.rows[0]?.r?.late_cancellation === false, JSON.stringify({ w4b, j4b }));
await db.exec(`DELETE FROM public.ban_settlement_queue`);

// W5: a crew with a member on site.
await crew("in_progress", true);
await db.exec(`UPDATE public.group_job_helpers SET helper_arrived_at = now() - interval '2 hours' WHERE job_id = '${CREW}'`);
const w5 = await cancel(CREW);
ok("W5 crew with a member on site: refused work_started", refusedStarted(w5) && (await job(CREW)).status === "in_progress", JSON.stringify(w5));

// W5b: a crew in progress with a member set out but never arrived: not work, cancels on the ladder.
await crew("in_progress", true);
const w5b = await cancel(CREW);
ok("W5b crew in progress, nobody on site: cancels (the member's share priced)", w5b.error == null && (await job(CREW)).status === "cancelled", JSON.stringify(w5b));

// W6: a crew under way whose every member was reported a no-show (empty roster): the full-refund exit stays.
await crew("in_progress", false);
const w6 = await cancel(CREW);
const j6 = await job(CREW);
ok("W6 crew in progress with an empty roster: cancels, fee 0", w6.error == null && j6.status === "cancelled" && Number(j6.cancellation_fee) === 0, JSON.stringify({ w6, j6 }));

// B1-B3: block_user_and_settle.
const block = (who, whom) => as(who, `SELECT public.block_user_and_settle('${whom}') AS r`);
const blocks = async () => Number((await rows(`SELECT count(*) AS n FROM public.user_blocks`))[0].n);
const adminAlerts = async () => (await rows(`SELECT title FROM public.notifications WHERE user_id = '${ADMIN}'`)).map((r) => r.title);
await db.exec(`DELETE FROM public.user_blocks`);
await solo("in_progress", "-3 hours", `UPDATE public.jobs SET helper_arrived_at = now() - interval '3 hours' WHERE id = '${JOB}';`);
const b1 = await block(POSTER, HELPR);
const jb1 = await job();
ok("B1 a poster who blocks the Helpr mid-job: the block stands, the job is not cancelled or priced", b1.error == null && (await blocks()) === 1 && jb1.status === "in_progress" && jb1.cancellation_fee == null, JSON.stringify({ b1, jb1 }));
ok("B1 the admins decide: one alert, and the answer says admin_review", JSON.stringify(await adminAlerts()) === JSON.stringify(["Block on a started job"]) && b1.rows[0]?.r?.settled?.[0]?.action === "admin_review", JSON.stringify({ a: await adminAlerts(), b1 }));
const b1again = await block(POSTER, HELPR);
ok("B1 blocking again does not re-alert", b1again.error == null && (await adminAlerts()).length === 1);
await db.exec(`DELETE FROM public.user_blocks`);
await solo("accepted", "30 hours");
const b2 = await block(POSTER, HELPR);
ok("B2 control: a block before any work still settles (cancelled, no fee 30 h out)", b2.error == null && (await job()).status === "cancelled", JSON.stringify(b2));
await db.exec(`DELETE FROM public.user_blocks`);
await solo("in_progress", "-1 hours");
const b3 = await block(POSTER, HELPR);
ok("B3 an auto-started job nobody came to still settles on the block", b3.error == null && (await job()).status === "cancelled", JSON.stringify(b3));

// W7: control, accepted 30 h out, nobody set out: cancels, no fee.
await solo("accepted", "30 hours");
const w7 = await cancel(JOB);
const j7 = await job();
ok("W7 control: accepted 30 h out cancels with no fee", w7.error == null && j7.status === "cancelled" && Number(j7.cancellation_fee) === 0, JSON.stringify({ w7, j7 }));

// W8: that cancel's notice to the Helpr (no money) is a job update and carries the job.
const n8 = await rows(`SELECT title, type, job_id FROM public.notifications WHERE user_id = '${HELPR}'`);
ok("W8 the Helpr's no-money 'Job cancelled' is job_updates with its job_id", n8.length === 1 && n8[0].title === "Job cancelled" && n8[0].type === "job_updates" && n8[0].job_id === JOB, JSON.stringify(n8));

// W9: the SMS kinds and the last-chance type.
if (!skip) {
  const k = (await rows(`SELECT public.sms_kind_for('job_updates', 'Job cancelled', '${JOB}') AS a, public.sms_kind_for('warning', 'Job cancelled', '${JOB}') AS b,
    public.sms_kind_for('work_status', 'Please review the work', '${JOB}') AS c, public.sms_kind_for('warning', 'Please review the work', '${JOB}') AS d`))[0];
  ok("W9 sms_kind_for: the retyped cancel still texts as job_cancelled, the last chance as needs_you", k.a === "job_cancelled" && k.b === "job_cancelled" && k.c === "needs_you" && k.d === "needs_you", JSON.stringify(k));
  const lc = (await rows(`SELECT prosrc FROM pg_proc WHERE proname = 'sweep_release_last_chance'`))[0].prosrc;
  ok("W9 sweep_release_last_chance files 'Please review the work' as work_status", /rec\.customer_id,\s*'work_status',\s*'Please review the work'/.test(lc));
  const g = (await rows(`SELECT has_function_privilege('anon', 'public.poster_cancel_job(uuid, text, bigint)', 'EXECUTE') AS pa,
    has_function_privilege('authenticated', 'public.poster_cancel_job(uuid, text, bigint)', 'EXECUTE') AS pu,
    has_function_privilege('authenticated', 'public.sweep_release_last_chance()', 'EXECUTE') AS su,
    has_function_privilege('authenticated', 'public.sms_kind_for(text, text, uuid)', 'EXECUTE') AS ku`))[0];
  ok("W9 grants: poster_cancel_job members only; the sweep and sms_kind_for service_role only", !g.pa && g.pu && !g.su && !g.ku, JSON.stringify(g));
}

console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
