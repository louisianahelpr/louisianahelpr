#!/usr/bin/env node
/**
 * PGlite proof for 20260925154606_group_crew_has_no_lead (docs/OPEN.md Q407:
 * a crew has no lead; the late-cancel fee is split across the hired crew; one
 * review per Helpr).
 *
 *   node src/test/pglite/groupCrewNoLead.pglite.mjs
 *   node src/test/pglite/groupCrewNoLead.pglite.mjs --replay   # apply 3x
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * THE BEFORE STATE is what would reach prod without this migration: every
 * function in the path at its newest CREATE text before 20260925140148 (found
 * by scanning the migrations, not hand-listed), then 20260925140148 (the
 * roster-departure rework) and 20260925143327 (the in-place copy rewrites of
 * poster_cancel_job, notify_on_job_update and helper_cancel_booking) run
 * VERBATIM, so the rewritten bodies are the ones Postgres would hold. Every
 * jobs UPDATE runs prod's BEFORE UPDATE chain in trigger-name order, and the
 * reviews insert runs enforce_review_validity + set_review_visibility.
 * Stubs (not under test): is_caller_banned, apply_job_denial_consequence,
 * are_users_blocked, log_notification, apply_consequence_ladder (records one
 * user_violations row per call so the strike count is observable).
 *
 * RED-BEFORE:
 *   R0  accept_group_application cannot hire anyone: its status CASE is text
 *       and Postgres refuses to assign text to the job_status enum.
 *   R1  its text still names the first hire as jobs.helper_id (the lead).
 *   R2  a late cancel of a 3-member confirmed crew (seeded as the hire flow
 *       leaves it: lead = first hire) tells ONE member about a fee, and there
 *       is no per-member share anywhere.
 *   R3  the poster cannot review crew member #2.
 *   R4  a hire (the RPC's own roster INSERT: the poster's uid, a definer
 *       role) lands on a crew whose escrow was refunded.
 *   R5  a crew member who is not the lead cannot upload a proof photo to the
 *       job's folder (the before photo their own Working step needs).
 * AFTER: A1..A38 below.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20260925154606_group_crew_has_no_lead.sql";
const REWORK = "20260925140148_group_roster_departure.sql";
const COPY_REWRITES = "20260925143327_notification_copy_names_the_person.sql";
const MIGRATION = process.env.NEW_MIGRATION_FILE ? readFileSync(process.env.NEW_MIGRATION_FILE, "utf8") : mig(THIS);

/** Every function the path touches, resolved to its newest CREATE before the rework. */
const PATH_FUNCTIONS = [
  "is_server_context", "has_role", "job_payment_is_funded", "helper_award_block_reason",
  "enforce_helper_award_gate", "enforce_job_funded_before_award", "enforce_helper_jobs_column_whitelist",
  "enforce_hire_columns_rpc_only", "enforce_ban_gate", "enforce_poster_jobs_money_lock",
  "prevent_job_field_escalation", "enforce_job_status_transition", "enforce_jobs_arrival_integrity",
  "enforce_cancellation_requires_rpc", "helper_cancel_booking", "enforce_job_tracking_arrival_gate",
  "group_member_slot", "accept_group_application", "enforce_group_roster_award_gate",
  "poster_cancel_job", "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation",
  "apply_cancellation_violation_consequence", "notify_on_job_update", "notify_on_payment_escrowed",
  "enforce_review_validity", "set_review_visibility", "get_helper_tiers", "is_party_to_job_folder",
  "rpc_group_member_set_proof", "rpc_group_member_mark_done", "resolve_auto_tip", "auto_tip_candidates",
];
const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
function cutFunction(sql, name) {
  const m = [...sql.matchAll(defRe(name))].at(-1);
  if (!m) throw new Error(`${name} not defined in the given file`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < REWORK).sort();
const NEWEST = {};
for (const fn of PATH_FUNCTIONS) {
  const file = BEFORE_FILES.filter((f) => defRe(fn).test(mig(f))).at(-1);
  if (!file) {
    console.error(`${fn}: no definition before ${REWORK}`);
    process.exit(2);
  }
  NEWEST[fn] = file;
}
// Nothing between the rework and this migration may restate the path except
// the two files run verbatim below.
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x > REWORK && x < THIS && x !== COPY_REWRITES)) {
  const hit = PATH_FUNCTIONS.filter((fn) => defRe(fn).test(mig(f)));
  if (hit.length) {
    console.error(`${f} restates ${hit.join(", ")}: add it to the before state.`);
    process.exit(2);
  }
}
const BEFORE_FUNCTIONS = PATH_FUNCTIONS.map((fn) => cutFunction(mig(NEWEST[fn]), fn)).join("\n\n");

