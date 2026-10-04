#!/usr/bin/env node
/**
 * PGlite proof for 20261004001807_accept_stamp_needs_accept_rpc
 * (docs/OPEN.md Q1187 and Q1188).
 *
 *   node src/test/pglite/acceptGateHardening.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/acceptGateHardening.pglite.mjs   # RED: prod as of 2026-10-03
 *
 * Every check is tagged. [fix] states the new rule and FAILS on prod's
 * definitions (skip mode). [keep] states a door that must keep working, or a
 * refusal that already held, and passes in both modes: a fix that breaks a
 * legitimate writer of the confirmation is no fix.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * THE BEFORE STATE IS PROD, BYTE FOR BYTE. The loader is
 * acceptCompletesAfterStripeSetup.pglite.mjs's: each function is the newest
 * CREATE text in the tree before this migration whose md5(prosrc) equals the
 * md5 measured on prod (read-only SQL, 2026-10-03 ~19:20 CDT, after
 * 20261003193541 deployed), and it refuses to run otherwise. 20261003193541
 * (live) then runs verbatim for its table, policy and triggers, and every body
 * is checked against prod again. Triggers carry prod's names, timing and
 * UPDATE OF lists (pg_trigger): on jobs, the 15 the Q1180 harness loads (the
 * ones that can raise on these statements) plus trg_series_visit_within_end and
 * trg_stamp_recurring_series_helper for the series pickup; on applications,
 * trg_application_job_state (claim_series_dates' own flag is for it); and
 * Q1180's two. The four functions whose grants this migration restates carry
 * prod's ACLs (pg_proc.proacl). Stubs, not under test: the strike ladder (it
 * records a user_violations row, and raises 40P01 deadlock_detected for a job
 * listed in deadlock_on: PGlite has one connection, so it cannot deadlock for
 * real, and this is the error Postgres raises in the victim),
 * attach_unconfirmed_email_gate, early_access_cutoff, seed_jobs_hidden_publicly.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261004001807_accept_stamp_needs_accept_rpc.sql";
const Q1180 = "20261003193541_accept_completes_after_stripe_setup.sql";

/** md5(prosrc) of each function on prod, 2026-10-03 ~19:20 CDT. */
const LIVE_MD5 = {
  accept_application: "d68679cb6d8be1a5b2c912ed892316e3",
  accept_job_offer: "6c50f13fb3e88185076bd5007750c865",
  are_users_blocked: "a0731c1a984038d3fab1f3b770188e36",
  claim_series_dates: "acbc836d0f6467d3a99a770debe83405",
  clear_job_accept_pending: "859f3209f2ef86649c5b76369eabf91f",
  complete_job_accept: "e3afce8d2616ed2403c72e03c14754d5",
  complete_pending_accepts_on_setup: "a77a9adf74d39e51ca922155439a82e3",
  decline_job_offer: "a3df70810171c24786703ec426ebd4a7",
  enforce_application_job_state: "90f8b8bcc99d621e1e274a111cf3b6fc",
  enforce_cancellation_requires_rpc: "e3483df66ebb3f9e5cf6d604823ebf2f",
  enforce_completion_on_live_job: "6df9c325796367f7a2c29d7a4f76edb5",
  enforce_confirm_on_live_job: "4dc3c4b7c928d41dfe5906b293d90031",
  enforce_dispute_markers_server_owned: "922c7ffb248184db3ed2a70c3809b275",
  enforce_helper_award_gate: "bb8c57650d14c13d717c87f6e1029322",
  enforce_helper_completion_gates: "d7566dd58323c7cb9ced25b14d1f73b2",
  enforce_helper_jobs_column_whitelist: "75b799311e336bcc122f946e7edb2b7e",
  enforce_hire_columns_rpc_only: "87474e3cf21e67d47730445ac928d1b6",
  enforce_job_completion_server_owned: "866b9f98eaf9e9d69a612027ea1fca07",
  enforce_job_funded_before_award: "ef11151ef812eefbdacf38171968c1f2",
  enforce_job_status_transition: "cc3678a6d920dc3550f353124d4f518b",
  enforce_jobs_arrival_integrity: "cefad67792729fa3d50f6c0bc588e0da",
  enforce_poster_jobs_money_lock: "f936d9e26ff6a9f567f1a386e78ef644",
  enforce_series_visit_within_end: "3e5b13d58cafb9d089177fe5c4d8fdb8",
  error_log_is_seed: "e7814704b7ff26ed69c5277437c3dac0",
  expire_unanswered_offers: "0531b57b6bd427025a91baf88485873e",
  has_role: "dae5cfc5a8d92461a428f6702e4e65af",
  helper_accept_block_reason: "26619f23d795697aa6dd34ea54431031",
  helper_accept_missing: "2ab86b8501a741cd2c80e7cb321f90f4",
  identity_is_verified: "9bb2ab5ef015d56a1a736e81151fe5ab",
  is_caller_banned: "aa2d685d4bf422d319d8134311feae32",
  is_series_party: "2d0c43ceffcce998adc5f7916d2acfc0",
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  job_payment_is_funded: "bb3115be10e06f0b65e5bdaa21c37422",
  mark_helper_arrival: "ae22ef1d99e3ae09ef42248f4c7ab334",
  prevent_job_field_escalation: "083362af8d85fcd26d994bd4b142d60e",
  reject_other_applications_on_accept: "40178b6059fe5967fadec640efa19550",
  report_helper_no_show: "96f094f6f0c1fbb1cd96ae3e747aa931",
  respond_to_direct_offer: "f1fac99c32a5198584faa5dd80962589",
  series_visit_dates: "da96e223bf5d8ba57ce53e5d545ddcd0",
  stamp_job_accepted_at: "2e71c90119ee66f3363a69ca69d6a6cd",
  stamp_recurring_series_helper: "67acd22a8bfe20d7492a01d1ec8f4a4f",
};
// 20260925143327 rewrote respond_to_direct_offer's decline copy in place
// (regexp_replace); apply the same change, the md5 check proves the result.
const REWRITE = { respond_to_direct_offer: (s) => s.replace("The job is open to all helpers again.", "The job is open to everyone again.") };
/** prod's pg_proc.proacl (2026-10-03) for the functions whose grants this migration restates. */
const LIVE_ACL = {
  "accept_job_offer(uuid)": ["authenticated", "service_role"],
  "complete_job_accept(uuid)": ["service_role"],
  "enforce_helper_award_gate()": ["service_role"],
  "expire_unanswered_offers()": ["service_role"],
};

