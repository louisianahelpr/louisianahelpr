#!/usr/bin/env node
/**
 * PGlite proof for 20261025162003_payout_after_hire (payout setup moves from
 * sign-up to the hire, owner 2026-10-25).
 *
 *   node src/test/pglite/payoutAfterHire.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/payoutAfterHire.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/payoutAfterHire.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Applies the REAL hidden-switch registry (20261012031120), the real
 * payout_setup and identity_check switches (20261023201657, 20261023213857) on
 * prod-shaped stubs, then the new migration 3x (replay-safe), and proves:
 *   (A) payout_setup_hire_allowed: only a member chosen for a job that holds
 *       money (Helpr or crew seat), with an accept waiting, with a recorded
 *       payout, or with Declutter/Shops/Rentals on; never an unfunded offer,
 *       a refunded job or nobody; service role only; the _for_me twin answers
 *       for the caller only and anon cannot call it;
 *   (B) payout_after_hire is created TESTERS; helper_accept_missing lists
 *       nothing for a tester (the accept goes ahead) and is unchanged for an
 *       ordinary member;
 *   (C) with identity_check on, the ID check gates the PAYOUT for a tester
 *       (payout_transfers claim refused payout_held) and not their accept;
 *       an admin payout hold still refuses; identity_check off adds nothing;
 *   (D) claim_payout_setup_reminders: nothing while payout_setup is off; a
 *       hired tester with no account gets 'hired' once, then day1/day3/day7
 *       on schedule, at most one a day, and one 'money' per job whose payout
 *       waits; never an ordinary member, a ready Helpr, a fixture seat or
 *       someone not hired; service role only;
 *   (E) connect_account_retirements and payout_setup_reminders: no client
 *       role can read or write them.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const REGISTRY = readFileSync(url("20261012031120_hidden_feature_switches.sql"), "utf8");
const PAYOUT_SWITCH = readFileSync(url("20261023201657_payout_setup_switch.sql"), "utf8");
const ID_SWITCH = readFileSync(url("20261023213857_identity_check_switch.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261025162003_payout_after_hire.sql"), "utf8");

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, stripe_account_id text,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false, stripe_identity_verified boolean NOT NULL DEFAULT false, idv_status text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, customer_id uuid, helper_id uuid, status text NOT NULL DEFAULT 'accepted', payment_status text,
  cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL);
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  stripe_transfer_id text, status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text NOT NULL DEFAULT 'r');
CREATE TABLE public.cancellation_fee_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.crew_cancellation_fee_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.crew_block_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.job_payout_holds (job_id uuid PRIMARY KEY, reason text);
CREATE FUNCTION public.job_payment_is_funded(p_payment_status text) RETURNS boolean LANGUAGE sql IMMUTABLE
  AS $$ SELECT COALESCE(p_payment_status, '') = ANY (ARRAY['escrow', 'payout_pending', 'released']) $$;
CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean) RETURNS boolean LANGUAGE sql IMMUTABLE
  AS $$ SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL $$;
-- The live trigger (prod pg_trigger 2026-10-25), on a placeholder the migration replaces.
CREATE FUNCTION public.refuse_payout_claim_while_held() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER refuse_payout_claim_while_held BEFORE INSERT ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION public.refuse_payout_claim_while_held();
`;

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const TESTER = id(2); // a test account (not seed): the switch's audience
const ORDINARY = id(3);
const ESCROW_H = id(4);
const UNPAID_H = id(5);
const REFUNDED_H = id(6);
const CREW_H = id(7);
const PENDING_H = id(8);
const PAID_H = id(9);
const FEE_H = id(10);
const SEAT = id(11); // fixture seat: seed + test account, no account
const READY_TESTER = id(12);
const IDLE_TESTER = id(13); // a tester nobody hired
const PAYOUT_H = id(14);
const CREW_UNPAID_H = id(15);
const RELEASED_H = id(16);
const FAKE_FEE_H = id(17); // a job whose poster set cancellation_fee_status themselves, no fee row
const CREW_FEE_H = id(18);
const STALE_PENDING_H = id(19); // an accept pending on a job since refunded
const ALL = [ADMIN, TESTER, ORDINARY, ESCROW_H, UNPAID_H, REFUNDED_H, CREW_H, PENDING_H, PAID_H, FEE_H, SEAT, READY_TESTER, IDLE_TESTER, PAYOUT_H, CREW_UNPAID_H, RELEASED_H, FAKE_FEE_H, CREW_FEE_H, STALE_PENDING_H];

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`
  INSERT INTO auth.users (id) VALUES ${ALL.map((u) => `('${u}')`).join(",")};
  INSERT INTO public.profiles (user_id) VALUES ${ALL.map((u) => `('${u}')`).join(",")};
  UPDATE public.profiles SET is_seed = true WHERE user_id = '${SEAT}';
  UPDATE public.profiles SET stripe_account_id = 'acct_ready', stripe_payouts_enabled = true WHERE user_id = '${READY_TESTER}';
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
  INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}'), ('${SEAT}'), ('${READY_TESTER}'), ('${IDLE_TESTER}');
`);
await db.exec(REGISTRY);
await db.exec(PAYOUT_SWITCH);
await db.exec(ID_SWITCH);

const JOB_ESCROW = id(101), JOB_UNPAID = id(102), JOB_REFUNDED = id(103), JOB_CREW = id(104), JOB_PENDING = id(105),
  JOB_FEE = id(106), JOB_TESTER = id(107), JOB_SEAT = id(108), JOB_READY = id(109), JOB_PAYOUT = id(110), JOB_TESTER_PAYOUT = id(111),
  JOB_CREW_UNPAID = id(112), JOB_RELEASED = id(113), JOB_FAKE_FEE = id(114), JOB_STALE = id(115);
await db.exec(`
  INSERT INTO public.jobs (id, title, helper_id, payment_status, cancellation_fee_status) VALUES
    ('${JOB_ESCROW}', 'Escrow job', '${ESCROW_H}', 'escrow', NULL),
    ('${JOB_UNPAID}', 'Unpaid offer', '${UNPAID_H}', 'unpaid', NULL),
    ('${JOB_REFUNDED}', 'Refunded', '${REFUNDED_H}', 'refunded', NULL),
    ('${JOB_CREW}', 'Crew job', NULL, 'escrow', NULL),
    ('${JOB_CREW_UNPAID}', 'Crew unpaid', NULL, 'unpaid', NULL),
    ('${JOB_PENDING}', 'Direct offer', NULL, 'escrow', NULL),
    ('${JOB_STALE}', 'Refunded offer', NULL, 'refunded', NULL),
    ('${JOB_FAKE_FEE}', 'Poster-set fee', '${FAKE_FEE_H}', 'unpaid', 'pending'),
    ('${JOB_FEE}', 'Cancelled with a fee', '${FEE_H}', 'cancelled', 'pending'),
    ('${JOB_TESTER}', 'Tester hire', '${TESTER}', 'escrow', NULL),
    ('${JOB_SEAT}', 'Seat hire', '${SEAT}', 'escrow', NULL),
    ('${JOB_READY}', 'Ready hire', '${READY_TESTER}', 'escrow', NULL),
    ('${JOB_PAYOUT}', 'Payout pending', '${PAYOUT_H}', 'payout_pending', NULL),
    ('${JOB_RELEASED}', 'Released', '${RELEASED_H}', 'released', NULL);
  INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${JOB_CREW}', '${CREW_H}'), ('${JOB_CREW_UNPAID}', '${CREW_UNPAID_H}');
  INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${JOB_PENDING}', '${PENDING_H}'), ('${JOB_STALE}', '${STALE_PENDING_H}');
  INSERT INTO public.cancellation_fee_transfers (job_id, helper_id, status) VALUES ('${JOB_FEE}', '${FEE_H}', 'failed');
  INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, status) VALUES ('${JOB_CREW_UNPAID}', '${CREW_FEE_H}', 'failed');
  INSERT INTO public.payout_transfers (job_id, helper_id, stripe_transfer_id, status) VALUES (NULL, '${PAID_H}', 'tr_1', 'paid');
`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const q = async (sql) => {
  try {
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  }
};
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const setAudience = async (key, audience) => {
  const r = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('${key}', '${audience}') AS v`);
  if (!Array.isArray(r)) console.log(`(could not set ${key}: ${r.error})`);
};

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

// ── (A) who may open a payout account ──
const allowed = async (uid) => {
  const r = await q(`SELECT public.payout_setup_hire_allowed(${uid ? `'${uid}'` : "NULL"}) AS v`);
  return Array.isArray(r) ? r[0].v : r;
};
ok((await allowed(ORDINARY)) === false, "(A) a member nobody hired may not open a payout account");
ok((await allowed(NULL_SAFE())) === false, "(A) a NULL member is never allowed");
ok((await allowed(UNPAID_H)) === false, "(A) an unfunded offer (no money in it) does not unlock an account");
ok((await allowed(REFUNDED_H)) === false, "(A) a refunded job does not unlock an account");
ok((await allowed(CREW_UNPAID_H)) === false, "(A) a crew seat on an unfunded job does not unlock an account");
ok((await allowed(ESCROW_H)) === true, "(A) the Helpr on a job whose payment is held may set up payouts");
ok((await allowed(PAYOUT_H)) === true, "(A) the Helpr on a payout_pending job may set up payouts");
ok((await allowed(RELEASED_H)) === true, "(A) the Helpr on a released job may set up payouts");
ok((await allowed(CREW_H)) === true, "(A) a crew seat on a funded job may set up payouts");
ok((await allowed(PENDING_H)) === true, "(A) an accept waiting on setup may set up payouts");
ok((await allowed(PAID_H)) === true, "(A) a member with a recorded payout may set up payouts");
ok((await allowed(FEE_H)) === true, "(A) a Helpr owed a cancellation fee (a server-written fee row) may set up payouts");
ok((await allowed(CREW_FEE_H)) === true, "(A) a crew member owed a cancellation fee share may set up payouts (lh-money-escrow #2)");
ok((await allowed(FAKE_FEE_H)) === false, "(A) a cancellation_fee_status a poster set on an unfunded job unlocks nothing (lh-authz-rls #4)");
ok((await allowed(STALE_PENDING_H)) === false, "(A) an accept pending on a job since refunded unlocks nothing (lh-authz-rls #2)");
ok((await allowed(IDLE_TESTER)) === false, "(A) a tester nobody hired, with no seller section on, is not allowed");
await db.exec(`INSERT INTO public.feature_switches (key, audience, description) VALUES ('declutter', 'testers', 'x') ON CONFLICT (key) DO NOTHING;`);
ok((await allowed(IDLE_TESTER)) === true, "(A) Declutter on for a member (a seller) allows setup (lead answer 3(i))");
ok((await allowed(ORDINARY)) === false, "(A) ...and not for a member it is off for");
const direct = await as("authenticated", ORDINARY, `SELECT public.payout_setup_hire_allowed('${ESCROW_H}')`);
ok(!Array.isArray(direct) && /permission denied/.test(direct.error), "(A) a member cannot ask payout_setup_hire_allowed about anyone (service role only)");
const mine = await as("authenticated", ESCROW_H, `SELECT public.payout_setup_hire_allowed_for_me() AS v`);
ok(Array.isArray(mine) && mine[0].v === true, "(A) _for_me answers true for the hired caller");
const mineNo = await as("authenticated", ORDINARY, `SELECT public.payout_setup_hire_allowed_for_me() AS v`);
ok(Array.isArray(mineNo) && mineNo[0].v === false, "(A) _for_me answers false for a member nobody hired");
const anonMine = await as("anon", null, `SELECT public.payout_setup_hire_allowed_for_me()`);
ok(!Array.isArray(anonMine) && /permission denied/.test(anonMine.error), "(A) anon cannot call _for_me");

// ── (B) the switch and the accept ──
const aud = await q(`SELECT audience FROM public.feature_switches WHERE key = 'payout_after_hire'`);
ok(Array.isArray(aud) && aud[0]?.audience === "testers", "(B) payout_after_hire exists, created TESTERS, after 3 applies");
const missing = async (uid) => {
  const r = await q(`SELECT public.helper_accept_missing('${uid}') AS v`);
  return Array.isArray(r) ? JSON.stringify(r[0].v) : r.error;
};
ok((await missing(ORDINARY)) === JSON.stringify(["payout_setup"]), "(B) an ordinary member's accept still waits on payout setup");
ok((await missing(TESTER)) === "[]", "(B) a tester's accept goes ahead with no payout account (nothing missing)");
ok((await missing(ADMIN)) === "[]", "(B) an admin's accept goes ahead too");
ok((await missing(id(999))) === JSON.stringify(["unknown"]), "(B) an unknown member is still 'unknown'");
await setAudience("identity_check", "everyone");
ok((await missing(ORDINARY)) === JSON.stringify(["payout_setup", "stripe_id"]), "(B) identity_check on: an ordinary member's accept waits on payout + ID, as before");
ok((await missing(TESTER)) === "[]", "(B) identity_check on: a tester's accept does NOT wait on the ID (it gates the payout)");

// ── (C) the ID check gates the payout instead ──
const claim = async (uid, jobId) => q(`INSERT INTO public.payout_transfers (job_id, helper_id) VALUES ('${jobId}', '${uid}') RETURNING id`);
const tClaim = await claim(TESTER, JOB_TESTER);
ok(!Array.isArray(tClaim) && /payout_held/.test(tClaim.error) && tClaim.code === "23514", "(C) identity_check on: a tester's unverified payout claim is refused payout_held 23514");
await db.exec(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = '${TESTER}'`);
const tClaim2 = await claim(TESTER, JOB_TESTER);
ok(Array.isArray(tClaim2) && tClaim2.length === 1, "(C) ...and goes through once the ID check is verified");
await db.exec(`DELETE FROM public.payout_transfers WHERE helper_id = '${TESTER}'; UPDATE public.profiles SET idv_status = NULL WHERE user_id = '${TESTER}'`);
const oClaim = await claim(ORDINARY, JOB_ESCROW);
ok(Array.isArray(oClaim), "(C) an ordinary member (switch off) is not held by the new ID rule (their accept is gated instead)");
await db.exec(`DELETE FROM public.payout_transfers WHERE helper_id = '${ORDINARY}'`);
await setAudience("identity_check", "off");
const tClaim3 = await claim(TESTER, JOB_TESTER);
ok(Array.isArray(tClaim3), "(C) identity_check off (prod today): the new rule adds no hold");
await db.exec(`DELETE FROM public.payout_transfers WHERE helper_id = '${TESTER}'; INSERT INTO public.payout_holds (helper_id) VALUES ('${TESTER}')`);
const held = await claim(TESTER, JOB_TESTER);
ok(!Array.isArray(held) && /payout_held/.test(held.error), "(C) an admin payout hold still refuses the claim");
await db.exec(`DELETE FROM public.payout_holds; INSERT INTO public.job_payout_holds (job_id) VALUES ('${JOB_TESTER}')`);
const jheld = await claim(TESTER, JOB_TESTER);
ok(!Array.isArray(jheld) && /payout_held/.test(jheld.error), "(C) a job payout hold still refuses the claim");
await db.exec(`DELETE FROM public.job_payout_holds`);

// ── (D) reminders ──
const claimReminders = async () => {
  const r = await q(`SELECT helper_id, reminder_key, stage, job_id, job_title FROM public.claim_payout_setup_reminders(100)`);
  // A missing function (NEW_MIGRATION=skip) reads as a row nobody expects, so
  // every case below FAILS instead of the script crashing.
  if (!Array.isArray(r)) return [{ helper_id: "error", stage: r.error }];
  return r;
};
const forUid = (rows, uid) => rows.filter((r) => r.helper_id === uid);
let rows = await claimReminders();
ok(rows.length === 0, "(D) payout_setup off (paused): no reminder at all");
await setAudience("payout_setup", "everyone");
await db.exec(`INSERT INTO public.jobs (id, title, helper_id, status, payment_status) VALUES ('${id(130)}', 'Cancelled hire', '${IDLE_TESTER}', 'cancelled', 'escrow')`);
rows = await claimReminders();
ok(forUid(rows, TESTER).length === 1 && forUid(rows, TESTER)[0].stage === "hired" && forUid(rows, TESTER)[0].job_id === JOB_TESTER,
  "(D) a hired tester with no account gets the 'hired' reminder, naming the job");
ok(forUid(rows, TESTER)[0]?.job_title === "Tester hire", "(D) ...with the job's title");
ok(forUid(rows, ESCROW_H).length === 0 && forUid(rows, PAYOUT_H).length === 0, "(D) never an ordinary member (payout_after_hire off for them)");
ok(forUid(rows, READY_TESTER).length === 0, "(D) never a Helpr whose payouts are ready");
ok(forUid(rows, SEAT).length === 0, "(D) never a fixture seat (accept-ready with no account)");
ok(forUid(rows, IDLE_TESTER).length === 0, "(D) never a tester whose only hire was cancelled");
rows = await claimReminders();
ok(rows.length === 0, "(D) a second run at once sends nothing (claimed, and at most one a day)");
const back = (h) => q(`UPDATE public.payout_setup_reminders SET claimed_at = claimed_at - interval '${h} hours' WHERE helper_id = '${TESTER}'`);
await back(19);
ok((await claimReminders()).length === 0, "(D) 19 hours later: still nothing (one a day)");
await back(6);
rows = await claimReminders();
ok(forUid(rows, TESTER).map((r) => r.stage).join() === "day1", "(D) a day after the hire: the day-1 reminder");
await back(25);
ok((await claimReminders()).length === 0, "(D) two days after the hire: nothing new (day 3 not due)");
await back(25);
rows = await claimReminders();
ok(forUid(rows, TESTER).map((r) => r.stage).join() === "day3", "(D) three days after the hire: the day-3 reminder");
await back(24 * 5);
rows = await claimReminders();
ok(forUid(rows, TESTER).map((r) => r.stage).join() === "day7", "(D) seven days after: the day-7 reminder");
await back(48);
ok((await claimReminders()).length === 0, "(D) after day 7 nothing more while no payout waits");
await db.exec(`INSERT INTO public.jobs (id, title, helper_id, payment_status) VALUES ('${JOB_TESTER_PAYOUT}', 'Done job', '${TESTER}', 'payout_pending')`);
rows = await claimReminders();
ok(forUid(rows, TESTER).map((r) => r.reminder_key).join() === `money:${JOB_TESTER_PAYOUT}` && forUid(rows, TESTER)[0].stage === "money",
  "(D) a job whose payout waits gets its own 'money' reminder, once");
await back(48);
ok((await claimReminders()).length === 0, "(D) ...never twice for the same job");
await db.exec(`UPDATE public.profiles SET stripe_account_id = 'acct_new', stripe_payouts_enabled = true WHERE user_id = '${TESTER}';`);
await db.exec(`INSERT INTO public.jobs (id, title, helper_id, payment_status) VALUES ('${id(120)}', 'Another', '${TESTER}', 'payout_pending')`);
await back(48);
ok((await claimReminders()).length === 0, "(D) reminders stop once the payout account is ready");
const anonClaim = await as("authenticated", TESTER, `SELECT * FROM public.claim_payout_setup_reminders(10)`);
ok(!Array.isArray(anonClaim) && /permission denied/.test(anonClaim.error), "(D) a member cannot call claim_payout_setup_reminders (service role only)");

// ── (E) tables are server-only ──
for (const t of ["payout_setup_reminders", "connect_account_retirements"]) {
  for (const role of ["anon", "authenticated"]) {
    const r = await as(role, TESTER, `SELECT count(*) FROM public.${t}`);
    ok(!Array.isArray(r) && /permission denied/.test(r.error), `(E) ${role} cannot read ${t}`);
  }
  const w = await as("authenticated", TESTER, `DELETE FROM public.${t}`);
  ok(!Array.isArray(w) && /permission denied/.test(w.error), `(E) authenticated cannot write ${t}`);
}
const keep = await as("service_role", null, `DELETE FROM public.connect_account_retirements`);
ok(!Array.isArray(keep) && /permission denied/.test(keep.error), "(E) even the server cannot delete a retirement record (kept)");
const pend = await q(`INSERT INTO public.connect_account_retirements (stripe_account_id, replacement_account_id, reason, delete_outcome) VALUES ('acct_old', 'acct_new', 'rejected', 'pending') RETURNING id`);
ok(Array.isArray(pend) && pend.length === 1, "(E) a retirement can be recorded 'pending' before the swap (lh-money-escrow #4)");

// Replay keeps an admin's audience.
await setAudience("payout_after_hire", "off");
await db.exec(MIGRATION);
const aud2 = await q(`SELECT audience FROM public.feature_switches WHERE key = 'payout_after_hire'`);
ok(Array.isArray(aud2) && aud2[0]?.audience === "off", "a replay keeps the audience an admin chose");

function NULL_SAFE() {
  return null;
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