const REPLAY = process.argv.includes("--replay");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "99999999-9999-9999-9999-999999999999";
const M1 = "11111111-1111-1111-1111-111111111111";
const M2 = "22222222-2222-2222-2222-222222222222";
const M3 = "44444444-4444-4444-4444-444444444444";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";
const ADMIN = "55555555-5555-5555-5555-555555555555";
const GJOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SJOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LEGACY_NOSLOT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LEGACY_SLOT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const USERS = [POSTER, M1, M2, M3, OUTSIDER, ADMIN];

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean,
  stripe_identity_verified boolean, idv_status text, is_seed boolean DEFAULT false,
  full_name text, parish text, avatar_url text, email_verified boolean DEFAULT true, ban_status text,
  auto_tip_mode text DEFAULT 'off', auto_tip_value numeric, auto_tip_cap numeric, auto_tip_enabled_at timestamptz
);
CREATE TABLE public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, tipper_id uuid, helper_id uuid,
  amount numeric, source text DEFAULT 'manual', payment_status text
);
CREATE UNIQUE INDEX tips_one_auto_per_job ON public.tips (job_id) WHERE source = 'auto';
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status job_status NOT NULL DEFAULT 'open',
  is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  date_needed date, start_time time,
  response_deadline timestamptz, offered_to_helper_id uuid, recurring_helper_id uuid,
  stripe_session_id text, stripe_payment_intent_id text, budget numeric,
  helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_working_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text,
  late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text, helper_fee_percent numeric,
  recurrence_days text[], parent_job_id uuid,
  require_photo_proof boolean DEFAULT true, proof_before_urls text[], proof_after_urls text[],
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz,
  start_reminder_sent_at timestamptz,
  helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  poster_completed_at timestamptz, helper_completed_at timestamptz,
  has_active_dispute boolean NOT NULL DEFAULT false, dispute_resolved_at timestamptz,
  updated_at timestamptz DEFAULT now(), completed_at timestamptz,
  payment_status text
);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(),
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  helper_completed_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  UNIQUE (job_id, helper_id)
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, offer_message text
);
CREATE TABLE public.job_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, title text, message text, type text, link text, job_id uuid
);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, financial_alerts boolean);
CREATE TABLE public.user_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid
);
-- The live reviews shape the path reads (20260311000404 + 20260506192638).
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback text, created_at timestamptz NOT NULL DEFAULT now(),
  feedback_visible_at timestamptz, response_text text, response_at timestamptz,
  status text DEFAULT 'published',
  UNIQUE (job_id, reviewer_id)
);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view" ON public.group_job_helpers FOR SELECT USING (
  (SELECT auth.uid()) IN (SELECT jobs.customer_id FROM public.jobs WHERE jobs.id = group_job_helpers.job_id)
  OR (SELECT auth.uid()) = helper_id);
-- 20260901030422: the poster may UPDATE their roster rows (why a share needs its own freeze).
CREATE POLICY "Job owner can update group helpers" ON public.group_job_helpers FOR UPDATE
  USING (auth.uid() IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id))
  WITH CHECK (auth.uid() IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id));
CREATE POLICY "remove while staffing" ON public.group_job_helpers FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = group_job_helpers.job_id
          AND j.customer_id = (SELECT auth.uid()) AND j.status = 'open'::job_status));
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view reviews" ON public.reviews FOR SELECT USING (true);
-- The live INSERT policy (20260825053000); the migration recreates it.
CREATE POLICY "Users can create reviews for eligible jobs" ON public.reviews
FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = reviewer_id
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = reviews.job_id
      AND (j.customer_id = (SELECT auth.uid()) OR j.helper_id = (SELECT auth.uid()))
      AND ((j.customer_id = (SELECT auth.uid()) AND j.helper_id = reviews.reviewee_id)
        OR (j.helper_id = (SELECT auth.uid()) AND j.customer_id = reviews.reviewee_id))
      AND j.status = 'completed'::job_status
      AND j.payment_status IN ('released', 'payout_pending')
      AND (j.has_active_dispute = false OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
  )
);

-- Stubs (not under test).
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action','record') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_violations (user_id, violation_type, job_id) VALUES (p_user, p_violation_type, p_job_id);
  RETURN jsonb_build_object('action', 'warning', 'prior_count', p_prior_count);
END $$;

-- Supabase storage, the two pieces the proof-photos policies read.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

${BEFORE_FUNCTIONS}

-- The live proof-photos policies: INSERT/SELECT from 20260831171658, UPDATE/DELETE from 20260925141905.
CREATE POLICY "Users can upload proof photos to own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proof-photos' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.is_party_to_job_folder(name)));
CREATE POLICY "Users can read proof photos for their jobs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.is_party_to_job_folder(name)));
CREATE POLICY "Users can update their own proof photos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'proof-photos' AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
         AND (((select auth.uid()))::text = (storage.foldername(name))[1] OR public.is_party_to_job_folder(name)));
CREATE POLICY "Users can delete their own proof photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'proof-photos' AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
         AND (((select auth.uid()))::text = (storage.foldername(name))[1] OR public.is_party_to_job_folder(name)));

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;

-- prod's BEFORE UPDATE chain on jobs (names as on prod: they fire in name order).
CREATE TRIGGER jobs_award_gate BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_award_gate();
CREATE TRIGGER trg_cancellation_requires_rpc BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cancellation_requires_rpc();
CREATE TRIGGER trg_enforce_job_status_transition BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_status_transition();
CREATE TRIGGER trg_helper_jobs_column_whitelist BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_jobs_column_whitelist();
CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();
CREATE TRIGGER trg_job_funded_before_award BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_funded_before_award();
CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_jobs_money_lock();
CREATE TRIGGER trg_prevent_job_field_escalation BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_job_field_escalation();
CREATE TRIGGER zz_jobs_arrival_integrity BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_arrival_integrity();
CREATE TRIGGER on_job_update AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_update();
CREATE TRIGGER trg_notify_payment_escrowed AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();
CREATE TRIGGER group_job_helpers_award_gate BEFORE INSERT ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_roster_award_gate();
CREATE TRIGGER trg_hire_columns_rpc_only BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();
CREATE TRIGGER trg_ban_gate_group_job_helpers_delete BEFORE DELETE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
CREATE TRIGGER trg_job_tracking_arrival_gate BEFORE INSERT OR UPDATE ON public.job_tracking
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_tracking_arrival_gate();
CREATE TRIGGER enforce_review_validity_trigger BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_review_validity();
CREATE TRIGGER reviews_set_visibility AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_review_visibility();
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, res: await db.exec(sql) };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const asUser = (uid, sql) => as("authenticated", uid, sql);
const asUserRows = async (uid, sql) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
};

/**
 * A funded group job GJOB with `members` pending applications; hire() runs the
 * real accept_group_application as the poster. `confirmed` members get a
 * roster confirmation stamp (server write, as rpc_group_member_confirm does).
 */