function defsOf(name) {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?"?${name}"?\\s*\\(`, "gi");
  const out = [];
  for (const f of readdirSync(MIGDIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(MIGDIR + f, "utf8");
    for (const m of sql.matchAll(re)) {
      const rest = sql.slice(m.index);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const bodyStart = open.index + open[0].length;
      const close = rest.indexOf(open[1], bodyStart);
      const body = rest.slice(bodyStart, close);
      out.push({ stmt: rest.slice(0, rest.indexOf(";", close + open[1].length) + 1), md5: createHash("md5").update(body).digest("hex") });
    }
  }
  return out;
}
/**
 * The newest tree text whose body is prod's, as written or after its in-place
 * rewrite. Every candidate is md5-checked, so a later restatement in the tree
 * (20261003214350 restates respond_to_direct_offer) is skipped, never loaded.
 */
function liveStmt(name) {
  const md5 = (stmt) => {
    const open = /\bAS\s+(\$\w*\$)/i.exec(stmt);
    const start = open.index + open[0].length;
    return createHash("md5").update(stmt.slice(start, stmt.indexOf(open[1], start))).digest("hex");
  };
  for (const d of [...defsOf(name)].reverse()) {
    if (d.md5 === LIVE_MD5[name]) return d.stmt;
    if (REWRITE[name]) {
      const rewritten = REWRITE[name](d.stmt);
      if (md5(rewritten) === LIVE_MD5[name]) return rewritten;
    }
  }
  throw new Error(`no prod-identical body for ${name} in the tree`);
}

const db = new PGlite();
let pass = 0, fail = 0;
const results = [];
const check = (cond, msg) => {
  results.push({ ok: !!cond, msg });
  if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); }
};

const POSTER = "11111111-1111-1111-1111-111111111111";
const UNREADY = "22222222-2222-2222-2222-222222222222"; // nothing set up
const READY = "33333333-3333-3333-3333-333333333333";   // payouts + Stripe ID
const OTHER = "55555555-5555-5555-5555-555555555555";   // a second applicant, ready
const LATE = "66666666-6666-6666-6666-666666666666";    // nothing set up, never changed (B3)
const SEEDH = "99999999-9999-9999-9999-999999999999";   // a seed/test Helpr (fixture carve-out: ready)

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  -- prod's pg_default_acl for functions postgres creates in public (measured 2026-10-03)
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
  INSERT INTO auth.users VALUES ('${POSTER}'), ('${UNREADY}'), ('${READY}'), ('${OTHER}'), ('${LATE}'), ('${SEEDH}');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean,
    stripe_identity_verified boolean, idv_status text, is_seed boolean DEFAULT false, full_name text,
    ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text NOT NULL DEFAULT 'error', message text NOT NULL,
    stack text, url text, user_agent text, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE TABLE public.user_violations (id uuid DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, violation_type text, description text, reported_by uuid, action_taken text);
  CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid, created_at timestamptz DEFAULT clock_timestamp());
  CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, message text, offer_message text, updated_at timestamptz, UNIQUE (job_id, helper_id));
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid,
    status public.job_status NOT NULL DEFAULT 'open', payment_status text, stripe_session_id text, stripe_payment_intent_id text,
    title text DEFAULT 'Fixture', budget numeric DEFAULT 50, urgent_fee numeric, is_group_job boolean DEFAULT false,
    helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, response_deadline timestamptz,
    dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz,
    offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, recurring_helper_id uuid,
    helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz,
    helper_arrival_near_miss_at timestamptz, helper_arrival_near_miss_ft int,
    poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
    helper_completed_at timestamptz, poster_completed_at timestamptz,
    require_photo_proof boolean DEFAULT true, proof_before_urls text[], proof_after_urls text[],
    latitude numeric, longitude numeric, accepted_at timestamptz,
    disputed_at timestamptz, disputed_by uuid, dispute_status text, dispute_deadline timestamptz, dispute_resolved_at timestamptz,
    dispute_reason text, dispute_helper_response text, dispute_evidence_urls text[],
    cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text,
    parent_job_id uuid REFERENCES public.jobs(id), recurrence_days smallint[], recurrence_weeks int, series_ended_on date,
    expires_at timestamptz, created_at timestamptz DEFAULT now(),
    date_needed date, start_time time, is_seed boolean DEFAULT false, updated_at timestamptz);
  -- the series tables claim_series_dates reads and writes (prod's columns)
  CREATE TABLE public.series_date_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_job_id uuid NOT NULL, helper_id uuid NOT NULL, offered_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.series_visit_holds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_job_id uuid NOT NULL, visit_date date NOT NULL, helper_id uuid NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (parent_job_id, visit_date));
  CREATE TABLE public.recurring_visit_releases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_job_id uuid NOT NULL, helper_id uuid NOT NULL, visit_date date NOT NULL,
    reason text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (parent_job_id, visit_date));
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, is_seed, full_name) VALUES
    ('${POSTER}', NULL, NULL, NULL, false, 'Pat Poster'),
    ('${UNREADY}', NULL, NULL, NULL, false, 'Una Unready'),
    ('${READY}', 'acct_ready', true, true, false, 'Rae Ready'),
    ('${OTHER}', 'acct_other', true, true, false, 'Otto Other'),
    ('${LATE}', NULL, NULL, NULL, false, 'Lee Late'),
    ('${SEEDH}', NULL, NULL, NULL, true, 'Sid Seed');
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  -- Stubs (not under test).
  CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - interval '1 hour' $$;
  CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.deadlock_on (job_id uuid PRIMARY KEY);
  CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, job_id, violation_type, description) VALUES (p_helper, p_job, 'job_denial', p_description);
    -- the Helpr's profile write is where accept_job_offer's FOR SHARE meets the sweep (Q1188)
    IF EXISTS (SELECT 1 FROM public.deadlock_on d WHERE d.job_id = p_job) THEN
      RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
    END IF;
    RETURN jsonb_build_object('action', 'warning');
  END $$;
  CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count int,
    p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days int, p_clamp_to_worse_status boolean,
    p_admin_message_format text, p_ban_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN INSERT INTO public.user_violations (user_id, job_id, violation_type, description) VALUES (p_user, p_job_id, p_violation_type, p_description);
        RETURN jsonb_build_object('action', 'warning', 'prior_count', p_prior_count); END $$;
`);

// Prod's function bodies, md5-checked, helpers first.
const NAMES = ["is_server_context", "has_role", "is_caller_banned", "job_payment_is_funded", "are_users_blocked", "identity_is_verified",
  "error_log_is_seed", "series_visit_dates", "is_series_party",
  "enforce_helper_award_gate", "enforce_cancellation_requires_rpc", "enforce_completion_on_live_job", "enforce_confirm_on_live_job",
  "enforce_dispute_markers_server_owned", "enforce_job_status_transition", "enforce_helper_completion_gates",
  "enforce_helper_jobs_column_whitelist", "enforce_hire_columns_rpc_only", "enforce_job_funded_before_award",
  "stamp_job_accepted_at", "enforce_poster_jobs_money_lock", "prevent_job_field_escalation", "enforce_jobs_arrival_integrity",
  "enforce_job_completion_server_owned", "enforce_series_visit_within_end", "stamp_recurring_series_helper", "enforce_application_job_state",
  "accept_application", "mark_helper_arrival", "respond_to_direct_offer", "claim_series_dates",
  "expire_unanswered_offers", "decline_job_offer", "report_helper_no_show", "reject_other_applications_on_accept"];
const md5Of = async (n) => (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [n])).rows[0]?.m;
for (const n of NAMES) {
  await db.exec(liveStmt(n));
  const got = await md5Of(n);
  if (got !== LIVE_MD5[n]) throw new Error(`${n}: prosrc md5 ${got} != prod ${LIVE_MD5[n]}`);
}

