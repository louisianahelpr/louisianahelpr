#!/usr/bin/env node
/**
 * PGlite proof for 20261003193541_accept_completes_after_stripe_setup
 * (docs/OPEN.md Q1180).
 *
 *   node src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs   # RED: prod as of 2026-10-03
 *     (skip mode runs every scenario against prod's definitions; reads of the
 *     new table answer "missing" instead of crashing, so each check prints)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * THE BEFORE STATE IS PROD, BYTE FOR BYTE. Built on the lh-authz-rls review
 * harness of 2026-10-03: every function below is the newest CREATE text in the
 * migrations tree before this migration, and the loader REFUSES to run unless
 * md5(prosrc) equals the md5 measured on prod that day (read-only SQL;
 * re-measured 16:05 CDT after lane B's 20261003180355 deployed). The jobs
 * triggers loaded are 15 of prod's 56: the ones whose functions can raise on
 * the statements under test (the lh-authz-rls re-review read every one of the
 * 56 on 2026-10-03; none of the others refuses them). Names, timing and UPDATE
 * OF lists are prod's (pg_trigger), and so are the jobs RLS policies the
 * scenarios touch. No triggers are loaded on applications, notifications or
 * profiles except this migration's own. Stubs, not under test: the two strike
 * ladders (they record a user_violations row so a strike is countable) and
 * dispute_stub, which runs open_dispute_as's single-job UPDATE verbatim from a
 * definer seat (the dispute RPC itself needs the disputes tables).
 *
 * Owner's spec (2026-10-02/03): the Hire sends the offer; the Helpr's Accept
 * completes only once payout setup AND Stripe ID are done (only what is
 * missing is asked for); the poster is told then; nothing starts before; no
 * strike while setup is unfinished.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261003193541_accept_completes_after_stripe_setup.sql";

/** md5(prosrc) of each function on prod, 2026-10-03. */
const LIVE_MD5 = {
  accept_application: "d68679cb6d8be1a5b2c912ed892316e3",
  are_users_blocked: "a0731c1a984038d3fab1f3b770188e36",
  decline_job_offer: "38cf17d53ca9f165f4c8c6536925919f",
  enforce_cancellation_requires_rpc: "e3483df66ebb3f9e5cf6d604823ebf2f",
  enforce_completion_on_live_job: "6df9c325796367f7a2c29d7a4f76edb5",
  enforce_confirm_on_live_job: "4dc3c4b7c928d41dfe5906b293d90031",
  enforce_dispute_markers_server_owned: "922c7ffb248184db3ed2a70c3809b275",
  enforce_helper_award_gate: "4302a2d45efbae4a343fb1cd64aaf7af",
  enforce_helper_completion_gates: "d7566dd58323c7cb9ced25b14d1f73b2",
  enforce_helper_jobs_column_whitelist: "75b799311e336bcc122f946e7edb2b7e",
  enforce_hire_columns_rpc_only: "87474e3cf21e67d47730445ac928d1b6",
  enforce_job_completion_server_owned: "866b9f98eaf9e9d69a612027ea1fca07",
  enforce_job_funded_before_award: "ef11151ef812eefbdacf38171968c1f2",
  enforce_job_status_transition: "cc3678a6d920dc3550f353124d4f518b",
  enforce_jobs_arrival_integrity: "cefad67792729fa3d50f6c0bc588e0da",
  enforce_poster_jobs_money_lock: "b7b148b29d821a0d7d3181066a3e88e6",
  expire_unanswered_offers: "52068b83a5be2f079c7e9eeb82b4d17c",
  has_role: "dae5cfc5a8d92461a428f6702e4e65af",
  helper_award_block_reason: "9b60c5c6e95d1e32d3b40ffb9b2cebdd",
  identity_is_verified: "9bb2ab5ef015d56a1a736e81151fe5ab",
  is_caller_banned: "aa2d685d4bf422d319d8134311feae32",
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  job_payment_is_funded: "bb3115be10e06f0b65e5bdaa21c37422",
  mark_helper_arrival: "ae22ef1d99e3ae09ef42248f4c7ab334",
  prevent_job_field_escalation: "083362af8d85fcd26d994bd4b142d60e",
  reject_other_applications_on_accept: "77d8801353cd9d70d69066fb06810af7",
  report_helper_no_show: "a550814ddd77e4684a8215f75b9c48af",
  respond_to_direct_offer: "f1fac99c32a5198584faa5dd80962589",
  rpc_helper_mark_done: "619c5250e3cbd2457747e7de764e66c7",
  stamp_job_accepted_at: "2e71c90119ee66f3363a69ca69d6a6cd",
};
// 20260925143327 rewrote respond_to_direct_offer's decline copy in place
// (regexp_replace); apply the same change, the md5 check proves the result.
const REWRITE = { respond_to_direct_offer: (s) => s.replace("The job is open to all helpers again.", "The job is open to everyone again.") };

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
function liveStmt(name) {
  const defs = defsOf(name);
  const hit = [...defs].reverse().find((d) => d.md5 === LIVE_MD5[name]);
  if (hit) return hit.stmt;
  if (REWRITE[name]) return REWRITE[name](defs.at(-1).stmt);
  throw new Error(`no prod-identical body for ${name} in the tree`);
}

