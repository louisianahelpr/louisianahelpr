#!/usr/bin/env node
/**
 * PGlite proof for 20261031221529_poster_cannot_clear_on_the_way_restated (Builder 49s 20261031051339 rebuilt).
 *
 * poster_cancel_job's no-fee ID cancel (owner 2026-10-30) depends on
 * helper_on_the_way_at IS NULL. Before this migration a poster could clear that
 * stamp with a plain PATCH on their own job, then cancel for free: the Helpr who
 * had already left lost their fee, and the poster took no strike.
 *
 *   node src/test/pglite/posterCannotClearOnTheWay.pglite.mjs                  # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/posterCannotClearOnTheWay.pglite.mjs  # RED (the live lock)
 *   MIGRATION_PATH=<mutated copy> node ...                                     # a mutated lock
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Real text, cut from the newest migration: the poster lock (before: its newest
 * text before this migration, md5-matched to prod 2026-10-31), poster_cancel_job,
 * payout_waits_on_identity, is_server_context, helper_mark_on_the_way,
 * helper_abort_job, settle_one_off_jobs_for_banned_account, ban_settlement_action,
 * report_helper_no_show, job_posted_by_seed, the roster's lifecycle lock.
 * Real roles and the live UPDATE policies. Not the whole trigger chain: the other
 * BEFORE triggers on jobs are not loaded, so this proves what the poster lock and
 * the roster lock do, not what a sibling trigger might add.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261031221529_poster_cannot_clear_on_the_way_restated.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();

const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
function cut(name) {
  const file = FILES.filter((f) => defRe(name).test(mig(f))).at(-1);
  if (!file) throw new Error(`${name}: no definition before ${THIS}`);
  const sql = mig(file);
  const m = [...sql.matchAll(defRe(name))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], start);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, UNVERIFIED, VERIFIED, MEMBER2] = [1, 2, 3, 4].map(id);
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
  direct_offer_expires_at timestamptz, is_seed boolean DEFAULT false, disputed_by uuid, disputed_at timestamptz, dispute_reason text, dispute_status text);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, joined_at timestamptz, share_cents bigint,
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
await db.exec(cut("is_server_context"));
await db.exec(cut("job_posted_by_seed"));
await db.exec(cut("ban_settlement_action"));
await db.exec(cut("helper_mark_on_the_way"));
await db.exec(cut("helper_abort_job"));
await db.exec(cut("report_helper_no_show"));
await db.exec(cut("settle_one_off_jobs_for_banned_account"));
await db.exec(cut("enforce_group_member_lifecycle_server_owned"));
await db.exec(`CREATE TRIGGER zza_group_member_lifecycle_server_owned BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_lifecycle_server_owned();`);
// The ID migration, verbatim: poster_cancel_job and payout_waits_on_identity as they ship.
await db.exec(mig("20261031220849_id_check_asked_when_hired_restated.sql"));
// The poster lock as prod holds it (md5 of the whitespace-normalised body 6c5cd5c1ce68339437e6c01d7918cc58).
await db.exec(cut("enforce_poster_jobs_money_lock"));
await db.exec(`CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_jobs_money_lock();`);

if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the live lock");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const one = async (q) => (await db.query(q)).rows[0];
/** Runs as a signed-in member, the way PostgREST does. Returns the error text, or null. */
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
const refused = (r, col) => r.error !== null && new RegExp(`Posters may not modify jobs\\.${col}`).test(r.error);
const flag = (v) => db.exec(`SELECT set_config('app.trusted_ladder_write', '${v}', false)`);

await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, stripe_identity_verified) VALUES
  ('${POSTER}','verified',true), ('${UNVERIFIED}','not_started',false), ('${VERIFIED}','verified',true), ('${MEMBER2}','verified',true);
UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'identity_check';`);

/** A funded, hired, confirmed job `hours` out. */
const seed = async ({ helper = UNVERIFIED, hours = 5, otw = "now() - interval '10 minutes'", status = "accepted", arrived = "NULL", pay = "escrow" } = {}) => db.exec(`
  DELETE FROM public.strikes; DELETE FROM public.notifications; DELETE FROM public.job_cancel_id_waivers;
  DELETE FROM public.applications; DELETE FROM public.user_violations; DELETE FROM public.jobs WHERE id = '${JOB}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, helper_id, status, helper_confirmed_at, helper_dayof_confirmed_at,
                           helper_on_the_way_at, helper_arrived_at, payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents)
  VALUES ('${JOB}', 'Yard', 100, (now() + interval '${hours} hours')::date, (now() + interval '${hours} hours')::time, '${POSTER}', '${helper}', '${status}',
          now() - interval '1 day', now() - interval '1 hour', ${otw}, ${arrived}, '${pay}', 'cs_x', 5, 70);
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${JOB}', '${helper}', 'accepted');`);
const row = () => one(`SELECT helper_on_the_way_at IS NOT NULL AS otw, helper_id, status::text AS status, cancellation_fee::numeric AS fee FROM public.jobs WHERE id='${JOB}'`);
const cancel = () => as(POSTER, `SELECT public.poster_cancel_job('${JOB}') AS r`);
const strikes = async () => (await one(`SELECT count(*)::int AS c FROM public.strikes WHERE job_id='${JOB}'`)).c;
const waivers = async () => (await one(`SELECT count(*)::int AS c FROM public.job_cancel_id_waivers WHERE job_id='${JOB}'`)).c;

// ── The attack ─────────────────────────────────────────────────────────────
await seed();
const honest = await cancel();
ok("baseline: an unverified Helpr already on the way keeps the 25% fee, and the poster takes a strike",
  Number(honest.rows[0]?.r?.cancellation_fee) === 25 && (await strikes()) === 1, JSON.stringify(honest));

await seed();
const clear = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = NULL WHERE id='${JOB}' RETURNING id`);
ok("a poster's direct clear of helper_on_the_way_at is refused", refused(clear, "helper_on_the_way_at"), JSON.stringify(clear));
ok("the stamp is still there", (await row()).otw === true);
const after = await cancel();
ok("so the cancel still pays the Helpr's 25%", Number(after.rows[0]?.r?.cancellation_fee) === 25, JSON.stringify(after));
ok("and the poster still takes the strike", (await strikes()) === 1);
ok("and no ID waiver is recorded", (await waivers()) === 0);

await seed({ otw: "NULL", helper: VERIFIED });
const forge = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = now() WHERE id='${JOB}' RETURNING id`);
ok("a poster cannot forge the stamp either", refused(forge, "helper_on_the_way_at"), JSON.stringify(forge));
await seed();
const move = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = now() - interval '9 days' WHERE id='${JOB}' RETURNING id`);
ok("a poster cannot move the stamp", refused(move, "helper_on_the_way_at"), JSON.stringify(move));

// ── The carve-out stays narrow ─────────────────────────────────────────────
await seed();
await flag("on");
const keepHelper = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = NULL WHERE id='${JOB}' RETURNING id`);
ok("with the flag up, a clear that keeps the Helpr is still refused", refused(keepHelper, "helper_on_the_way_at"), JSON.stringify(keepHelper));
const rewrite = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = now() - interval '9 days', helper_id = NULL WHERE id='${JOB}' RETURNING id`);
ok("with the flag up, a rewrite to a new time is still refused", refused(rewrite, "helper_on_the_way_at"), JSON.stringify(rewrite));
await flag("off");
const noFlag = await as(POSTER, `UPDATE public.jobs SET helper_on_the_way_at = NULL, helper_id = NULL WHERE id='${JOB}' RETURNING id`);
ok("with no flag, a clear alongside the unassign is refused", noFlag.error !== null, JSON.stringify(noFlag));

// ── The other inputs of the no-fee branch ──────────────────────────────────
await seed({ arrived: "now()" });
for (const [col, set] of [["helper_arrived_at", "helper_arrived_at = NULL"], ["helper_confirmed_at", "helper_confirmed_at = NULL"]]) {
  const r = await as(POSTER, `UPDATE public.jobs SET ${set} WHERE id='${JOB}' RETURNING id`);
  ok(`${col}: a poster's clear is refused`, refused(r, col), JSON.stringify(r));
}
const unhire = await as(POSTER, `UPDATE public.jobs SET helper_id = NULL WHERE id='${JOB}' RETURNING id`);
ok("helper_id: a poster's clear on a funded job is refused", /jobs\.helper_id once checkout has opened/.test(unhire.error ?? ""), JSON.stringify(unhire));

// A crew: the same stamps, per member, on the roster row.
await db.exec(`
  DELETE FROM public.group_job_helpers; DELETE FROM public.crew_cancellation_fee_shares; DELETE FROM public.jobs WHERE id='${CREW}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, status, payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents, is_group_job, helpers_needed)
    VALUES ('${CREW}', 'Crew', 200, (now() + interval '5 hours')::date, (now() + interval '5 hours')::time, '${POSTER}', 'accepted', 'escrow', 'cs_c', 5, 70, true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, share_cents, helper_confirmed_at, helper_on_the_way_at) VALUES
    ('${CREW}', '${UNVERIFIED}', now(), 10000, now(), now()), ('${CREW}', '${MEMBER2}', now(), 10000, now(), now());`);
