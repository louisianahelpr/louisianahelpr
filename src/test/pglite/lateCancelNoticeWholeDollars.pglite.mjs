#!/usr/bin/env node
/**
 * PGlite proof for 20261102070622_late_cancel_notice_whole_dollars (Q1979): a late-cancel notice quotes the Helpr's part
 * rounded DOWN to the whole dollar, as void-cancelled-payments sends it (roundPayoutDownCents), and when that is $0 it
 * promises nothing ("comes to under $1, so there is no payment for it", type 'warning', no "compensated" title).
 * poster_cancel_job's solo notice and crew loop, and settle_one_off_jobs_for_banned_account.
 *
 *   node src/test/pglite/lateCancelNoticeWholeDollars.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/lateCancelNoticeWholeDollars.pglite.mjs # RED (the live notices)
 *   MUTANT=<name> node src/test/pglite/lateCancelNoticeWholeDollars.pglite.mjs      # a planted defect: must FAIL
 *
 * Fixture: posterCannotClearOnTheWay.pglite.mjs's schema and stubs (cancellation_fee_percent 25% inside 24 h,
 * helpr_flat_fee_cents = 5% + 70c, crew shares budget / n). Real text: poster_cancel_job (20261031220849), the newest
 * settle_one_off_jobs_for_banned_account CREATE (before: without the later in-place copy rewrites, which this proof
 * does not read), ban_settlement_action, helpr_payout_round_down_cents and the rest the cancel calls, cut from the
 * newest migration. Grants: the migration's own REVOKE/GRANT, with Supabase's default EXECUTE grant emulated.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261102070622_late_cancel_notice_whole_dollars.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The crew part is no longer rounded down.
  crewNoFloor: ["      v_helper_cut := public.helpr_payout_round_down_cents(round(v_helper_cut * 100)::integer) / 100.0;\n      INSERT", "      INSERT"],
  // The solo part is no longer rounded down.
  soloNoFloor: ["    v_helper_cut := public.helpr_payout_round_down_cents(round(v_helper_cut * 100)::integer) / 100.0;\n\n    INSERT", "\n    INSERT"],
  // The ban settlement's part is no longer rounded down.
  settleNoFloor: ["          v_cut := public.helpr_payout_round_down_cents(round(v_cut * 100)::integer) / 100.0;\n", ""],
  // A $0 solo part still titled "compensated".
  soloTitle: ["      CASE WHEN v_helper_cut > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,", "      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,"],
  // A $0 crew part still typed 'payment'.
  crewType: ["        CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'warning' END,", "        CASE WHEN v_share.share_amount > 0 THEN 'payment' ELSE 'warning' END,"],
  // The settlement left executable by members (Supabase's default grant).
  openSettle: ["REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;", ""],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);
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
const [POSTER, HELPR, MEMBER1, MEMBER2, BANNED] = [1, 2, 3, 4, 5].map(id);
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
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
for (const fn of ["is_server_context", "job_posted_by_seed", "ban_settlement_action", "helpr_payout_round_down_cents",
  "settle_one_off_jobs_for_banned_account", "enforce_group_member_lifecycle_server_owned"]) await db.exec(cut(fn));
await db.exec(`CREATE TRIGGER zza_group_member_lifecycle_server_owned BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_lifecycle_server_owned();`);
await db.exec(mig("20261031220849_id_check_asked_when_hired_restated.sql"));
if (!skip) {
  let sql = mig(THIS);
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the live notices");

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
  ('${POSTER}','verified',true), ('${HELPR}','verified',true), ('${MEMBER1}','verified',true), ('${MEMBER2}','verified',true), ('${BANNED}','verified',true);`);

/** A funded, hired, confirmed flat-model (5% + 70c) solo job 5 hours out (25% late fee), posted by `poster`. */
const solo = (budget, poster = POSTER) => db.exec(`
  DELETE FROM public.notifications; DELETE FROM public.applications; DELETE FROM public.strikes; DELETE FROM public.jobs WHERE id = '${JOB}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, helper_id, status, helper_confirmed_at, helper_dayof_confirmed_at,
                           payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents)
  VALUES ('${JOB}', 'Yard', ${budget}, (now() + interval '5 hours')::date, (now() + interval '5 hours')::time, '${poster}', '${HELPR}', 'accepted',
          now() - interval '1 day', now() - interval '1 hour', 'escrow', 'cs_x', 5, 70);
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${JOB}', '${HELPR}', 'accepted');`);
const told = (uid) => rows(`SELECT title, message, type FROM public.notifications WHERE user_id = '${uid}'`);
const promises = (n) => /compensated/.test(n.title) || /receive about/.test(n.message) || n.type === "payment";