const db = new PGlite();
let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };

const POSTER = "11111111-1111-1111-1111-111111111111";
const UNREADY = "22222222-2222-2222-2222-222222222222";   // nothing done
const READY = "33333333-3333-3333-3333-333333333333";     // payouts + Stripe ID
const PAYOUT_ONLY = "44444444-4444-4444-4444-444444444444"; // payouts, no ID yet
const OTHER = "55555555-5555-5555-5555-555555555555";     // a second applicant
const LATE = "66666666-6666-6666-6666-666666666666";      // nothing done (re-review scenarios)
const BANNED = "77777777-7777-7777-7777-777777777777";    // nothing done, then suspended
const NOFUND = "88888888-8888-8888-8888-888888888888";    // nothing done (the unfunded-job scenario)

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
  INSERT INTO auth.users VALUES ('${POSTER}'), ('${UNREADY}'), ('${READY}'), ('${PAYOUT_ONLY}'), ('${OTHER}'), ('${LATE}'), ('${BANNED}'), ('${NOFUND}');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean,
    stripe_identity_verified boolean, idv_status text, is_seed boolean DEFAULT false, full_name text,
    ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text NOT NULL, message text NOT NULL,
    stack text, url text, user_agent text, tags jsonb NOT NULL, context jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
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
    date_needed date, start_time time, is_seed boolean DEFAULT false, updated_at timestamptz);
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, full_name) VALUES
    ('${POSTER}', NULL, NULL, NULL, 'Pat Poster'),
    ('${UNREADY}', NULL, NULL, NULL, 'Una Unready'),
    ('${READY}', 'acct_ready', true, true, 'Rae Ready'),
    ('${PAYOUT_ONLY}', 'acct_po', true, false, 'Pia Payout'),
    ('${OTHER}', 'acct_other', true, true, 'Otto Other'),
    ('${LATE}', NULL, NULL, NULL, 'Lee Late'),
    ('${BANNED}', NULL, NULL, NULL, 'Ben Banned'),
    ('${NOFUND}', NULL, NULL, NULL, 'Nia Nofund');
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  -- Stubs (not under test).
  -- open_dispute_as's single-job UPDATE (20260927012240), verbatim, from a definer seat.
  CREATE FUNCTION public.dispute_stub(_job_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  DECLARE _uid uuid := auth.uid(); _reason text := 'stub'; _evidence_urls text[] := NULL;
  BEGIN
    UPDATE public.jobs
       SET status = 'disputed', disputed_by = _uid, disputed_at = now(), dispute_reason = _reason, dispute_status = 'open',
           dispute_evidence_urls = COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
     WHERE id = _job_id AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');
    IF NOT FOUND THEN RAISE EXCEPTION 'dispute_job_not_disputable'; END IF;
  END $$;
  -- Q807 gate attach (exists on prod; the migration calls it like every new-table migration).
  CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN INSERT INTO public.user_violations (user_id, job_id, violation_type, description) VALUES (p_helper, p_job, 'job_denial', p_description);
        RETURN jsonb_build_object('action', 'warning'); END $$;
  CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count int,
    p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days int, p_clamp_to_worse_status boolean,
    p_admin_message_format text, p_ban_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN INSERT INTO public.user_violations (user_id, job_id, violation_type, description) VALUES (p_user, p_job_id, p_violation_type, p_description);
        RETURN jsonb_build_object('action', 'warning', 'prior_count', p_prior_count); END $$;
`);

// Prod's function bodies, md5-checked, helpers first.
const NAMES = ["is_server_context", "has_role", "is_caller_banned", "job_payment_is_funded", "are_users_blocked", "helper_award_block_reason", "identity_is_verified",
  "enforce_helper_award_gate", "enforce_cancellation_requires_rpc", "enforce_completion_on_live_job", "enforce_confirm_on_live_job",
  "enforce_dispute_markers_server_owned", "enforce_job_status_transition", "enforce_helper_completion_gates",
  "enforce_helper_jobs_column_whitelist", "enforce_hire_columns_rpc_only", "enforce_job_funded_before_award",
  "stamp_job_accepted_at", "enforce_poster_jobs_money_lock", "prevent_job_field_escalation", "enforce_jobs_arrival_integrity",
  "enforce_job_completion_server_owned", "accept_application", "mark_helper_arrival", "rpc_helper_mark_done", "respond_to_direct_offer",
  "expire_unanswered_offers", "decline_job_offer", "report_helper_no_show", "reject_other_applications_on_accept"];
for (const n of NAMES) {
  await db.exec(liveStmt(n));
  const got = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [n])).rows[0].m;
  if (got !== LIVE_MD5[n]) throw new Error(`${n}: prosrc md5 ${got} != prod ${LIVE_MD5[n]}`);
}
check(true, `loaded ${NAMES.length} prod-identical function bodies (md5(prosrc) == prod 2026-10-03)`);

// Prod's triggers on jobs (pg_trigger 2026-10-03) and the policies the scenarios touch.
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
  CREATE TRIGGER zz_jobs_arrival_integrity BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_jobs_arrival_integrity();
  CREATE TRIGGER zz_jobs_completion_server_owned BEFORE INSERT OR UPDATE OF status, helper_completed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_job_completion_server_owned();
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Admins can view all jobs" ON public.jobs FOR SELECT TO authenticated USING (has_role((SELECT auth.uid()), 'admin'::app_role));
  CREATE POLICY "Targeted helper can view direct offer" ON public.jobs FOR SELECT TO authenticated USING ((offered_to_helper_id IS NOT NULL) AND (offered_to_helper_id = (SELECT auth.uid())) AND (direct_offer_status = 'pending') AND (status = 'open'::job_status) AND (helper_id IS NULL));
  CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated USING (((SELECT auth.uid()) = customer_id) OR ((SELECT auth.uid()) = helper_id));
  CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = customer_id);
  CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = helper_id) WITH CHECK ((SELECT auth.uid()) = helper_id);
  CREATE POLICY "Targeted helper can respond to direct offer" ON public.jobs FOR UPDATE TO authenticated USING ((offered_to_helper_id = (SELECT auth.uid())) AND (direct_offer_status = 'pending') AND (status = 'open'::job_status) AND (helper_id IS NULL));
`);