const roster = await as(POSTER, `UPDATE public.group_job_helpers SET helper_on_the_way_at = NULL WHERE job_id='${CREW}' AND helper_id='${UNVERIFIED}' RETURNING id`);
ok("crew: a poster's clear of a member's stamp is refused", /stamped by the server/.test(roster.error ?? ""), JSON.stringify(roster));
const rosterArrived = await as(POSTER, `UPDATE public.group_job_helpers SET helper_arrived_at = now() WHERE job_id='${CREW}' AND helper_id='${UNVERIFIED}' RETURNING id`);
ok("crew: a poster's write of a member's arrival is refused", /stamped by the server/.test(rosterArrived.error ?? ""), JSON.stringify(rosterArrived));
const crewCancel = await as(POSTER, `SELECT public.poster_cancel_job('${CREW}') AS r`);
ok("crew: the unverified member already on the way keeps their share", Number(crewCancel.rows[0]?.r?.cancellation_fee) === 50, JSON.stringify(crewCancel));

// ── Every path that legitimately writes it still works ─────────────────────
await seed({ helper: VERIFIED, otw: "NULL", hours: 1 });
const onWay = await as(VERIFIED, `SELECT public.helper_mark_on_the_way('${JOB}', 30.4, -91.1) AS t`);
ok("helper_mark_on_the_way: the Helpr stamps it", onWay.error === null && (await row()).otw === true, JSON.stringify(onWay));

await seed({ helper: VERIFIED, status: "in_progress" });
const abort = await as(VERIFIED, `SELECT public.helper_abort_job('${JOB}', 'Truck broke') AS r`);
const aborted = await row();
ok("helper_abort_job: the Helpr's reopen clears it", abort.error === null && aborted.otw === false && aborted.status === "open", JSON.stringify({ abort, aborted }));

// The ban settlement's reopen, running inside the POSTER's own request (the same
// way the confirmed-stamp carve-out of 20261003193541 exists for).
await seed({ helper: VERIFIED });
const settle = await as(POSTER, `SELECT public.settle_one_off_jobs_for_banned_account('${VERIFIED}') AS r`);
const settled = await row();
const action = settle.rows[0]?.r?.settled?.[0]?.action;
ok("settle_one_off_jobs_for_banned_account: reopen lands from the poster's request and clears it",
  action === "reopen" && settled.otw === false && settled.helper_id === null && settled.status === "open", JSON.stringify({ settle, settled }));

// Does not write the stamp (read live 2026-10-31), so the lock never meets it.
await seed({ helper: VERIFIED, hours: -3 });
const noShow = await as(POSTER, `SELECT public.report_helper_no_show('${JOB}') AS r`);
const reopened = await row();
ok("report_helper_no_show: a poster's no-show report still lands", noShow.error === null && reopened.helper_id === null && reopened.status === "open", JSON.stringify(noShow));
console.log(`note: after a no-show report helper_on_the_way_at is ${reopened.otw ? "STILL SET (not cleared by report_helper_no_show)" : "cleared"}`);

// The owner's rule itself.
await seed({ otw: "NULL" });
const waived = await cancel();
ok("the owner's rule stands: an unverified Helpr who has not left costs the poster nothing",
  Number(waived.rows[0]?.r?.cancellation_fee) === 0 && (await strikes()) === 0 && (await waivers()) === 1, JSON.stringify(waived));

// An ordinary poster edit is untouched, and the server is not a poster.
await db.exec(`DELETE FROM public.jobs WHERE id='${JOB}';
  INSERT INTO public.jobs (id, title, customer_id, status, payment_status) VALUES ('${JOB}', 'Old', '${POSTER}', 'open', 'unpaid');`);
const edit = await as(POSTER, `UPDATE public.jobs SET title = 'New' WHERE id='${JOB}' RETURNING id`);
ok("an ordinary poster edit lands", edit.error === null && edit.rows.length === 1, JSON.stringify(edit));
await seed();
await db.exec(`UPDATE public.jobs SET helper_on_the_way_at = NULL WHERE id='${JOB}'`);
ok("the server may still clear it", (await row()).otw === false);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
