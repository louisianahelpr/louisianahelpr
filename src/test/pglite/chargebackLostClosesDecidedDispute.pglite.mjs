#!/usr/bin/env node
/**
 * PGlite proof for Q342 (20260926034237_chargeback_lost_closes_decided_dispute)
 * and Q344 (20260926034348_decided_dispute_says_payment_processing).
 *
 *   node src/test/pglite/chargebackLostClosesDecidedDispute.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/chargebackLostClosesDecidedDispute.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the live shapes of jobs / disputes (incl. disputes_execution_status_check)
 * / gift_cards / payout_transfers / payment_refunds / dispute_settlement_claims
 * (information_schema, 2026-09-26), and rpc_decide_dispute as the migration
 * before these defines it (md5-identical to live pg_get_functiondef). Both new
 * migrations are applied 3x, then the REAL chain runs: rpc_decide_dispute as an
 * admin, the chargeback block (payment_status -> 'chargeback', what
 * chargeDisputeCreated writes), then settle_dispute_by_chargeback as the
 * webhook's service role would call it on a lost dispute.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const Q342 = readFileSync(`${MIG_DIR}20260926034237_chargeback_lost_closes_decided_dispute.sql`, "utf8");
const Q344 = readFileSync(`${MIG_DIR}20260926034348_decided_dispute_says_payment_processing.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

// rpc_decide_dispute as the NEWEST migration before Q344 defines it.
function priorDecideDispute() {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < "20260926034348").sort();
  let body = null;
  for (const f of files) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const at = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(");
    if (at < 0) continue;
    const tag = sql.slice(at).match(/AS (\$[A-Za-z_]*\$)/)[1];
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    body = sql.slice(at, close + tag.length) + ";";
  }
  return body;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const POSTER = "11111111-0000-0000-0000-000000000001";
const HELPR = "11111111-0000-0000-0000-000000000002";
const uuid = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TYPE public.job_status AS ENUM ('pending_approval','open','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status public.job_status, payment_status text, dispute_status text, dispute_resolved_at timestamptz,
  disputed_at timestamptz, stripe_payment_intent_id text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY, job_id uuid, status text, decided_at timestamptz,
  decided_by uuid, decision_text text, payout_split jsonb, execution_status text,
  execution_started_at timestamptz, executed_at timestamptz, execution_transfer_id text,
  execution_refund_id text, execution_helper_cents integer, execution_refund_cents integer,
  execution_error text, created_at timestamptz DEFAULT now(),
  CONSTRAINT disputes_execution_status_check CHECK (execution_status IS NULL
    OR execution_status IN ('pending','executing','executed','failed')));
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, restored_from_job_id uuid);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text);
CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
CREATE TABLE public.dispute_settlement_claims (job_id uuid PRIMARY KEY, action text, claimed_at timestamptz DEFAULT now(), money_step_at timestamptz);
CREATE OR REPLACE FUNCTION public.dispute_settlement_claim_ttl() RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '10 minutes' $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
`);
await db.exec(priorDecideDispute());

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) {
    await db.exec(Q342);
    await db.exec(Q344);
  }
  check("both migrations apply 3x verbatim (replay-safe)", true);
}

const as = async (uid, fn) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return await fn(); } finally { await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`); }
};
const one = async (sql) => (await db.query(sql)).rows[0];

/** A funded, disputed job with an open dispute, decided by the admin, then charged back. */
async function decidedThenChargedBack(n, split = { poster: 0.5, helper: 0.5 }) {
  const job = uuid(n), d = uuid(1000 + n);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, dispute_status, disputed_at, stripe_payment_intent_id)
    VALUES ('${job}', '${POSTER}', '${HELPR}', 'Job ${n}', 'disputed', 'escrow', 'open', now(), 'pi_${n}');
    INSERT INTO public.disputes (id, job_id, status) VALUES ('${d}', '${job}', 'open');`);
  await as(ADMIN, () => db.query(`SELECT public.rpc_decide_dispute('${d}', 'Split it', '${JSON.stringify(split)}'::jsonb)`));
  // chargeDisputeCreated's block on an escrow job.
  await db.exec(`UPDATE public.jobs SET payment_status = 'chargeback' WHERE id = '${job}' AND payment_status IN ('escrow','payout_pending')`);
  return { job, d };
}
const settle = async (job, disputed = 5000, charge = 5000) => {
  try {
    return (await one(`SELECT public.settle_dispute_by_chargeback('${job}', 'dp_test', ${disputed}, ${charge}) AS r`)).r;
  } catch (e) {
    return { outcome: "ERROR", error: String(e.message ?? e) };
  }
};
const dispute = (d) => one(`SELECT status, execution_status, execution_helper_cents, execution_refund_cents, execution_error FROM public.disputes WHERE id = '${d}'`);
const unsettled = async () => Number((await one(`SELECT count(*) n FROM public.disputes WHERE status='decided' AND execution_status IS DISTINCT FROM 'executed'`)).n);

// ── Q344: the decision's notice says decided, payment processing ──────────
{
  const { job } = await decidedThenChargedBack(1);
  const notes = (await db.query(`SELECT title, message FROM public.notifications WHERE link LIKE '%${job}' ORDER BY title`)).rows;
  check("the decision notifies both parties", notes.length === 2, `got ${notes.length}`);
  check("Q344: neither notice says 'Dispute resolved' before money moves",
    notes.every((r) => r.title === "Dispute decided"), notes.map((r) => r.title).join(", "));
  check("Q344: both notices say the payment is still being processed",
    notes.every((r) => /still being processed/.test(r.message)));
  const j = await one(`SELECT status, dispute_status FROM public.jobs WHERE id = '${job}'`);
  check("job status semantics unchanged (completed / resolved)", j.status === "completed" && j.dispute_status === "resolved", JSON.stringify(j));
}

// ── Q342: the lost chargeback closes the decided, unexecuted dispute ──────
{
  const { job, d } = await decidedThenChargedBack(2);
  check("precondition: decided + pending after the chargeback block", (await dispute(d)).execution_status === "pending");
  const r = await settle(job);
  const row = await dispute(d);
  check("Q342: a lost full chargeback closes the dispute", r?.outcome === "closed", JSON.stringify(r));
  check("Q342: recorded executed with 0/0 and the reason",
    row.execution_status === "executed" && row.execution_helper_cents === 0 && row.execution_refund_cents === 0
      && /lost card chargeback \(dp_test\)/.test(row.execution_error ?? ""), JSON.stringify(row));
  check("Q342: the job row is left 'chargeback'", (await one(`SELECT payment_status p FROM public.jobs WHERE id='${job}'`)).p === "chargeback");
  const again = await settle(job);
  check("Q342: a redelivery is a no-op", again?.outcome === "no_unsettled_dispute", JSON.stringify(again));
}

// ── Refusals: every case where money is still owed or in flight ──────────
const refusals = [
  ["a partial chargeback (the rest is still owed)", async (job) => settle(job, 2000, 5000)],
  ["a gift card funded part of the job", async (job) => {
    await db.exec(`INSERT INTO public.gift_cards (job_id, status) VALUES ('${job}', 'redeemed')`); return settle(job); }],
  ["a live settlement claim", async (job) => {
    await db.exec(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ('${job}', 'split')`); return settle(job); }],
  ["a dead claim that stamped a money step", async (job) => {
    await db.exec(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at, money_step_at) VALUES ('${job}', 'split', now() - interval '1 day', now() - interval '1 day')`); return settle(job); }],
  ["a split run executing inside the TTL", async (job, d) => {
    await db.exec(`UPDATE public.disputes SET execution_status='executing', execution_started_at=now() WHERE id='${d}'`); return settle(job); }],
  ["a paid payout transfer on the job", async (job) => {
    await db.exec(`INSERT INTO public.payout_transfers (job_id, status) VALUES ('${job}', 'paid')`); return settle(job); }],
  ["a refund on the job", async (job) => {
    await db.exec(`INSERT INTO public.payment_refunds (job_id) VALUES ('${job}')`); return settle(job); }],
  ["a split leg already recorded", async (job, d) => {
    await db.exec(`UPDATE public.disputes SET execution_status='failed', execution_transfer_id='tr_1' WHERE id='${d}'`); return settle(job); }],
  ["the job is not blocked as 'chargeback'", async (job) => {
    await db.exec(`UPDATE public.jobs SET payment_status='escrow' WHERE id='${job}'`); return settle(job); }],
];
let n = 10;
for (const [name, act] of refusals) {
  const { job, d } = await decidedThenChargedBack(n++);
  const before = await dispute(d);
  const r = await act(job, d);
  const after = await dispute(d);
  check(`refuses (needs_human) on ${name}`, r?.outcome === "needs_human" && after.execution_status !== "executed",
    `${JSON.stringify(r)} ${before.execution_status}->${after.execution_status}`);
}

{
  const job = uuid(90);
  await db.exec(`INSERT INTO public.jobs (id, status, payment_status) VALUES ('${job}', 'completed', 'chargeback')`);
  const r = await settle(job);
  check("no decided dispute on the job: no_unsettled_dispute", r?.outcome === "no_unsettled_dispute", JSON.stringify(r));
}

// ── Review M1: no decision on a charged-back job; an open one is paged ────
{
  const job = uuid(95), d = uuid(1095);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, dispute_status, disputed_at, stripe_payment_intent_id)
    VALUES ('${job}', '${POSTER}', '${HELPR}', 'Job 95', 'disputed', 'chargeback', 'open', now(), 'pi_95');
    INSERT INTO public.disputes (id, job_id, status) VALUES ('${d}', '${job}', 'open');`);
  const r = await settle(job);
  check("M1: a lost chargeback with the internal dispute still OPEN pages (needs_human)",
    r?.outcome === "needs_human" && /still open/.test(r?.reason ?? ""), JSON.stringify(r));
  let err = "";
  try {
    await as(ADMIN, () => db.query(`SELECT public.rpc_decide_dispute('${d}', 'Split it', '{"poster":0.5,"helper":0.5}'::jsonb)`));
  } catch (e) { err = String(e.message ?? e); }
  check("M1: rpc_decide_dispute refuses a charged-back job (dispute_job_charged_back)", /dispute_job_charged_back/.test(err), err || "decided");
  check("M1: the refused decision recorded nothing", (await dispute(d)).status === "open");
}

// ── Grants: service_role only ─────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const ok = MODE === "skip" ? false : !(await db.query(
    `SELECT has_function_privilege('${role}', 'public.settle_dispute_by_chargeback(uuid,text,bigint,bigint)', 'EXECUTE') AS x`,
  )).rows[0].x;
  check(`${role} cannot execute settle_dispute_by_chargeback`, ok);
}
check("service_role can execute settle_dispute_by_chargeback", MODE === "skip" ? false : (await db.query(
  `SELECT has_function_privilege('service_role', 'public.settle_dispute_by_chargeback(uuid,text,bigint,bigint)', 'EXECUTE') AS x`,
)).rows[0].x);
check("rpc_decide_dispute: anon cannot execute", !(await db.query(
  `SELECT has_function_privilege('anon', 'public.rpc_decide_dispute(uuid,text,jsonb)', 'EXECUTE') AS x`)).rows[0].x);

console.log(`unsettled decided disputes left in the fixture: ${await unsettled()} (the ${refusals.length} refusals + 1 un-settled Q344 job; the M1 job stays open)`);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