const NEW = process.env.NEW_MIGRATION !== "skip";
if (NEW) {
  const sql = readFileSync(MIGDIR + THIS, "utf8");
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(sql); check(true, `migration applies (run ${i})`); }
    catch (e) { check(false, `migration applies (run ${i}): ${e.message.split("\n")[0]}`); }
  }
}

async function as(uid, sql) {
  const setup = uid
    ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false);`
    : `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false);`;
  try { await db.exec(`BEGIN; ${setup} ${sql}; COMMIT;`); return "ok"; }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); return `ERR ${e.message.split("\n")[0]}`; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`); }
}
async function rpc(uid, sql) {
  const setup = `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false);`;
  try { await db.exec(`BEGIN; ${setup}`); const r = (await db.query(sql)).rows[0]; await db.exec("COMMIT"); return r; }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); return { error: e.message.split("\n")[0] }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`); }
}
const q = async (sql) => (await db.query(sql)).rows;
const row = async (id) => (await q(`SELECT status::text AS status, helper_id, helper_confirmed_at IS NOT NULL AS confirmed FROM public.jobs WHERE id = '${id}'`))[0];
const job = async (extra = "") => (await q(`INSERT INTO public.jobs (customer_id, payment_status, date_needed, start_time ${extra ? "," + extra.split("|")[0] : ""}) VALUES ('${POSTER}', 'escrow', (now() AT TIME ZONE 'America/Chicago')::date + 2, '09:00' ${extra ? "," + extra.split("|")[1] : ""}) RETURNING id`))[0].id;
const app = async (jobId, helper) => (await q(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${jobId}', '${helper}', 'pending') RETURNING id`))[0].id;
const hire = (a) => `SELECT public.accept_application('${a}', now() + interval '1 day', NULL)`;
const notes = async (user, jobId) => (await q(`SELECT title FROM public.notifications WHERE user_id = '${user}' AND job_id = '${jobId}' ORDER BY created_at`)).map((r) => r.title);
const strikes = async (user) => Number((await q(`SELECT count(*) AS n FROM public.user_violations WHERE user_id = '${user}'`))[0].n);
// The new table does not exist on prod's definitions (skip mode): -1, never a crash.
const pendingRows = async (jobId) => (await q(`SELECT to_regclass('public.job_accept_pending') IS NULL AS missing`))[0].missing
  ? -1 : (await q(`SELECT count(*)::int AS n FROM public.job_accept_pending WHERE job_id = '${jobId}'`))[0].n;
