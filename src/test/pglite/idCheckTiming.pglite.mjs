#!/usr/bin/env node
/**
 * PGlite proof for 20261031220849_id_check_asked_when_hired_restated: Builder 49's 20261030225327 rebuilt on main
 * (LEAD-B49-REBUILD, Builder 31, 10-31), poster_cancel_job re-read from main's newest 20261031015647
 * (owner 2026-10-30: the ID check stays, asked once per person).
 *
 *   node src/test/pglite/idCheckTiming.pglite.mjs                  # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/idCheckTiming.pglite.mjs  # RED (the old payout rule)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The migration's own statements run verbatim against stubs of what they read.
 * Proves, for an ordinary unverified member:
 *   - Switch OFF (prod today): no payout waits, a delivery is taken, a late cancel
 *     still pays the ladder's fee. Landing interrupts nobody.
 *   - Switch ON: a job payout claim is refused (payout_held) even with
 *     payout_after_hire OFF; a verified member and an enrolled test account are paid.
 *   - ON: taking a delivery is refused for an unverified member, never for a
 *     verified one; the cart no longer refuses, an order still does.
 *   - ON: a poster's cancel of an unverified hired Helpr records no fee and no
 *     strike, and the Helpr is told why; a Helpr already on the way keeps the fee;
 *     a verified Helpr keeps the fee.
 *   - ON: the poster notice goes once, inside 24 h only, never with a verified Helpr.
 *   - The attempt count resets for exactly the reset members at 3, and a replay
 *     resets nobody who has since tried again.
 *   - The Declutter wait: category 'identity' accepted, the payee told with the ID link.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261031220849_id_check_asked_when_hired_restated.sql"), "utf8");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, PLAIN, VERIFIED, TESTER, RESET3, RESET3_RETRIED, RESET1, OTHER3, RESET_TA] = [1, 2, 3, 4, 5, 6, 7, 8, 99].map(id);
const [JOB_LATE, JOB_VERIFIED, JOB_OTW, JOB_FAR, JOB_NOTICE, JOB_VFAR] = [11, 12, 13, 14, 15, 17].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
INSERT INTO public.feature_switches VALUES ('identity_check','off','old PayPal words'),('payout_after_hire','off',''),('payout_setup','everyone','');
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, idv_status text,
  stripe_identity_verified boolean NOT NULL DEFAULT false, stripe_account_id text, stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  idv_attempt_count int NOT NULL DEFAULT 0, idv_attempted_at timestamptz, ban_status text);
CREATE TABLE public.helper_verifications (user_id uuid, field text, old_value text, new_value text, changed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, budget numeric, date_needed date, start_time time, customer_id uuid, helper_id uuid,
  status public.job_status, helper_fee_percent numeric, helper_fee_flat_cents int, helper_confirmed_at timestamptz, helper_completed_at timestamptz,
  is_group_job boolean DEFAULT false, helpers_needed int, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  payment_status text, accepted_at timestamptz, cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, joined_at timestamptz, share_cents bigint,
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz);
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
CREATE FUNCTION public.declutter_identity_before_buy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identity_required_to_buy'; END $$;
CREATE TRIGGER trg_declutter_cart_identity_before_buy BEFORE INSERT ON public.declutter_cart_items FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ($1, $3, $4, $2, $5) $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_v boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_v IS NOT NULL $$;
CREATE FUNCTION public.is_identity_verified(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT public.feature_enabled_for_user('identity_check', p_user_id) OR COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
-- The live definition before this migration (pg_get_functiondef 2026-10-30).
CREATE FUNCTION public.payout_waits_on_identity(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_user_id IS NOT NULL AND public.feature_enabled_for_user('payout_after_hire', p_user_id) AND NOT public.identity_check_exempt(p_user_id)
       AND NOT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
-- The part of the live claim trigger this change relies on.
CREATE FUNCTION public.refuse_payout_claim_while_held() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.helper_id IS NOT NULL AND NEW.status = 'pending' AND NEW.stripe_transfer_id IS NULL AND public.payout_waits_on_identity(NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER refuse_payout_claim_while_held BEFORE INSERT ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION public.refuse_payout_claim_while_held();
CREATE FUNCTION public.job_hours_until_start(d date, t time, n timestamptz) RETURNS numeric LANGUAGE sql STABLE AS
  $$ SELECT extract(epoch FROM ((d + COALESCE(t, '00:00'::time))::timestamptz - n)) / 3600.0 $$;
-- The ladder, cent for cent the live shape: not committed is no fee.
CREATE FUNCTION public.cancellation_fee_percent(c boolean, h numeric) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN NOT c THEN 0 WHEN h < 2 THEN 50 WHEN h < 24 THEN 25 ELSE 0 END $$;
CREATE FUNCTION public.is_late_cancellation(c boolean, h numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT c AND h < 24 $$;
CREATE FUNCTION public.crew_fee_pays_unconfirmed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.crew_slot_share_cents(b bigint, n int, i int) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT b / n $$;
CREATE FUNCTION public.helpr_flat_fee_cents(a numeric, p numeric, f int) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT round(a * COALESCE(p, 5) / 100.0) + COALESCE(f, 70) $$;
CREATE TABLE public.strikes (job_id uuid);
CREATE FUNCTION public.apply_cancellation_violation_consequence(p uuid) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.strikes VALUES ($1) RETURNING jsonb_build_object('action','strike','prior_count',0) $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
const one = async (q) => (await db.query(q)).rows[0];
const refuses = async (q) => { try { await db.exec(q); return null; } catch (e) { return e.message; } };
const flip = (a) => db.exec(`UPDATE public.feature_switches SET audience='${a}' WHERE key='identity_check'`);

const skip = process.env.NEW_MIGRATION === "skip";
const old = "'2026-10-27 16:59:30+00'";
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, idv_attempt_count, idv_attempted_at, stripe_account_id, stripe_payouts_enabled) VALUES
 ('${POSTER}','verified',1,now(),null,false), ('${PLAIN}','not_started',0,null,'acct',true), ('${VERIFIED}','verified',1,now(),'acct',true),
 ('${RESET3}','not_started',3,'2026-10-23',null,false), ('${RESET3_RETRIED}','not_started',3,'2026-10-29',null,false),
 ('${RESET1}','not_started',1,'2026-10-22',null,false), ('${OTHER3}','not_started',3,'2026-10-23',null,false),
 ('${RESET_TA}','not_started',3,'2026-10-23',null,false);
INSERT INTO public.profiles (user_id, is_seed, idv_status) VALUES ('${TESTER}', true, 'not_started');
INSERT INTO public.test_accounts VALUES ('${TESTER}'), ('${RESET_TA}');
INSERT INTO public.helper_verifications VALUES
 ('${RESET3}','idv_status','verified','not_started',${old}), ('${RESET3_RETRIED}','idv_status','verified','not_started',${old}),
 ('${RESET1}','idv_status','verified','not_started',${old}), ('${RESET_TA}','idv_status','verified','not_started',${old});
`);
const job = (jid, helper, hours, extra = "NULL") => `
INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, helper_id, status, helper_confirmed_at, helper_on_the_way_at, payment_status, helper_fee_percent, helper_fee_flat_cents)
 VALUES ('${jid}', 'Yard', 100, (now() + interval '${hours} hours')::date, (now() + interval '${hours} hours')::time, '${POSTER}', '${helper}', 'accepted', now(), ${extra}, 'escrow', 5, 70);`;
await db.exec(job(JOB_LATE, PLAIN, 5) + job(JOB_VERIFIED, VERIFIED, 5) + job(JOB_OTW, PLAIN, 5, "now()") + job(JOB_FAR, PLAIN, 72) + job(JOB_NOTICE, PLAIN, 10) + job(JOB_VFAR, VERIFIED, 72));

if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the old functions");

const fn = async (n) => (await db.query(`SELECT to_regproc('public.${n}') r`)).rows[0].r;

// ── OFF: nothing changes ───────────────────────────────────────────────────
await as(null);
ok("OFF: a payout does not wait", (await one(`SELECT public.payout_waits_on_identity('${PLAIN}') w`)).w === false);
ok("OFF: a claim goes through", (await refuses(`INSERT INTO public.payout_transfers (job_id, helper_id) VALUES ('${JOB_FAR}','${PLAIN}')`)) === null);

// ── ON ─────────────────────────────────────────────────────────────────────
await flip("everyone");
ok("ON, payout_after_hire off: an unverified Helpr's payout waits", (await one(`SELECT public.payout_waits_on_identity('${PLAIN}') w`)).w === true);
ok("ON: the claim is refused payout_held", /payout_held/.test((await refuses(`INSERT INTO public.payout_transfers (job_id, helper_id) VALUES ('${JOB_LATE}','${PLAIN}')`)) ?? ""));
ok("ON: a verified Helpr is paid", (await refuses(`INSERT INTO public.payout_transfers (job_id, helper_id) VALUES ('${JOB_VERIFIED}','${VERIFIED}')`)) === null);
ok("ON: an enrolled test account is exempt", (await one(`SELECT public.payout_waits_on_identity('${TESTER}') w`)).w === false);
ok("a NULL member never waits or says yes", (await one(`SELECT public.payout_waits_on_identity(NULL) w`)).w === false);

// Delivery
const task = (await one(`INSERT INTO public.helpr_tasks DEFAULT VALUES RETURNING id`)).id;
await as(PLAIN);
ok("ON: taking a delivery unverified is refused", /identity_required_to_deliver/.test((await refuses(`UPDATE public.helpr_tasks SET helpr_id='${PLAIN}' WHERE id='${task}'`)) ?? ""));
await as(VERIFIED);
ok("ON: a verified Helpr takes it", (await refuses(`UPDATE public.helpr_tasks SET helpr_id='${VERIFIED}' WHERE id='${task}'`)) === null);
ok("the cart no longer asks", (await refuses(`INSERT INTO public.declutter_cart_items VALUES ('${PLAIN}')`)) === null);

// Poster notice
await as(null);
if (await fn("identity_notify_posters_before_start")) {
  const sent = (await one(`SELECT public.identity_notify_posters_before_start(100) n`)).n;
  const again = (await one(`SELECT public.identity_notify_posters_before_start(100) n`)).n;
  ok("ON: the poster is told, inside 24 h only, once", sent === 2 && again === 0, `sent=${sent} again=${again}`);
  const q = (j) => one(`SELECT count(*)::int c FROM public.notifications WHERE job_id='${j}' AND user_id='${POSTER}' AND title LIKE 'Your Helpr%'`);
  ok("no notice for a job 72 h away", (await q(JOB_FAR)).c === 0);
  ok("no notice for a verified Helpr", (await q(JOB_VERIFIED)).c === 0);
  ok("no notice once the Helpr is on the way", (await q(JOB_OTW)).c === 0);
  // A captured charge keeps the card's cost and a first job's $2 (_shared/refundAmount.ts): "no cost" would be false.
  const words = (await one(`SELECT message FROM public.notifications WHERE job_id='${JOB_LATE}' AND user_id='${POSTER}' AND title LIKE 'Your Helpr%'`)).message;
  ok("the notice never promises no cost", !/no cost|free|nothing to pay/i.test(words), words);
  ok("the notice says what is true: no pay for their time, and the amount shown first", /without paying for their time/.test(words) && /what comes back to you before you confirm/.test(words), words);
} else ok("identity_notify_posters_before_start exists", false);

// Cancel, read only if the migration restated it
if (await fn("poster_cancel_job")) {
  await as(POSTER);
  const c = (await one(`SELECT public.poster_cancel_job('${JOB_LATE}') r`)).r;
  ok("ON: cancelling an unverified Helpr 5 h out costs nothing", Number(c.cancellation_fee) === 0 && c.helper_committed === false, JSON.stringify(c));
  ok("no strike on the poster", (await one(`SELECT count(*)::int c FROM public.strikes WHERE job_id='${JOB_LATE}'`)).c === 0);
  const row = await one(`SELECT cancellation_fee, cancellation_fee_status FROM public.jobs WHERE id='${JOB_LATE}'`);
  ok("the recorded fee is 0, what void-cancelled-payments honours", Number(row.cancellation_fee) === 0 && row.cancellation_fee_status === null);
  ok("the Helpr is told why", (await one(`SELECT count(*)::int c FROM public.notifications WHERE user_id='${PLAIN}' AND message LIKE '%before your ID was verified%'`)).c === 1);
  // The record money-reconciliation reads: only this cancel writes it, and members cannot.
  ok("the waiver row is written for this cancel", (await one(`SELECT count(*)::int c FROM public.job_cancel_id_waivers WHERE job_id='${JOB_LATE}'`)).c === 1);
  ok("members cannot write the waiver", (await one(`SELECT has_table_privilege('authenticated', 'public.job_cancel_id_waivers', 'INSERT') a`)).a === false);
  ok("members cannot read the waiver", (await one(`SELECT has_table_privilege('authenticated', 'public.job_cancel_id_waivers', 'SELECT') a`)).a === false);
  ok("the money sweep's role can read it", (await one(`SELECT has_table_privilege('service_role', 'public.job_cancel_id_waivers', 'SELECT') a`)).a === true);
  ok("RLS is on", (await one(`SELECT relrowsecurity r FROM pg_class WHERE oid='public.job_cancel_id_waivers'::regclass`)).r === true);
  const v = (await one(`SELECT public.poster_cancel_job('${JOB_VERIFIED}') r`)).r;
  ok("a verified Helpr keeps the fee", Number(v.cancellation_fee) === 25, JSON.stringify(v));
  ok("a verified Helpr's cancel writes no waiver", (await one(`SELECT count(*)::int c FROM public.job_cancel_id_waivers WHERE job_id='${JOB_VERIFIED}'`)).c === 0);
  // main's newest poster_cancel_job (20261031015647, owner 10-30): a strike only inside 24 hours of the start. Kept.
  const far = (await one(`SELECT public.poster_cancel_job('${JOB_VFAR}') r`)).r;
  ok("a verified Helpr 72 h out: no fee and no strike (main's strike-only-inside-24h kept)",
    Number(far.cancellation_fee) === 0 && (await one(`SELECT count(*)::int c FROM public.strikes WHERE job_id='${JOB_VFAR}'`)).c === 0, JSON.stringify(far));
  const o = (await one(`SELECT public.poster_cancel_job('${JOB_OTW}') r`)).r;
  ok("a Helpr already on the way keeps the fee", Number(o.cancellation_fee) === 25, JSON.stringify(o));
  // A crew: per member. Unverified and not on the way costs nothing; verified, or already on the way, keeps the ladder.
  await as(null);
  const JOB_CREW = id(16);
  const OTW_MEMBER = id(9);
  await db.exec(`
    INSERT INTO public.profiles (user_id, idv_status) VALUES ('${OTW_MEMBER}', 'not_started');
    INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, status, payment_status, helper_fee_percent, helper_fee_flat_cents, is_group_job, helpers_needed)
      VALUES ('${JOB_CREW}', 'Crew', 300, (now() + interval '5 hours')::date, (now() + interval '5 hours')::time, '${POSTER}', 'accepted', 'escrow', 5, 70, true, 3);
    INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, share_cents, helper_confirmed_at, helper_on_the_way_at) VALUES
      ('${JOB_CREW}', '${PLAIN}', now(), 10000, now(), NULL),
      ('${JOB_CREW}', '${VERIFIED}', now(), 10000, now(), NULL),
      ('${JOB_CREW}', '${OTW_MEMBER}', now(), 10000, now(), now());`);
  await as(POSTER);
  const crew = (await one(`SELECT public.poster_cancel_job('${JOB_CREW}') r`)).r;
  const share = async (u) => one(`SELECT committed, share_amount, fee_percent FROM public.crew_cancellation_fee_shares WHERE job_id='${JOB_CREW}' AND helper_id='${u}'`);
  const plainShare = await share(PLAIN);
  ok("crew: the unverified member not on the way gets no fee", plainShare.committed === false && Number(plainShare.share_amount) === 0, JSON.stringify(plainShare));
  ok("crew: a verified member keeps the ladder", Number((await share(VERIFIED)).share_amount) === 25);
  ok("crew: an unverified member already on the way keeps the ladder", Number((await share(OTW_MEMBER)).share_amount) === 25);
  ok("crew: the poster's fee is exactly the two who keep it", Number(crew.cancellation_fee) === 50, JSON.stringify(crew));
  await as(null);
} else ok("poster_cancel_job exists", false);

// Data
const count = async (u) => (await one(`SELECT idv_attempt_count c FROM public.profiles WHERE user_id='${u}'`)).c;
ok("the reset member at 3 attempts starts over", (await count(RESET3)) === 0);
ok("a reset member who tried since is left", (await count(RESET3_RETRIED)) === 3);
ok("a reset member at 1 attempt is left", (await count(RESET1)) === 1);
ok("a member at 3 who was never reset is left", (await count(OTHER3)) === 3);
ok("an enrolled test account (not marked is_seed) reset at 3 is left", (await count(RESET_TA)) === 3);

// Declutter wait
if (!skip) {
  const w = (await one(`SELECT public.payout_payee_wait_seen('declutter','${JOB_FAR}','${PLAIN}',1000,'identity','ID check not finished') r`)).r;
  ok("the 'identity' wait is accepted and the payee told", w.reminded === true);
  const n = await one(`SELECT title, link FROM public.notifications WHERE user_id='${PLAIN}' AND title='Verify your ID to get paid'`);
  ok("the notice links to the ID check", n?.link === "/home?verify_id=1", JSON.stringify(n));
} else ok("the 'identity' wait exists", false);

const d = await one(`SELECT description FROM public.feature_switches WHERE key='identity_check'`);
ok("the switch description no longer names PayPal", !/paypal/i.test(d.description));
ok("a replay never changes the audience", (await one(`SELECT audience a FROM public.feature_switches WHERE key='identity_check'`)).a === "everyone");
await flip("off");

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