// Prod's triggers on jobs and applications (pg_trigger 2026-10-03) and the jobs policies the scenarios touch.
await db.exec(`
  CREATE TRIGGER jobs_award_gate BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_helper_award_gate();
  CREATE TRIGGER trg_cancellation_requires_rpc BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_cancellation_requires_rpc();
  CREATE TRIGGER trg_completion_on_live_job BEFORE UPDATE OF helper_completed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_completion_on_live_job();
  CREATE TRIGGER trg_confirm_on_live_job BEFORE UPDATE OF helper_confirmed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_confirm_on_live_job();
  CREATE TRIGGER trg_dispute_markers_server_owned BEFORE INSERT OR UPDATE OF status, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_resolved_at, dispute_reason, dispute_helper_response ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_dispute_markers_server_owned();
  CREATE TRIGGER trg_enforce_job_status_transition BEFORE UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_job_status_transition();
  CREATE TRIGGER trg_helper_completion_gates BEFORE UPDATE OF helper_completed_at, status ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_helper_completion_gates();
  CREATE TRIGGER trg_helper_jobs_column_whitelist BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_helper_jobs_column_whitelist();
  CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_hire_columns_rpc_only();
  CREATE TRIGGER trg_job_funded_before_award BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_job_funded_before_award();
  CREATE TRIGGER trg_jobs_stamp_accepted_at BEFORE INSERT OR UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION stamp_job_accepted_at();
  CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_poster_jobs_money_lock();
  CREATE TRIGGER trg_prevent_job_field_escalation BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION prevent_job_field_escalation();
  CREATE TRIGGER trg_series_visit_within_end BEFORE INSERT OR UPDATE OF helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_series_visit_within_end();
  CREATE TRIGGER trg_stamp_recurring_series_helper BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION stamp_recurring_series_helper();
  CREATE TRIGGER zz_jobs_arrival_integrity BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_jobs_arrival_integrity();
  CREATE TRIGGER zz_jobs_completion_server_owned BEFORE INSERT OR UPDATE OF status, helper_completed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_job_completion_server_owned();
  CREATE TRIGGER trg_application_job_state BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION enforce_application_job_state();
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Admins can view all jobs" ON public.jobs FOR SELECT TO authenticated USING (has_role((SELECT auth.uid()), 'admin'::app_role));
  CREATE POLICY "Targeted helper can view direct offer" ON public.jobs FOR SELECT TO authenticated USING ((offered_to_helper_id IS NOT NULL) AND (offered_to_helper_id = (SELECT auth.uid())) AND (direct_offer_status = 'pending') AND (status = 'open'::job_status) AND (helper_id IS NULL));
  CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated USING (((SELECT auth.uid()) = customer_id) OR ((SELECT auth.uid()) = helper_id));
  CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = customer_id);
  CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = helper_id) WITH CHECK ((SELECT auth.uid()) = helper_id);
  CREATE POLICY "Targeted helper can respond to direct offer" ON public.jobs FOR UPDATE TO authenticated USING ((offered_to_helper_id = (SELECT auth.uid())) AND (direct_offer_status = 'pending') AND (status = 'open'::job_status) AND (helper_id IS NULL));
`);