const pendingHelper = async (jobId) => (await q(`SELECT to_regclass('public.job_accept_pending') IS NULL AS missing`))[0].missing
  ? "missing" : (await q(`SELECT helper_id FROM public.job_accept_pending WHERE job_id = '${jobId}'`))[0]?.helper_id ?? null;

// ── 1. The Hire on an unready Helpr is an offer, never refused.
const j1 = await job(); const a1 = await app(j1, UNREADY); const o1 = await app(j1, OTHER);
check((await as(POSTER, hire(a1))) === "ok", "the poster's Hire on a Helpr with nothing set up goes through (an offer)");

// ── 2. The Helpr's Accept: thank-you state, only what is missing, poster not told.
let r = await rpc(UNREADY, `SELECT public.accept_job_offer('${j1}') AS r`);
check(r?.r?.state === "pending_setup" && JSON.stringify(r.r.missing) === JSON.stringify(["payout_setup", "stripe_id"]),
  `Accept with nothing done -> pending_setup, missing payout_setup + stripe_id (${JSON.stringify(r)})`);
check((await row(j1)).confirmed === false && (await notes(POSTER, j1)).length === 0, "the accept is not complete and the poster is not told yet");
check((await pendingRows(j1)) === 1, "one pending accept is recorded");

// ── 3. Nothing gets around the accept (review F1/F2/F3).
check((await as(UNREADY, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${j1}'`)).includes("helper_payout_setup_incomplete"), "a direct confirm PATCH by the unready Helpr is refused");
check((await as(UNREADY, `SELECT public.mark_helper_arrival('${j1}', NULL, NULL)`)).startsWith("ERR"), "F1: mark_helper_arrival cannot start an unaccepted job");
check((await as(UNREADY, `UPDATE public.jobs SET status = 'in_progress' WHERE id = '${j1}'`)).startsWith("ERR"), "F1: the Helpr cannot PATCH it to in_progress");
check((await as(POSTER, `UPDATE public.jobs SET status = 'in_progress' WHERE id = '${j1}'`)).startsWith("ERR"), "F1: the poster cannot PATCH it to in_progress");
check((await row(j1)).status === "accepted", "the job is still only offered");
const j2 = await job("offered_to_helper_id, direct_offer_status, direct_offer_expires_at|'" + UNREADY + "', 'pending', now() + interval '1 day'");
check((await as(UNREADY, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${j2}'`)).startsWith("ERR"), "F2: a confirmation pre-stamped on a direct offer is refused");
check((await as(UNREADY, `SELECT public.respond_to_direct_offer('${j2}', true)`)).startsWith("ERR"), "F2: and the direct offer's accept is still judged");

// ── 4. Stripe finishes: the accept completes by itself, once, and both are told.
await as(null, `UPDATE public.profiles SET stripe_account_id = 'acct_una', stripe_payouts_enabled = true WHERE user_id = '${UNREADY}'`);
check((await row(j1)).confirmed === false, "payout setup alone does not complete it (Stripe ID still missing)");
r = await rpc(UNREADY, `SELECT public.accept_job_offer('${j1}') AS r`);
check(JSON.stringify(r?.r?.missing) === JSON.stringify(["stripe_id"]), `a second tap asks only for what is still missing (${JSON.stringify(r)})`);
await as(null, `UPDATE public.profiles SET stripe_identity_verified = true WHERE user_id = '${UNREADY}'`);
const done1 = await row(j1);
check(done1.confirmed === true && done1.helper_id === UNREADY, "Stripe ID done -> the accept completes by itself");
check(JSON.stringify(await notes(POSTER, j1)) === JSON.stringify(["Una Unready accepted your offer"]), `the poster is told once, by name (${JSON.stringify(await notes(POSTER, j1))})`);
check(JSON.stringify(await notes(UNREADY, j1)) === JSON.stringify(["You're all set"]), "the Helpr is told the accept is complete");
check((await q(`SELECT status FROM public.applications WHERE id = '${o1}'`))[0].status === "rejected", "the other applicant learns the spot is taken");
check((await pendingRows(j1)) === 0, "the pending row is gone");

// ── 5. A ready Helpr's Accept completes at once; partly ready asks only for the rest.
const j3 = await job(); const a3 = await app(j3, READY);
await as(POSTER, hire(a3));
r = await rpc(READY, `SELECT public.accept_job_offer('${j3}') AS r`);
check(r?.r?.state === "accepted" && (await row(j3)).confirmed && JSON.stringify(await notes(POSTER, j3)) === JSON.stringify(["Rae Ready accepted your offer"]),
  `a Helpr with both done accepts at once and the poster is told (${JSON.stringify(r)})`);
const j4 = await job(); const a4 = await app(j4, PAYOUT_ONLY);
await as(POSTER, hire(a4));
r = await rpc(PAYOUT_ONLY, `SELECT public.accept_job_offer('${j4}') AS r`);
check(JSON.stringify(r?.r?.missing) === JSON.stringify(["stripe_id"]), `payouts done, no ID -> only the Stripe ID is asked for (${JSON.stringify(r)})`);

// ── 6. No strike while setup is unfinished; a ready Helpr's lapse still counts.
const s0 = await strikes(PAYOUT_ONLY);
await db.exec(`UPDATE public.jobs SET response_deadline = now() - interval '1 minute' WHERE id = '${j4}'`);
await as(null, `SELECT public.expire_unanswered_offers()`);
check((await row(j4)).status === "open" && (await strikes(PAYOUT_ONLY)) === s0, "an offer that lapses while setup is unfinished reopens with no strike");
const j5 = await job(); const a5 = await app(j5, READY);
await as(POSTER, hire(a5));
await db.exec(`UPDATE public.jobs SET response_deadline = now() - interval '1 minute' WHERE id = '${j5}'`);
const r0 = await strikes(READY);
await as(null, `SELECT public.expire_unanswered_offers()`);
check((await strikes(READY)) === r0 + 1, "a ready Helpr who lets an offer lapse still gets the strike (unchanged)");
const j6 = await job(); const a6 = await app(j6, PAYOUT_ONLY);
await as(POSTER, hire(a6));
const s1 = await strikes(PAYOUT_ONLY);
r = await rpc(PAYOUT_ONLY, `SELECT public.decline_job_offer('${a6}') AS r`);
check(r?.r?.action === "none" && (await strikes(PAYOUT_ONLY)) === s1, `declining while setup is unfinished is no strike (${JSON.stringify(r)})`);

// ── 7. No-show: never for a Helpr who never accepted; the reopen clears the booking (F3).
const pastJob = async (cols, vals) => (await q(`INSERT INTO public.jobs (customer_id, payment_status, date_needed, start_time, ${cols}) VALUES ('${POSTER}', 'escrow', (now() AT TIME ZONE 'America/Chicago')::date - 1, '09:00', ${vals}) RETURNING id`))[0].id;
const j7 = await pastJob("status, helper_id, response_deadline", `'accepted', '${UNREADY}', now() + interval '1 day'`);
r = await rpc(POSTER, `SELECT public.report_helper_no_show('${j7}') AS r`);
check(/helper_never_accepted/.test(r?.error ?? ""), `a no-show of a Helpr who never accepted is refused (${JSON.stringify(r)})`);
const j8 = await pastJob("status, helper_id, helper_confirmed_at", `'accepted', '${READY}', now() - interval '2 days'`);
r = await rpc(POSTER, `SELECT public.report_helper_no_show('${j8}') AS r`);
const after8 = await row(j8);
check(!r?.error && after8.status === "open" && after8.helper_id === null && after8.confirmed === false,
  `a real no-show reopens the job and clears the old confirmation (${JSON.stringify(r)} ${JSON.stringify(after8)})`);
const a8 = await app(j8, UNREADY);
check((await as(POSTER, hire(a8))) === "ok" && (await row(j8)).confirmed === false, "F3: the next Hire is a fresh, unaccepted offer");

// ── 9. The lh-authz-rls re-review (2026-10-03), R1-R6 and the gaps beside them.
const svc = (sql) => as(null, sql);
const booked = async (helper, status, confirmed) => {
  const id = await pastJob("status, helper_id, helper_confirmed_at", `'${status}', '${helper}', ${confirmed ? "now() - interval '2 days'" : "NULL"}`);
  const a = (await q(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${id}', '${helper}', 'accepted') RETURNING id`))[0].id;
  return { id, a };
};
// R1: a Helpr whose setup lapsed (payouts, no ID) declines a CONFIRMED booking.
const b1 = await booked(PAYOUT_ONLY, "accepted", true);
r = await rpc(PAYOUT_ONLY, `SELECT public.decline_job_offer('${b1.a}') AS r`);
const after1 = await row(b1.id);
check(/offer_not_active/.test(r?.error ?? "") && after1.status === "accepted" && after1.confirmed === true && after1.helper_id === PAYOUT_ONLY,
  `R1: decline refuses a confirmed booking, which stays booked (${JSON.stringify(r)})`);
// R2: the same walk-off on a job under way.
const b2 = await booked(PAYOUT_ONLY, "in_progress", true);
r = await rpc(PAYOUT_ONLY, `SELECT public.decline_job_offer('${b2.a}') AS r`);
check(/offer_not_active/.test(r?.error ?? "") && (await row(b2.id)).status === "in_progress", `R2: decline refuses a job under way (${JSON.stringify(r)})`);
// R3: a ready Helpr's decline of a confirmed booking: refused, no strike, stamps intact.
const b3 = await booked(READY, "accepted", true);
const r3s = await strikes(READY);
r = await rpc(READY, `SELECT public.decline_job_offer('${b3.a}') AS r`);
check(/offer_not_active/.test(r?.error ?? "") && (await row(b3.id)).confirmed === true && (await strikes(READY)) === r3s,
  `R3: a ready Helpr's decline of a confirmed booking is refused too (helper_cancel_booking owns that) (${JSON.stringify(r)})`);
// R5: a READY Helpr who never tapped Accept cannot start the job.
const j9 = await job(); const a9 = await app(j9, READY);
await as(POSTER, hire(a9));
check((await as(READY, `SELECT public.mark_helper_arrival('${j9}', NULL, NULL)`)).includes("accept_required"), "R5: mark_helper_arrival by a ready Helpr who never accepted is refused (accept_required)");
check((await as(READY, `UPDATE public.jobs SET status = 'in_progress' WHERE id = '${j9}'`)).includes("accept_required"), "R5: so is the Helpr's own PATCH to in_progress");
check((await row(j9)).status === "accepted" && (await notes(POSTER, j9)).length === 0, "R5: the job is still only offered and the poster heard nothing");
// #2b: nobody opens a dispute on an offer.
check((await as(POSTER, `SELECT public.dispute_stub('${j9}')`)).includes("accept_required"), "#2b: the poster cannot dispute an offer (escrow stays unfrozen)");
check((await as(READY, `SELECT public.dispute_stub('${j9}')`)).includes("accept_required"), "#2b: nor can the offered Helpr");
// R6: a Helpr whose accept is pending cannot close the other applicants.
const j10 = await job(); const a10 = await app(j10, LATE); const o10 = await app(j10, OTHER);
await as(POSTER, hire(a10));
r = await rpc(LATE, `SELECT public.accept_job_offer('${j10}') AS r`);
check(r?.r?.state === "pending_setup", `R6 setup: Lee's accept is pending (${JSON.stringify(r)})`);
check((await as(LATE, `SELECT public.reject_other_applications_on_accept('${j10}', '${a10}')`)).includes("caller is not the accepted helper"),
  "R6: reject_other_applications_on_accept refuses a Helpr who has not accepted");
check((await q(`SELECT status FROM public.applications WHERE id = '${o10}'`))[0].status === "pending", "R6: the other applicant is still pending");
// #13: a stale pending row for someone else is replaced by the Helpr who holds the offer.
await q(`DELETE FROM public.job_accept_pending WHERE job_id = '${j10}'`).catch(() => {});
await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${j10}', '${UNREADY}')`).catch(() => {});
r = await rpc(LATE, `SELECT public.accept_job_offer('${j10}') AS r`);
check((await pendingHelper(j10)) === LATE, `#13: a stale pending row naming another Helpr is replaced (${JSON.stringify(r)})`);
// R4: one job that cannot complete never rolls back the Stripe status write.
const j11 = await job(); const a11 = await app(j11, LATE);
await as(POSTER, hire(a11));
await rpc(LATE, `SELECT public.accept_job_offer('${j11}') AS r`);
await db.exec(`CREATE FUNCTION public.fail_one() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.job_id = '${j10}' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER zz_fail_one BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.fail_one();`);
const w4 = await svc(`UPDATE public.profiles SET stripe_account_id = 'acct_late', stripe_payouts_enabled = true, stripe_identity_verified = true WHERE user_id = '${LATE}'`);
await db.exec(`DROP TRIGGER zz_fail_one ON public.notifications; DROP FUNCTION public.fail_one();`);
const late = (await q(`SELECT stripe_payouts_enabled, stripe_identity_verified FROM public.profiles WHERE user_id = '${LATE}'`))[0];
check(w4 === "ok" && late.stripe_payouts_enabled === true && late.stripe_identity_verified === true, `R4: the Stripe status write commits even though one completion failed (${w4})`);
check((await row(j10)).confirmed === false && (await row(j11)).confirmed === true, "R4: the failing job stays pending, the other completes");
const logged = await q(`SELECT context->>'job_id' AS job FROM public.error_logs WHERE tags->>'source' = 'complete_pending_accepts_on_setup'`).catch(() => []);
check(logged.length === 1 && logged[0].job === j10, `R4: the failure is logged with its job (${JSON.stringify(logged)})`);
// #6: a pending accept does not complete under a ban in force; it does once the suspension has lapsed.
const j12 = await job(); const a12 = await app(j12, BANNED);
await as(POSTER, hire(a12));
r = await rpc(BANNED, `SELECT public.accept_job_offer('${j12}') AS r`);
await svc(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '3 days' WHERE user_id = '${BANNED}'`);
r = await rpc(BANNED, `SELECT public.accept_job_offer('${j12}') AS r`);
check(/account_restricted/.test(r?.error ?? ""), `#6: a suspended Helpr cannot tap Accept (${JSON.stringify(r)})`);
await svc(`UPDATE public.profiles SET stripe_account_id = 'acct_ben', stripe_payouts_enabled = true, stripe_identity_verified = true WHERE user_id = '${BANNED}'`);
check((await row(j12)).confirmed === false && (await notes(POSTER, j12)).length === 0, "#6: Stripe finishing during a suspension completes nothing; the poster hears nothing");
await svc(`UPDATE public.profiles SET auto_suspended_until = now() - interval '1 minute' WHERE user_id = '${BANNED}'`);
await svc(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = '${BANNED}'`);
check((await row(j12)).confirmed === true, "#6: once the suspension has lapsed, the next Stripe status write completes it");
// #7: never on an unfunded job, by either path.
const j13 = await job(); const a13 = await app(j13, NOFUND);
await as(POSTER, hire(a13));
r = await rpc(NOFUND, `SELECT public.accept_job_offer('${j13}') AS r`);
const pend13 = await pendingRows(j13);
await svc(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${j13}'`);
await svc(`UPDATE public.profiles SET stripe_account_id = 'acct_nia', stripe_payouts_enabled = true, idv_status = 'verified' WHERE user_id = '${NOFUND}'`);
check(pend13 === 1 && (await row(j13)).confirmed === false, "#7: a pending accept does not complete once the job is no longer funded");
const j14 = await pastJob("status, helper_id", `'accepted', '${READY}'`);
await q(`UPDATE public.jobs SET payment_status = 'unpaid' WHERE id = '${j14}'`);
r = await rpc(READY, `SELECT public.accept_job_offer('${j14}') AS r`);
check(/job_not_funded/.test(r?.error ?? ""), `#7: a ready Helpr's accept on an unfunded job names the reason (${JSON.stringify(r)})`);

// ── 8. Nobody can forge or skip the accept.
check((await as(POSTER, `INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${j3}', '${UNREADY}')`)).startsWith("ERR"), "a client cannot write a pending accept");
r = await rpc(POSTER, `SELECT public.accept_job_offer('${j8}') AS r`);
check(r?.error === "not_authorized", `the poster cannot accept on the Helpr's behalf (${JSON.stringify(r)})`);
// Skip mode: the two functions do not exist on prod's definitions; report, never crash.
const acl = (await q(`SELECT has_function_privilege('anon', 'public.accept_job_offer(uuid)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.complete_job_accept(uuid)', 'EXECUTE') AS complete_auth,
  has_function_privilege('authenticated', 'public.accept_job_offer(uuid)', 'EXECUTE') AS accept_auth
  WHERE to_regprocedure('public.accept_job_offer(uuid)') IS NOT NULL AND to_regprocedure('public.complete_job_accept(uuid)') IS NOT NULL`))[0] ?? {};
check(acl.anon === false && acl.complete_auth === false && acl.accept_auth === true, `only signed-in users call accept_job_offer; nobody calls complete_job_accept (${JSON.stringify(acl)})`);

console.log(`\n${fail ? "FAILED" : "ALL PASS"}: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