async function seed({ status = "open", payment = "escrow", needed = 3, budget = 300, start = "+5 days", apps = [M1, M2, M3] } = {}) {
  await db.exec(`
    DELETE FROM public.reviews; DELETE FROM public.user_violations; DELETE FROM public.notifications;
    DELETE FROM public.job_tracking; DELETE FROM public.applications;
    ${failuresTableExists ? "DELETE FROM public.crew_cancellation_fee_shares;" : ""}
    DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed, budget,
                             date_needed, start_time, payment_status, stripe_session_id, helper_fee_percent)
    VALUES ('${GJOB}', '${POSTER}', NULL, 'Move a piano', '${status}', true, ${needed}, ${budget},
            (now() AT TIME ZONE 'America/Chicago' + interval '${start}')::date,
            (now() AT TIME ZONE 'America/Chicago' + interval '${start}')::time, '${payment}', 'cs_test_1', 10),
           ('${SJOB}', '${POSTER}', '${M1}', 'Mow a lawn', 'completed', false, 1, 80,
            (now() + interval '5 days')::date, '09:00', 'released', 'cs_test_2', 10);
    ${apps.map((m) => `INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${GJOB}', '${m}', 'pending');`).join("\n")}
  `);
}
let failuresTableExists = false;
const hire = (m) =>
  asUser(POSTER, `SELECT * FROM public.accept_group_application(
    (SELECT id FROM public.applications WHERE job_id='${GJOB}' AND helper_id='${m}'));`);
const confirm = (members) =>
  db.exec(members.map((m) => `UPDATE public.group_job_helpers SET helper_confirmed_at = now() - interval '1 day' WHERE job_id='${GJOB}' AND helper_id='${m}';`).join("\n"));
const job = (id = GJOB) =>
  one(`SELECT helper_id, status::text AS status, cancellation_fee::text AS fee, cancellation_fee_status, late_cancellation, payment_status
         FROM public.jobs WHERE id='${id}'`);
const cancel = () => asUser(POSTER, `SELECT public.poster_cancel_job('${GJOB}', 'plans changed');`);
const noticesFor = (u, like = "%") =>
  all(`SELECT title, message FROM public.notifications WHERE user_id='${u}' AND title LIKE '${like}' ORDER BY title`);
const strikes = async () =>
  (await one(`SELECT count(*)::int AS n FROM public.user_violations WHERE user_id='${POSTER}' AND violation_type='cancel_with_helper'`)).n;
const review = (from, to, j = GJOB) =>
  asUser(from, `INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${j}', '${from}', '${to}', 5);`);
/** Booked -> working -> completed and approved, as the crew roll-up and the poster's approval leave it. */
const complete = () =>
  db.exec(`UPDATE public.jobs SET status='accepted' WHERE id='${GJOB}' AND status='open';
           UPDATE public.jobs SET status='in_progress' WHERE id='${GJOB}';
           UPDATE public.jobs SET status='completed', payment_status='payout_pending', poster_completed_at=now(), helper_completed_at=now() WHERE id='${GJOB}';`);
/** The roster INSERT exactly as accept_group_application makes it: definer role, the poster's uid. */
const rosterInsertAsHireRpc = (m) =>
  as("postgres", POSTER, `INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${GJOB}', '${m}');`);

// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
await db.exec(`INSERT INTO auth.users (id) VALUES ${USERS.map((u) => `('${u}')`).join(", ")};
  INSERT INTO public.profiles (user_id, is_seed, full_name) VALUES ${USERS.map((u, i) => `('${u}', true, 'Person ${i}')`).join(", ")};
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);
await db.exec(mig(REWORK));
await db.exec(mig(COPY_REWRITES));
console.log(`before state: ${PATH_FUNCTIONS.length} functions from their newest text, then ${REWORK} and ${COPY_REWRITES} verbatim`);

console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
await seed();
const r0 = await hire(M1);
check(
  "R0 accept_group_application cannot hire anyone (text CASE into the job_status enum)",
  !r0.ok && /is of type job_status but expression is of type text/.test(r0.error),
  r0.error ?? "hired",
);
const agaText = (await one(`SELECT pg_get_functiondef('public.accept_group_application(uuid,timestamptz,text)'::regprocedure) AS d`)).d;
check("R1 its text makes the first hire the crew's lead (helper_id = COALESCE(lead, new hire))", /helper_id = COALESCE\(v_existing_lead, v_helper_id\)/.test(agaText));

/** The crew state the (cast-fixed) hire flow of the before state leaves: roster + lead = first member. */
async function seedCrewAsBefore(members, { start = "+5 days", status = "accepted" } = {}) {
  await seed({ start, status, apps: [] });
  await db.exec(`
    ${members.map((m, i) => `INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at) VALUES ('${GJOB}', '${m}', now() - interval '${10 - i} minutes');
      INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${GJOB}', '${m}', 'accepted');`).join("\n")}
    UPDATE public.jobs SET helper_id = '${members[0]}' WHERE id = '${GJOB}';`);
}

await seedCrewAsBefore([M1, M2, M3], { start: "+1 hour" });
await confirm([M1, M2, M3]);
await db.exec(`UPDATE public.jobs SET helper_confirmed_at = now() - interval '1 day' WHERE id='${GJOB}'`);
const r2 = await cancel();
const r2paid = [];
for (const m of [M1, M2, M3]) if ((await noticesFor(m, "%compensated%")).length) r2paid.push(m);
check(
  "R2 a late cancel of a confirmed 3-member crew promises a fee to ONE member (the lead) only",
  r2.ok && r2paid.length === 1 && r2paid[0] === M1,
  r2.ok ? `members told of a fee: ${r2paid.length}, fee=${(await job()).fee}` : r2.error,
);

await seedCrewAsBefore([M1, M2]);
await complete();
const r3 = await review(POSTER, M2);
check("R3 the poster cannot review crew member #2", !r3.ok, r3.error ?? "allowed");

await seed({ apps: [] });
await db.exec(`UPDATE public.jobs SET payment_status='refunded' WHERE id='${GJOB}'`);
const r4 = await rosterInsertAsHireRpc(M2);
check("R4 a hire lands on a crew whose escrow was refunded", r4.ok, r4.error ?? "allowed");

await seedCrewAsBefore([M1, M2]);
const r5 = await asUser(M2, `INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', '${GJOB}/before-m2.jpg');`);
check("R5 crew member #2 (not the lead) cannot upload a proof photo to the job's folder", !r5.ok, r5.error ?? "allowed");

// Legacy rows for the backfill: a lead with no roster slot, and a lead with one.
await db.exec(`
  DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
  INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed, budget, date_needed, start_time, payment_status, helper_confirmed_at)
  VALUES ('${LEGACY_NOSLOT}', '${POSTER}', '${M1}', 'Old crew', 'accepted', true, 2, 100, (now() + interval '3 days')::date, '09:00', 'escrow', now()),
         ('${LEGACY_SLOT}', '${POSTER}', '${M2}', 'Old crew 2', 'open', true, 3, 100, (now() + interval '3 days')::date, '09:00', 'escrow', NULL);
  INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${LEGACY_SLOT}', '${M2}'), ('${LEGACY_SLOT}', '${M3}');
`);

// ════════════════════════════════════════════════════════════════════════════
const times = REPLAY ? 3 : 1;
for (let i = 1; i <= times; i++) {
  try {
    await db.exec(MIGRATION);
    console.log(`\napply #${i}: OK`);
  } catch (e) {
    console.log(`\napply #${i}: FAILED — ${e.message ?? e}`);
    failures++;
  }
}
failuresTableExists = !!(await one(`SELECT to_regclass('public.crew_cancellation_fee_shares') AS t`)).t;
console.log("\n── AFTER (migration applied) ────────────────────────────────────");

const legacy = await all(`SELECT j.id, j.helper_id,
    (SELECT array_agg(g.helper_id::text ORDER BY g.helper_id) FROM public.group_job_helpers g WHERE g.job_id = j.id) AS roster
  FROM public.jobs j WHERE j.id IN ('${LEGACY_NOSLOT}', '${LEGACY_SLOT}') ORDER BY j.id`);
check(
  "A1 backfill: no group job names a helper, and each former lead is on the roster (a slot added when missing, never duplicated)",
  legacy.length === 2 && legacy.every((r) => r.helper_id === null) &&
    JSON.stringify(legacy[0].roster) === JSON.stringify([M1]) && JSON.stringify(legacy[1].roster) === JSON.stringify([M2, M3]),
  JSON.stringify(legacy),
);

// ── No lead ─────────────────────────────────────────────────────────────────
await seed();
const a2 = [];
for (const m of [M1, M2, M3]) a2.push(await hire(m));
const a2j = await job();
const a2r = (await all(`SELECT helper_id FROM public.group_job_helpers WHERE job_id='${GJOB}'`)).length;
check(
  "A2 three hires: helper_id stays NULL, all three on the roster, the full crew books the job",
  a2.every((x) => x.ok) && a2j.helper_id === null && a2r === 3 && a2j.status === "accepted",
  JSON.stringify({ helper: a2j.helper_id, roster: a2r, status: a2j.status, errors: a2.filter((x) => !x.ok).map((x) => x.error) }),
);

let a3;
try {
  await db.exec(`UPDATE public.jobs SET helper_id='${M1}' WHERE id='${GJOB}'`);
  a3 = "allowed";
} catch (e) {
  a3 = String(e.message);
}
check("A3 not even a server write may name a lead on a group job", /group_job_has_no_lead/.test(a3), a3);

let a4;
try {
  await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, is_group_job, helpers_needed, payment_status)
                 VALUES (gen_random_uuid(), '${POSTER}', '${M1}', 'x', true, 2, 'escrow')`);
  a4 = "allowed";
} catch (e) {
  a4 = String(e.message);
}
check("A4 nor may a group job be created naming one", /group_job_has_no_lead/.test(a4), a4);

await seed();
await hire(M1);
await db.exec(`UPDATE public.jobs SET payment_status='refunded' WHERE id='${GJOB}'`);
const a5 = await hire(M2);
const a5r = await rosterInsertAsHireRpc(M3);
check(
  "A5 every hire onto a crew needs a funded job, not just the first (the RPC and its roster INSERT both refused)",
  !a5.ok && /not funded yet/.test(a5.error) && !a5r.ok && /not funded yet/.test(a5r.error),
  `${a5.error ?? "allowed"} | ${a5r.error ?? "allowed"}`,
);

await seed({ payment: "unpaid" });
const a6 = await hire(M1);
check("A6 the first hire onto an unfunded crew is refused too (the lead's helper_id write judged it before)", !a6.ok && /not funded yet/.test(a6.error), a6.error ?? "allowed");

// ── The late-cancel fee, split ──────────────────────────────────────────────
await seed({ start: "+1 hour" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2, M3]);
const a7 = await cancel();
const a7s = await all(`SELECT helper_id, share_amount::text AS share, fee_percent, committed, status FROM public.crew_cancellation_fee_shares WHERE job_id='${GJOB}' ORDER BY helper_id`);
const a7j = await job();
const a7told = [];
for (const m of [M1, M2, M3]) a7told.push((await noticesFor(m, "%compensated%")).map((n) => n.message).join(""));
check(
  "A7 late cancel (<2h, 50%) of a confirmed crew of 3 on $300: three equal $50.00 shares, job fee $150.00, each member told their own share",
  a7.ok && a7s.length === 3 && a7s.every((s) => s.share === "50.00" && s.fee_percent === 50 && s.committed && s.status === "pending") &&
    Number(a7j.fee) === 150 && a7j.cancellation_fee_status === "pending" && a7j.late_cancellation === true &&
    a7told.every((t) => /about \$45\.00/.test(t)),
  a7.ok ? JSON.stringify({ shares: a7s.map((s) => s.share), fee: a7j.fee, told: a7told.map((t) => (t.match(/\$[\d.]+/) ?? [""])[0]) }) : a7.error,
);
check("A8 one cancelled crew is ONE strike on the poster", (await strikes()) === 1, `strikes=${await strikes()}`);

// The owner's rule (Q407 addendum 13): only members who CONFIRMED share the fee.
await seed({ start: "+10 hours" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2]);
const a9 = await cancel();
const a9s = await all(`SELECT share_amount::text AS share FROM public.crew_cancellation_fee_shares WHERE job_id='${GJOB}' ORDER BY helper_id`);
const m3note = (await noticesFor(M3)).map((n) => n.message).join("");
check(
  "A9 (<24h, 25%) the owner's rule: only CONFIRMED members share the fee: $25.00, $25.00, $0.00, and the unconfirmed member is told no fee applies",
  a9.ok && a9s.map((s) => s.share).join(",") === "25.00,25.00,0.00" && Number((await job()).fee) === 50 && /before you confirmed your spot/.test(m3note),
  a9.ok ? JSON.stringify({ shares: a9s.map((s) => s.share), fee: (await job()).fee, m3: m3note.slice(0, 70) }) : a9.error,
);
await seed({ start: "+1 hour" });
for (const m of [M1, M2]) await hire(m);
await cancel();
check("A12 nobody on the crew confirmed: no fee, no strike", Number((await job()).fee) === 0 && (await strikes()) === 0, `fee=${(await job()).fee}, strikes=${await strikes()}`);

// The rule is ONE function: flipped to true, every HIRED member counts.
await db.exec(`CREATE OR REPLACE FUNCTION public.crew_fee_pays_unconfirmed() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;`);
await seed({ start: "+10 hours" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2]);
const a9f = await cancel();
const a9fs = await all(`SELECT share_amount::text AS share FROM public.crew_cancellation_fee_shares WHERE job_id='${GJOB}' ORDER BY helper_id`);
check(
  "A9b rule flipped to true: every hired member counts, confirmed or not: three equal $25.00 shares",
  a9f.ok && a9fs.map((s) => s.share).join(",") === "25.00,25.00,25.00" && Number((await job()).fee) === 75,
  a9f.ok ? JSON.stringify({ shares: a9fs.map((s) => s.share), fee: (await job()).fee }) : a9f.error,
);
await db.exec(`CREATE OR REPLACE FUNCTION public.crew_fee_pays_unconfirmed() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;`);

await seed({ start: "+10 hours", budget: 100 });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2, M3]);
await cancel();
const a10s = await all(`SELECT s.share_amount::text AS share, s.share_basis_cents AS basis FROM public.crew_cancellation_fee_shares s
  JOIN public.group_job_helpers g ON g.job_id = s.job_id AND g.helper_id = s.helper_id WHERE s.job_id='${GJOB}' ORDER BY g.slot_no`);
const a10j = await job();
check(
  "A10 cents: $100 / 3 is frozen as 3334 + 3333 + 3333; at 25% the shares are $8.34, $8.33, $8.33 and the fee is exactly $25.00",
  a10s.map((s) => `${s.basis}:${s.share}`).join(",") === "3334:8.34,3333:8.33,3333:8.33" && Number(a10j.fee) === 25,
  JSON.stringify({ shares: a10s, fee: a10j.fee }),
);

await seed({ start: "+5 days" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2, M3]);
await cancel();
const a11j = await job();
check(
  "A11 more than 24h out: every share $0, no fee status, still one strike (a committed crew)",
  Number(a11j.fee) === 0 && a11j.cancellation_fee_status === null && (await strikes()) === 1,
  JSON.stringify({ fee: a11j.fee, status: a11j.cancellation_fee_status, strikes: await strikes() }),
);

await seed({ start: "+1 hour" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2, M3]);
await db.exec(`UPDATE public.group_job_helpers SET helper_completed_at = now() WHERE job_id='${GJOB}' AND helper_id='${M2}'`);
const a13 = await cancel();
check("A13 a crew with any member's part done cannot be cancelled", !a13.ok && /not_cancellable/.test(a13.error), a13.error ?? "allowed");

// ── The ledger is server-owned ──────────────────────────────────────────────
await seed({ start: "+1 hour" });
for (const m of [M1, M2, M3]) await hire(m);
await confirm([M1, M2, M3]);
await cancel();
const seenBy = async (u) => (await asUserRows(u, `SELECT helper_id FROM public.crew_cancellation_fee_shares`)).map((r) => r.helper_id).sort();
const a14 = { m1: await seenBy(M1), poster: await seenBy(POSTER), outsider: await seenBy(OUTSIDER) };
check(
  "A14 a member reads only their own share, the poster reads all three, anyone else none",
  JSON.stringify(a14.m1) === JSON.stringify([M1]) && a14.poster.length === 3 && a14.outsider.length === 0,
  JSON.stringify({ m1: a14.m1.length, poster: a14.poster.length, outsider: a14.outsider.length }),
);
const a15u = await asUser(M1, `UPDATE public.crew_cancellation_fee_shares SET share_amount = 999 WHERE helper_id='${M1}'`);
const a15i = await asUser(M1, `INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, committed, fee_percent, share_amount) VALUES ('${GJOB}', '${OUTSIDER}', true, 50, 1)`);
const a15d = await asUser(POSTER, `DELETE FROM public.crew_cancellation_fee_shares`);
const a15a = await as("anon", null, `SELECT 1 FROM public.crew_cancellation_fee_shares`);
check(
  "A15 no client can insert, update or delete a share, and anon cannot even read the table",
  !a15u.ok && !a15i.ok && !a15d.ok && !a15a.ok,
  JSON.stringify({ update: a15u.error ?? "ok", insert: a15i.error ?? "ok", del: a15d.error ?? "ok", anon: a15a.error ?? "ok" }),
);

// ── Reviews, one per Helpr ──────────────────────────────────────────────────
await seed();
for (const m of [M1, M2, M3]) await hire(m);
await complete();
const a16 = [await review(POSTER, M1), await review(POSTER, M2), await review(POSTER, M3)];
check("A16 the poster reviews every crew member", a16.every((x) => x.ok), a16.map((x) => x.error ?? "ok").join(" | "));
const a17 = await review(POSTER, M2);
check("A17 but each only once", !a17.ok && /duplicate key|unique/i.test(a17.error), a17.error ?? "allowed");
const a18 = [await review(M1, POSTER), await review(M2, POSTER)];
check("A18 each member reviews the poster", a18.every((x) => x.ok), a18.map((x) => x.error ?? "ok").join(" | "));
const a19 = await review(M3, M1);
const a19o = await review(OUTSIDER, POSTER);
const a19p = await review(POSTER, OUTSIDER);
check(
  "A19 a member cannot review a fellow member, an outsider cannot review, the poster cannot review someone off the crew",
  !a19.ok && !a19o.ok && !a19p.ok,
  [a19.error, a19o.error, a19p.error].map((e) => (e ?? "allowed").slice(0, 60)).join(" | "),
);
const vis = await all(`SELECT reviewer_id, reviewee_id, feedback_visible_at <= now() AS visible FROM public.reviews WHERE job_id='${GJOB}'`);
const visible = (from, to) => vis.find((r) => r.reviewer_id === from && r.reviewee_id === to)?.visible;
check(
  "A20 double-blind per pair: poster<->M1 and poster<->M2 revealed each other; poster->M3 stays hidden (M3 has not reviewed)",
  visible(POSTER, M1) && visible(M1, POSTER) && visible(POSTER, M2) && visible(M2, POSTER) && visible(POSTER, M3) === false,
  JSON.stringify(vis.map((r) => `${r.reviewer_id.slice(0, 2)}->${r.reviewee_id.slice(0, 2)}:${r.visible}`)),
);

await seed();
for (const m of [M1, M2]) await hire(m);
await complete();
await review(POSTER, M1);
await review(M2, POSTER);
const cross = await all(`SELECT reviewer_id, feedback_visible_at <= now() AS visible FROM public.reviews WHERE job_id='${GJOB}'`);
check(
  "A21 M2's review of the poster does NOT reveal the poster's hidden review of M1 (the old reveal matched any review naming the reviewer)",
  cross.length === 2 && cross.every((r) => r.visible === false),
  JSON.stringify(cross.map((r) => `${r.reviewer_id.slice(0, 2)}:${r.visible}`)),
);

const a22 = await review(POSTER, M1, SJOB);
const a22b = await review(POSTER, M2, SJOB);
check("A22 a single-helper job is unchanged: the poster reviews the hired Helpr, nobody else", a22.ok && !a22b.ok, `${a22.error ?? "ok"} | ${a22b.error ?? "allowed"}`);

// ── Departures move no lead ─────────────────────────────────────────────────
await seed();
for (const m of [M1, M2]) await hire(m);
const a23 = await asUser(POSTER, `DELETE FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${M1}';`);
const a23app = (await one(`SELECT status FROM public.applications WHERE job_id='${GJOB}' AND helper_id='${M1}'`)).status;
check(
  "A23 the poster removes a member while staffing: application rejected, no lead appears",
  a23.ok && a23app === "rejected" && (await job()).helper_id === null,
  a23.ok ? `app=${a23app}, helper=${(await job()).helper_id}` : a23.error,
);

await seed({ needed: 2 });
for (const m of [M1, M2]) await hire(m);
const a24 = await asUser(M1, `SELECT public.helper_cancel_booking('${GJOB}');`);
const a24j = await job();
check(
  "A24 a member leaves a booked crew through helper_cancel_booking: off the roster, job reopens, no lead",
  a24.ok && a24j.status === "open" && a24j.helper_id === null &&
    (await all(`SELECT 1 FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${M1}'`)).length === 0,
  a24.ok ? JSON.stringify(a24j) : a24.error,
);

// The money lock's roster carve-out is gone: the flag no longer opens it.
const BOOKED = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, date_needed, start_time, payment_status, stripe_session_id)
               VALUES ('${BOOKED}', '${POSTER}', '${M1}', 'Paint a fence', 'accepted', 90, (now() + interval '4 days')::date, '09:00', 'escrow', 'cs_test_3')`);
const a25 = await asUser(POSTER, `SELECT set_config('app.roster_departure', 'on', true); UPDATE public.jobs SET helper_id = NULL WHERE id='${BOOKED}';`);
check("A25 app.roster_departure no longer lets a poster clear a funded job's Helpr", !a25.ok && /once checkout has opened/.test(a25.error), a25.error ?? "allowed");

// ── Crew notices ────────────────────────────────────────────────────────────
await seed();
for (const m of [M1, M2, M3]) await hire(m);
await db.exec(`UPDATE public.jobs SET status='in_progress' WHERE id='${GJOB}';
               UPDATE public.jobs SET status='completed', poster_completed_at=now(), helper_completed_at=now() WHERE id='${GJOB}';
               UPDATE public.jobs SET payment_status='released' WHERE id='${GJOB}';`);
const a26 = [];
for (const m of [M1, M2, M3]) a26.push({ done: (await noticesFor(m, "Job completed!")).length, paid: (await noticesFor(m, "Payout released")).length });
check("A26 completion and payout release reach every crew member, once each", a26.every((x) => x.done === 1 && x.paid === 1), JSON.stringify(a26));

// ── Tier ────────────────────────────────────────────────────────────────────
const tiers = await asUserRows(ADMIN, `SELECT user_id, completed_jobs, total_reviews FROM public.get_helper_tiers(50)`);
const m3tier = tiers.find((t) => t.user_id === M3);
check("A27 a Helpr who has only worked a crew is ranked, their crew job counted", !!m3tier && m3tier.completed_jobs === 1, JSON.stringify(m3tier ?? "absent"));

// ── Proof photos: every member files and reads; nobody touches another's ───
await seed();
for (const m of [M1, M2]) await hire(m);
const up1 = await asUser(M1, `INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', '${GJOB}/before-m1.jpg');`);
const up2 = await asUser(M2, `INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', '${GJOB}/before-m2.jpg');`);
const upOut = await asUser(OUTSIDER, `INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', '${GJOB}/before-x.jpg');`);
const posterSees = (await asUserRows(POSTER, `SELECT name FROM storage.objects WHERE bucket_id='proof-photos'`)).length;
const m1Sees = (await asUserRows(M1, `SELECT name FROM storage.objects WHERE bucket_id='proof-photos'`)).length;
await asUser(M1, `DELETE FROM storage.objects WHERE name = '${GJOB}/before-m2.jpg';`);
const m2Left = (await one(`SELECT count(*)::int AS n FROM storage.objects WHERE name = '${GJOB}/before-m2.jpg'`)).n;
check(
  "A29 every crew member uploads to the job's proof folder and reads it, the poster reads it; an outsider cannot upload; a member cannot delete another member's photo",
  up1.ok && up2.ok && !upOut.ok && posterSees === 2 && m1Sees === 2 && m2Left === 1,
  JSON.stringify({ m1: up1.error ?? "ok", m2: up2.error ?? "ok", outsider: upOut.error ?? "allowed", posterSees, m1Sees, m2Left }),
);
const setProof = await asUser(M2, `SELECT public.rpc_group_member_set_proof('${GJOB}', ARRAY['${GJOB}/before-m2.jpg'], NULL);`);
const slot = await one(`SELECT proof_before_urls FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${M2}'`);
check(
  "A30 the member's before photo lands on THEIR roster row through rpc_group_member_set_proof (the PhotoProof crew path)",
  setProof.ok && JSON.stringify(slot?.proof_before_urls) === JSON.stringify([`${GJOB}/before-m2.jpg`]),
  setProof.error ?? JSON.stringify(slot),
);

// ── HIGH-1: the crew's shape is locked, its shares frozen ───────────────────
await seed({ budget: 100 });
for (const m of [M1, M2, M3]) await hire(m);
const shares = await all(`SELECT helper_id, slot_no, share_cents FROM public.group_job_helpers WHERE job_id='${GJOB}' ORDER BY slot_no`);
check(
  "A31 three hires on $100 take slots 0,1,2 with frozen shares 3334/3333/3333 (exactly the budget)",
  shares.map((r) => `${r.slot_no}:${r.share_cents}`).join(",") === "0:3334,1:3333,2:3333",
  JSON.stringify(shares),
);
const lockN = await asUser(POSTER, `UPDATE public.jobs SET helpers_needed = 100 WHERE id='${GJOB}';`);
const lockG = await asUser(POSTER, `UPDATE public.jobs SET is_group_job = false WHERE id='${GJOB}';`);
const lockS = await asUser(POSTER, `UPDATE public.group_job_helpers SET share_cents = 999999 WHERE job_id='${GJOB}';`);
check(
  "A32 once funded and hired, the poster cannot change helpers_needed or is_group_job, nor any member's share",
  !lockN.ok && /crew_shape_locked/.test(lockN.error) && !lockG.ok && /crew_shape_locked/.test(lockG.error) && !lockS.ok && /crew_share_frozen/.test(lockS.error),
  JSON.stringify({ needed: lockN.error ?? "allowed", group: lockG.error ?? "allowed", share: lockS.error ?? "allowed" }),
);
await seed({ payment: "unpaid", apps: [] });
await db.exec(`UPDATE public.jobs SET stripe_session_id = NULL WHERE id='${GJOB}'`);
const draft = await asUser(POSTER, `UPDATE public.jobs SET helpers_needed = 4 WHERE id='${GJOB}';`);
check("A33 a draft nobody has paid for or been hired on can still change its crew size", draft.ok, draft.error ?? "");

await seed({ budget: 100, needed: 3 });
for (const m of [M1, M2]) await hire(m);
await asUser(M1, `SELECT public.helper_cancel_booking('${GJOB}');`);
await hire(M3);
const reslot = await all(`SELECT helper_id, slot_no, share_cents FROM public.group_job_helpers WHERE job_id='${GJOB}' ORDER BY slot_no`);
check(
  "A34 a departed member's slot is reused: the next hire takes slot 0 and its 3334",
  reslot.map((r) => `${r.slot_no}:${r.share_cents}`).join(",") === "0:3334,1:3333" && reslot[0].helper_id === M3,
  JSON.stringify(reslot),
);

// The split's twin: SQL crew_slot_share_cents == floor(T/N) + (slot < T mod N).
const jsShare = (t, n, k) => (t <= 0 ? 0 : Math.floor(t / n) + (k < t % n ? 1 : 0));
let twinBad = 0;
for (const t of [0, 1, 2, 99, 100, 101, 9999, 10000, 12345, 300000]) {
  for (let n = 1; n <= 8; n++) {
    const rows = await all(`SELECT k, public.crew_slot_share_cents(${t}, ${n}, k) AS c FROM generate_series(0, ${n - 1}) k`);
    const sum = rows.reduce((a, r) => a + r.c, 0);
    if (sum !== t || rows.some((r) => r.c !== jsShare(t, n, r.k))) twinBad++;
  }
}
check("A35 the SQL split sums to the total and matches floor(T/N) + (slot < T mod N) on 80 (total, N) pairs", twinBad === 0, `bad=${twinBad}`);

// ── MEDIUM-4: an under-filled crew completes when every hired member is done ─
await seed({ needed: 3 });
for (const m of [M1, M2]) await hire(m);
await db.exec(`UPDATE public.group_job_helpers SET helper_completed_at = now() WHERE job_id='${GJOB}' AND helper_id='${M1}'`);
const done2 = await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
const doneJ = await one(`SELECT status::text AS status, helper_completed_at FROM public.jobs WHERE id='${GJOB}'`);
check(
  "A36 two of three slots hired, both done: the crew completes (staffing closed, job-level done stamped)",
  done2.ok && doneJ.status === "accepted" && doneJ.helper_completed_at !== null,
  done2.ok ? JSON.stringify(doneJ) : done2.error,
);
await db.exec(`CREATE OR REPLACE FUNCTION public.crew_completes_when_hired_done() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;`);
await seed({ needed: 3 });
for (const m of [M1, M2]) await hire(m);
await db.exec(`UPDATE public.group_job_helpers SET helper_completed_at = now() WHERE job_id='${GJOB}' AND helper_id='${M1}'`);
await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
const notDone = await one(`SELECT status::text AS status, helper_completed_at FROM public.jobs WHERE id='${GJOB}'`);
check("A37 rule flipped to false: the under-filled crew does not complete", notDone.status === "open" && notDone.helper_completed_at === null, JSON.stringify(notDone));
await db.exec(`CREATE OR REPLACE FUNCTION public.crew_completes_when_hired_done() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;`);

// ── Auto-tip, split evenly across the crew ──────────────────────────────────
await seed({ budget: 300 });
for (const m of [M1, M2, M3]) await hire(m);
await db.exec(`UPDATE public.profiles SET auto_tip_mode='percent', auto_tip_value=10, auto_tip_enabled_at=now() - interval '1 day' WHERE user_id='${POSTER}';
               UPDATE public.jobs SET status='in_progress' WHERE id='${GJOB}';
               UPDATE public.jobs SET status='completed', completed_at=now() WHERE id='${GJOB}';`);
const tipsOwed = await all(`SELECT helper_id, tip_amount::text AS tip FROM public.auto_tip_candidates(336) WHERE job_id='${GJOB}' ORDER BY helper_id`);
await db.exec(`INSERT INTO public.tips (job_id, tipper_id, helper_id, amount, source, payment_status) VALUES ('${GJOB}', '${POSTER}', '${M1}', 10, 'auto', 'pending')`);
let secondClaim = "allowed";
try {
  await db.exec(`INSERT INTO public.tips (job_id, tipper_id, helper_id, amount, source, payment_status) VALUES ('${GJOB}', '${POSTER}', '${M2}', 10, 'auto', 'pending')`);
} catch (e) { secondClaim = String(e.message); }
let dupClaim = "allowed";
try {
  await db.exec(`INSERT INTO public.tips (job_id, tipper_id, helper_id, amount, source, payment_status) VALUES ('${GJOB}', '${POSTER}', '${M1}', 10, 'auto', 'pending')`);
} catch (e) { dupClaim = String(e.message); }
const after = await all(`SELECT helper_id FROM public.auto_tip_candidates(336) WHERE job_id='${GJOB}' ORDER BY helper_id`);
check(
  "A38 a 10% auto-tip on a $300 crew of 3 is $10.00 to each member; each member's claim is its own and can land once",
  JSON.stringify(tipsOwed.map((t) => t.tip)) === JSON.stringify(["10.00", "10.00", "10.00"]) &&
    secondClaim === "allowed" && /duplicate key|unique/i.test(dupClaim) && after.length === 1 && after[0].helper_id === M3,
  JSON.stringify({ tipsOwed, secondClaim, dupClaim: dupClaim.slice(0, 40), after: after.length }),
);

const acl = await one(`SELECT
  has_function_privilege('authenticated', 'public.enforce_group_job_has_no_lead()', 'EXECUTE') AS auth_lead,
  has_function_privilege('anon', 'public.enforce_group_job_has_no_lead()', 'EXECUTE') AS anon_lead,
  has_function_privilege('anon', 'public.poster_cancel_job(uuid,text)', 'EXECUTE') AS anon_cancel,
  has_function_privilege('authenticated', 'public.poster_cancel_job(uuid,text)', 'EXECUTE') AS auth_cancel,
  has_function_privilege('anon', 'public.accept_group_application(uuid,timestamptz,text)', 'EXECUTE') AS anon_hire,
  has_table_privilege('authenticated', 'public.crew_cancellation_fee_shares', 'INSERT') AS auth_ins,
  has_table_privilege('authenticated', 'public.crew_cancellation_fee_shares', 'UPDATE') AS auth_upd,
  has_table_privilege('anon', 'public.crew_cancellation_fee_shares', 'SELECT') AS anon_sel`);
check(
  "A28 grants: the invariant trigger takes no client EXECUTE; cancel and hire are authenticated-only; the ledger is read-only to clients",
  !acl.auth_lead && !acl.anon_lead && !acl.anon_cancel && acl.auth_cancel && !acl.anon_hire && !acl.auth_ins && !acl.auth_upd && !acl.anon_sel,
  JSON.stringify(acl),
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}${REPLAY ? " (migration applied 3x)" : ""}`);
process.exit(failures === 0 ? 0 : 1);