// 20261003193541 is live: its table, policy and triggers, verbatim. Its function
// bodies are the ones loaded above (prod's), so the md5 check after it holds.
await db.exec(readFileSync(MIGDIR + Q1180, "utf8"));
for (const n of ["accept_job_offer", "complete_job_accept", "complete_pending_accepts_on_setup", "clear_job_accept_pending",
  "helper_accept_missing", "helper_accept_block_reason", ...NAMES]) {
  const got = await md5Of(n);
  if (got !== LIVE_MD5[n]) throw new Error(`${n} after ${Q1180}: prosrc md5 ${got} != prod ${LIVE_MD5[n]}`);
}
for (const [fn, roles] of Object.entries(LIVE_ACL)) {
  await db.exec(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.${fn} TO ${roles.join(", ")};`);
}
check(true, `[keep] loaded ${NAMES.length + 6} prod-identical function bodies (md5(prosrc) == prod 2026-10-03), ${Q1180} applied verbatim`);

const NEW = process.env.NEW_MIGRATION !== "skip";
if (NEW) {
  const sql = readFileSync(MIGDIR + THIS, "utf8");
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(sql); check(true, `[fix] migration applies (run ${i})`); }
    catch (e) { check(false, `[fix] migration applies (run ${i}): ${e.message.split("\n")[0]}`); }
  }
}

const claims = (uid) => uid
  ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false);`
  : `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false);`;
const reset = `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`;
/** Run `sql` as `uid` (null = service role) in one transaction: "ok" or "ERR <first line>". */
async function as(uid, sql) {
  try { await db.exec(`BEGIN; ${claims(uid)} ${sql}; COMMIT;`); return "ok"; }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); return `ERR ${e.message.split("\n")[0]}`; }
  finally { await db.exec(reset); }
}
async function rpc(uid, sql) {
  try { await db.exec(`BEGIN; ${claims(uid)}`); const r = (await db.query(sql)).rows[0]; await db.exec("COMMIT"); return r; }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); return { error: e.message.split("\n")[0] }; }
  finally { await db.exec(reset); }
}
const q = async (sql) => (await db.query(sql)).rows;
const row = async (id) => (await q(`SELECT status::text AS status, helper_id, helper_confirmed_at IS NOT NULL AS confirmed FROM public.jobs WHERE id = '${id}'`))[0];
const job = async (extra = "") => (await q(`INSERT INTO public.jobs (customer_id, payment_status, date_needed, start_time ${extra ? "," + extra.split("|")[0] : ""}) VALUES ('${POSTER}', 'escrow', (now() AT TIME ZONE 'America/Chicago')::date + 2, '09:00' ${extra ? "," + extra.split("|")[1] : ""}) RETURNING id`))[0].id;
const app = async (jobId, helper, status = "pending") => (await q(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${jobId}', '${helper}', '${status}') RETURNING id`))[0].id;
const hire = (a) => `SELECT public.accept_application('${a}', now() + interval '1 day', NULL)`;
const notes = async (user, jobId) => (await q(`SELECT title FROM public.notifications WHERE user_id = '${user}' AND job_id = '${jobId}' ORDER BY created_at`)).map((r) => r.title);
const appStatus = async (id) => (await q(`SELECT status FROM public.applications WHERE id = '${id}'`))[0].status;
const strikesOn = async (jobId) => Number((await q(`SELECT count(*) AS n FROM public.user_violations WHERE job_id = '${jobId}'`))[0].n);
/** A fresh offer to `helper` on a funded job, plus a second applicant. */
async function offer(helper) {
  const id = await job(); const a = await app(id, helper); const o = await app(id, OTHER);
  const h = await as(POSTER, hire(a));
  if (h !== "ok") throw new Error(`fixture: the Hire failed (${h})`);
  return { id, a, o };
}
/** The client confirm PATCH useOfferHandlers' PGRST202 fallback sent (retired with this migration). */
const confirmPatch = (id, extra = "") =>
  `UPDATE public.jobs SET helper_confirmed_at = now(), response_deadline = NULL${extra} WHERE id = '${id}' AND status = 'accepted' AND helper_confirmed_at IS NULL AND (response_deadline IS NULL OR response_deadline > now())`;

// ── A. Q1187: the accept of an offer is written only by the accept RPC ────────
// A1. The exact PATCH the retired fallback sent, by a READY Helpr.
const a1 = await offer(READY);
let r = await as(READY, confirmPatch(a1.id));
let s = await row(a1.id);
check(r.includes("accept_required") && s.confirmed === false,
  `[fix] A1: a ready Helpr's direct PATCH of helper_confirmed_at is refused (accept_required) and the offer stays unconfirmed (${r}; confirmed=${s.confirmed}; poster notices ${JSON.stringify(await notes(POSTER, a1.id))}; other applicant ${await appStatus(a1.o)})`);
// A2. The same PATCH carrying status in_progress: confirmed AND started in one write.
const a2 = await offer(READY);
r = await as(READY, confirmPatch(a2.id, ", status = 'in_progress'"));
s = await row(a2.id);
check(r.includes("accept_required") && s.status === "accepted" && s.confirmed === false,
  `[fix] A2: the PATCH with status = 'in_progress' in the same write is refused; the job is still only offered (${r}; ${JSON.stringify(s)})`);
// A3. The PATCH, then mark_helper_arrival.
const a3 = await offer(READY);
const p3 = await as(READY, confirmPatch(a3.id));
const m3 = await as(READY, `SELECT public.mark_helper_arrival('${a3.id}', NULL, NULL)`);
s = await row(a3.id);
check(p3.includes("accept_required") && m3.includes("accept_required") && s.status === "accepted" && s.confirmed === false,
  `[fix] A3: PATCH then mark_helper_arrival cannot start the job (patch ${p3}; arrival ${m3}; ${JSON.stringify(s)})`);
check((await notes(POSTER, a1.id)).length === 0 && (await notes(POSTER, a2.id)).length === 0 && (await notes(POSTER, a3.id)).length === 0
  && (await appStatus(a1.o)) === "pending",
  "[keep] A1-A3: nothing told the poster \"accepted\", and the other applicant is untouched");
// A4. The flag covers complete_job_accept's one UPDATE, never a later write in the same transaction.
const a4x = await offer(READY); const a4y = await offer(READY);
r = await as(READY, `SELECT public.accept_job_offer('${a4x.id}'); ${confirmPatch(a4y.id)}`);
check(r.includes("accept_required") && (await row(a4y.id)).confirmed === false,
  `[fix] A4: after a real accept in the same transaction, a direct PATCH of another offer is still refused (${r})`);
// A5. A failed accept, caught by its caller, leaves no flag behind (the subtransaction takes it).
const a5x = await offer(READY); const a5y = await offer(READY);
await db.exec(`
  CREATE FUNCTION public.zz_fail_confirm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id = '${a5x.id}' AND NEW.helper_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER zz_fail_confirm BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.zz_fail_confirm();
  CREATE FUNCTION public.try_complete(p uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    IF to_regprocedure('public.complete_job_accept(uuid)') IS NULL THEN RETURN NULL; END IF;
    BEGIN PERFORM public.complete_job_accept(p); EXCEPTION WHEN OTHERS THEN RETURN false; END;
    RETURN true;
  END $$;`);
const t5 = await rpc(READY, `SELECT public.try_complete('${a5x.id}') AS r, current_setting('app.accept_rpc', true) AS flag`);
r = await as(READY, `SELECT public.try_complete('${a5x.id}'); ${confirmPatch(a5y.id)}`);
await db.exec(`DROP TRIGGER zz_fail_confirm ON public.jobs; DROP FUNCTION public.zz_fail_confirm();`);
check(t5?.r === false && (t5?.flag ?? "") !== "1" && r.includes("accept_required") && (await row(a5y.id)).confirmed === false,
  `[fix] A5: a failed accept caught by its caller leaves app.accept_rpc off; a PATCH after it is refused (${JSON.stringify(t5)}; ${r})`);

// The doors that must keep working.
// A6. accept_job_offer: a ready Helpr's accept completes, the poster is told, the others are closed.
const a6 = await offer(READY);
r = await rpc(READY, `SELECT public.accept_job_offer('${a6.id}') AS r`);
check(r?.r?.state === "accepted" && (await row(a6.id)).confirmed === true
  && JSON.stringify(await notes(POSTER, a6.id)) === JSON.stringify(["Rae Ready accepted your offer"]) && (await appStatus(a6.o)) === "rejected",
  `[keep] A6: accept_job_offer completes a ready Helpr's accept, tells the poster and closes the other application (${JSON.stringify(r)})`);
// A7. A pending accept completes when Stripe reports both done (the profiles trigger), whatever session writes the status.
const a7 = await offer(UNREADY);
r = await rpc(UNREADY, `SELECT public.accept_job_offer('${a7.id}') AS r`);
const w7 = await as(null, `UPDATE public.profiles SET stripe_account_id = 'acct_una', stripe_payouts_enabled = true, stripe_identity_verified = true WHERE user_id = '${UNREADY}'`);
check(r?.r?.state === "pending_setup" && w7 === "ok" && (await row(a7.id)).confirmed === true
  && JSON.stringify(await notes(POSTER, a7.id)) === JSON.stringify(["Una Unready accepted your offer"]),
  `[keep] A7: Stripe's status write (service role) completes the pending accept and the poster is told (${JSON.stringify(r)}; ${w7})`);
await q(`UPDATE public.profiles SET stripe_account_id = NULL, stripe_payouts_enabled = NULL, stripe_identity_verified = NULL WHERE user_id = '${UNREADY}'`);
const a7b = await offer(UNREADY);
await rpc(UNREADY, `SELECT public.accept_job_offer('${a7b.id}') AS r`);
await db.exec(`CREATE FUNCTION public.status_sync_stub(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.profiles SET stripe_account_id = 'acct_una2', stripe_payouts_enabled = true, stripe_identity_verified = true WHERE user_id = p $$;`);
const w7b = await as(UNREADY, `SELECT public.status_sync_stub('${UNREADY}')`);
check(w7b === "ok" && (await row(a7b.id)).confirmed === true,
  `[keep] A7b: the same completion run inside the Helpr's own request (a status write in a user session) still confirms (${w7b})`);
// A8. respond_to_direct_offer, prod's body as of 2026-10-03 (Q1185's migration, not landed that
// day, routes it through complete_job_accept): a ready Helpr's direct accept still completes.
const a8 = await job(`offered_to_helper_id, direct_offer_status, direct_offer_expires_at|'${READY}', 'pending', now() + interval '1 day'`);
r = await as(READY, `SELECT public.respond_to_direct_offer('${a8}', true)`);
s = await row(a8);
check(r === "ok" && s.status === "accepted" && s.helper_id === READY && s.confirmed === true,
  `[keep] A8: a ready Helpr's direct-offer accept (respond_to_direct_offer) still confirms (${r}; ${JSON.stringify(s)})`);
// A9. The one shape the gate admits without the flag (the caller taking an open job and
// confirming it) is out of a client's reach: on prod today trg_hire_columns_rpc_only refuses a
// client's helper_id (hire_requires_rpc); once 20261003214350 drops the targeted Helpr's UPDATE
// policy, RLS matches no row first. Judged by the outcome, so either layer counts. A stamp alone,
// with nobody on the job, is refused too.
const a9 = await job(`offered_to_helper_id, direct_offer_status, direct_offer_expires_at|'${READY}', 'pending', now() + interval '1 day'`);
const p9a = await as(READY, `UPDATE public.jobs SET helper_id = '${READY}', status = 'accepted', helper_confirmed_at = now() WHERE id = '${a9}'`);
const p9b = await as(READY, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${a9}'`);
s = await row(a9);
check(s.status === "open" && s.helper_id === null && s.confirmed === false && !p9a.startsWith("ERR accept_required"),
  `[keep] A9: the targeted Helpr cannot take the job and confirm it with a PATCH (${p9a}); a stamp alone writes nothing either (${p9b})`);
// A10. claim_series_dates: a Helpr on the series picks up a vacated visit, booked and confirmed in one write.
const d0 = (await q(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 3)::text AS d, EXTRACT(DOW FROM (now() AT TIME ZONE 'America/Chicago')::date + 3)::int AS dow`))[0];
const parent = (await q(`INSERT INTO public.jobs (customer_id, helper_id, status, payment_status, date_needed, start_time, recurrence_days, recurrence_weeks, recurring_helper_id, helper_confirmed_at)
  VALUES ('${POSTER}', '${OTHER}', 'accepted', 'escrow', '${d0.d}', '09:00', ARRAY[${d0.dow}]::smallint[], 4, '${OTHER}', now() - interval '1 day') RETURNING id`))[0].id;
// A VACATED visit: funded, open, nobody on it. On prod that is an un-assign UPDATE of a booked
// visit (trg_series_visit_within_end lets a NULL helper_id through); a fixture INSERT of it would
// meet that trigger's INSERT rule (a new visit has a holder), so the row is written with triggers off.
await db.exec(`SET session_replication_role = replica`);
const visit = (await q(`INSERT INTO public.jobs (customer_id, parent_job_id, status, payment_status, date_needed, start_time)
  VALUES ('${POSTER}', '${parent}', 'open', 'escrow', '${d0.d}'::date + 7, '09:00') RETURNING id`))[0].id;
await db.exec(`SET session_replication_role = origin`);
await q(`INSERT INTO public.series_date_offers (parent_job_id, helper_id) VALUES ('${parent}', '${READY}')`);
r = await rpc(READY, `SELECT public.claim_series_dates('${parent}', ARRAY['${d0.d}'::date + 7]) AS r`);
s = await row(visit);
const visitApp = (await q(`SELECT status FROM public.applications WHERE job_id = '${visit}' AND helper_id = '${READY}'`))[0]?.status;
check(JSON.stringify(r?.r?.claimed ?? null) === JSON.stringify([(await q(`SELECT ('${d0.d}'::date + 7)::text AS d`))[0].d])
  && s.status === "accepted" && s.helper_id === READY && s.confirmed === true && visitApp === "accepted",
  `[keep] A10: claim_series_dates still books and confirms a picked-up visit (${JSON.stringify(r)}; ${JSON.stringify(s)}; application ${visitApp})`);
// A11. scripts/ci/race-runner.mjs race 2's write: the accept's own UPDATE (flag on) with no status
// predicate, so trg_confirm_on_live_job stays the guarantee under test.
const raceWrite = (id) => `SELECT set_config('app.accept_rpc', '1', true); UPDATE public.jobs SET helper_confirmed_at = now(), response_deadline = NULL WHERE id = '${id}' AND helper_confirmed_at IS NULL`;
const a11 = await offer(READY);
const c11 = await as(READY, raceWrite(a11.id));
const x11 = await job(`status, helper_id, cancelled_at|'cancelled', '${READY}', now()`);
const k11 = await as(READY, raceWrite(x11));
check(c11 === "ok" && (await row(a11.id)).confirmed === true && k11.includes("job_not_confirmable") && (await row(x11)).confirmed === false,
  `[keep] A11: race 2's flagged write lands on a live offer (control: ${c11}) and is refused on a cancelled job (${k11})`);
// A12. Server writes are not judged (charge-recurring-visits' booked visits, admin tooling).
const a12 = await offer(READY);
r = await as(null, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${a12.id}'`);
check(r === "ok" && (await row(a12.id)).confirmed === true, `[keep] A12: a service-role write of the confirmation is not judged (${r})`);
// A13. The poster never confirms for the Helpr.
const a13 = await offer(READY);
r = await as(POSTER, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${a13.id}'`);
check(r.startsWith("ERR") && (await row(a13.id)).confirmed === false, `[keep] A13: the poster cannot write the Helpr's confirmation (${r})`);
// A14. Grants: nobody but the server calls the completion, the gate or the sweep.
const acl = (await q(`SELECT
    has_function_privilege('authenticated', 'public.complete_job_accept(uuid)', 'EXECUTE') AS complete_auth,
    has_function_privilege('anon', 'public.complete_job_accept(uuid)', 'EXECUTE') AS complete_anon,
    has_function_privilege('authenticated', 'public.expire_unanswered_offers()', 'EXECUTE') AS sweep_auth,
    has_function_privilege('anon', 'public.expire_unanswered_offers()', 'EXECUTE') AS sweep_anon,
    has_function_privilege('service_role', 'public.expire_unanswered_offers()', 'EXECUTE') AS sweep_svc,
    has_function_privilege('authenticated', 'public.enforce_helper_award_gate()', 'EXECUTE') AS gate_auth,
    has_function_privilege('authenticated', 'public.accept_job_offer(uuid)', 'EXECUTE') AS accept_auth`))[0];
check(!acl.complete_auth && !acl.complete_anon && !acl.sweep_auth && !acl.sweep_anon && acl.sweep_svc && !acl.gate_auth && acl.accept_auth,
  `[keep] A14: only the server calls complete_job_accept, the gate and the sweep; signed-in users call accept_job_offer (${JSON.stringify(acl)})`);

// ── B. Q1188: one offer that cannot expire never rolls back the sweep ──────────
const lapsed = async (helper, seed = false) => {
  const id = await job(`status, helper_id, response_deadline, is_seed|'accepted', '${helper}', now() - interval '1 minute', ${seed}`);
  await app(id, helper, "accepted");
  return id;
};
// B1. Two lapsed offers of a ready Helpr; the strike for one of them deadlocks.
const bFail = await lapsed(READY); const bOk = await lapsed(READY);
await q(`INSERT INTO public.deadlock_on VALUES ('${bFail}')`);
r = await rpc(null, `SELECT public.expire_unanswered_offers() AS n`);
const sFail = await row(bFail); const sOk = await row(bOk);
check(sOk.status === "open" && sOk.helper_id === null,
  `[fix] B1: the sweep still expires the other offer when one deadlocks (${JSON.stringify(r)}; other ${JSON.stringify(sOk)})`);
check(r?.n === 1 && sFail.status === "accepted" && sFail.helper_id === READY && (await strikesOn(bFail)) === 0 && (await notes(READY, bFail)).length === 0
  && (await strikesOn(bOk)) === 1 && JSON.stringify(await notes(READY, bOk)) === JSON.stringify(["You lost a job offer"]),
  `[fix] B1: only the deadlocked offer rolls back (still offered, no strike, nobody told), and the count says 1 (fail ${JSON.stringify(sFail)})`);
const logB1 = await q(`SELECT severity, tags, context FROM public.error_logs WHERE context->>'job_id' = '${bFail}'`);
check(logB1.length === 1 && logB1[0].severity === "error" && logB1[0].tags.source === "expire_unanswered_offers"
  && logB1[0].context.sqlstate === "40P01" && logB1[0].context.helper_id === READY,
  `[fix] B1: the failure is logged with its job, Helpr and SQLSTATE (${JSON.stringify(logB1)})`);
// B2. Seed offers (a seed job, or a seed Helpr) log under the '-seed' source, kept out of Slack.
const bSeedJob = await lapsed(READY, true); const bSeedHelpr = await lapsed(SEEDH);
await q(`INSERT INTO public.deadlock_on VALUES ('${bSeedJob}'), ('${bSeedHelpr}')`);
r = await rpc(null, `SELECT public.expire_unanswered_offers() AS n`);
const logB2 = await q(`SELECT context->>'job_id' AS job, severity, tags, public.error_log_is_seed(tags) AS seed FROM public.error_logs
  WHERE context->>'job_id' IN ('${bSeedJob}', '${bSeedHelpr}') ORDER BY 1`);
check(logB2.length === 2 && logB2.every((l) => l.severity === "info" && l.tags.source === "expire_unanswered_offers-seed" && l.seed === true),
  `[fix] B2: a seed job's and a seed Helpr's failure log as info under 'expire_unanswered_offers-seed' (${JSON.stringify(logB2)})`);
// B3. Unchanged: with nothing failing, the sweep expires every lapsed offer, strikes a ready Helpr, not an unready one.
await q(`DELETE FROM public.deadlock_on`);
const bReady = await lapsed(READY); const bUnready = await lapsed(LATE);
r = await rpc(null, `SELECT public.expire_unanswered_offers() AS n`);
check((await row(bReady)).status === "open" && (await row(bUnready)).status === "open" && (await strikesOn(bReady)) === 1 && (await strikesOn(bUnready)) === 0,
  `[keep] B3: with nothing failing every lapsed offer expires; the ready Helpr's lapse is a strike, the unready one's is not (${JSON.stringify(r)})`);

const fixFails = results.filter((x) => !x.ok && x.msg.startsWith("[fix]")).length;
const keepFails = results.filter((x) => !x.ok && x.msg.startsWith("[keep]")).length;
const fixTotal = results.filter((x) => x.msg.startsWith("[fix]")).length;
console.log(`\n${NEW ? "WITH the migration (3x)" : "PROD's definitions (NEW_MIGRATION=skip)"}: ${pass} pass, ${fail} fail ([fix] ${fixTotal - fixFails}/${fixTotal} pass, [keep] failures ${keepFails})`);
console.log(fail ? "FAILED" : "ALL PASS");
process.exit(fail ? 1 : 0);