// 1. Solo, $4 budget: fee $1.00, part $1.00 - (5c + 70c) = $0.25, sent $0 (void-cancelled-payments waives under $1).
await solo(4);
const c1 = await as(POSTER, `SELECT public.poster_cancel_job('${JOB}') AS r`);
ok("solo $4: the cancel records the $1.00 fee (no money change)", Number(c1.rows[0]?.r?.cancellation_fee) === 1, JSON.stringify(c1));
const n1 = await told(HELPR);
ok("solo $4: the Helpr's $0 part promises nothing (no 'compensated', no amount, type warning)",
  n1.length === 1 && !promises(n1[0]) && n1[0].title === "Job cancelled" && n1[0].type === "warning", JSON.stringify(n1));
ok("solo $4: and says why there is no payment", /under \$1, so there is no payment/.test(n1[0]?.message ?? ""), JSON.stringify(n1));

// 2. Solo, $100 budget: fee $25.00, part $25.00 - $1.95 = $23.05, sent $23.00.
await solo(100);
await as(POSTER, `SELECT public.poster_cancel_job('${JOB}') AS r`);
const n2 = await told(HELPR);
ok("solo $100: the notice quotes the whole dollars sent ($23.00, not $23.05)",
  n2.length === 1 && n2[0].message.includes("about $23.00") && /compensated/.test(n2[0].title) && n2[0].type === "payment", JSON.stringify(n2));

// 3. Crew of 2, $10 budget: each share $1.25 (25% of $5), part $1.25 - (6c + 70c) = $0.49, sent $0.
const crew = (budget) => db.exec(`
  DELETE FROM public.notifications; DELETE FROM public.group_job_helpers; DELETE FROM public.crew_cancellation_fee_shares; DELETE FROM public.jobs WHERE id='${CREW}';
  INSERT INTO public.jobs (id, title, budget, date_needed, start_time, customer_id, status, payment_status, stripe_session_id, helper_fee_percent, helper_fee_flat_cents, is_group_job, helpers_needed)
    VALUES ('${CREW}', 'Crew', ${budget}, (now() + interval '5 hours')::date, (now() + interval '5 hours')::time, '${POSTER}', 'accepted', 'escrow', 'cs_c', 5, 70, true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, share_cents, helper_confirmed_at) VALUES
    ('${CREW}', '${MEMBER1}', now(), ${budget * 50}, now()), ('${CREW}', '${MEMBER2}', now(), ${budget * 50}, now());`);
await crew(10);
const c3 = await as(POSTER, `SELECT public.poster_cancel_job('${CREW}') AS r`);
ok("crew $10: the cancel records $2.50 of fees (no money change)", Number(c3.rows[0]?.r?.cancellation_fee) === 2.5, JSON.stringify(c3));
const n3 = [...await told(MEMBER1), ...await told(MEMBER2)];
ok("crew $10: neither member's $0 part promises anything", n3.length === 2 && n3.every((n) => !promises(n) && /under \$1/.test(n.message)), JSON.stringify(n3));

// 4. Crew of 2, $200 budget: share $25.00, part $25.00 - $1.95 = $23.05, sent $23.00.
await crew(200);
await as(POSTER, `SELECT public.poster_cancel_job('${CREW}') AS r`);
const n4 = [...await told(MEMBER1), ...await told(MEMBER2)];
ok("crew $200: each member is quoted the whole dollars sent ($23.00)", n4.length === 2 && n4.every((n) => n.message.includes("about $23.00") && n.type === "payment"), JSON.stringify(n4));

// 5. The ban settlement: the poster of a late $4 job is banned; the Helpr's $0.25 part is $0 sent.
await solo(4, BANNED);
const s5 = await rows(`SELECT public.settle_one_off_jobs_for_banned_account('${BANNED}') AS r`);
const n5 = await told(HELPR);
ok("ban settlement $4: the job is cancelled with its fee", s5[0]?.r?.settled?.[0]?.action === "cancel_priced", JSON.stringify(s5));
ok("ban settlement $4: the Helpr's $0 part promises nothing", n5.length === 1 && !promises(n5[0]) && /under \$1/.test(n5[0].message), JSON.stringify(n5));
await solo(100, BANNED);
await rows(`SELECT public.settle_one_off_jobs_for_banned_account('${BANNED}') AS r`);
const n6 = await told(HELPR);
ok("ban settlement $100: quoted $23.00, the whole dollars sent", n6.length === 1 && n6[0].message.includes("about $23.00") && n6[0].type === "payment", JSON.stringify(n6));

// 6. Grants as live holds them.
const g = (await rows(`SELECT has_function_privilege('anon', 'public.poster_cancel_job(uuid, text, bigint)', 'EXECUTE') AS pa,
  has_function_privilege('authenticated', 'public.poster_cancel_job(uuid, text, bigint)', 'EXECUTE') AS pu,
  has_function_privilege('anon', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE') AS sa,
  has_function_privilege('authenticated', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE') AS su`))[0];
ok("grants: poster_cancel_job members only (no anon); the settlement service_role only", !g.pa && g.pu && !g.sa && !g.su, JSON.stringify(g));

console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
