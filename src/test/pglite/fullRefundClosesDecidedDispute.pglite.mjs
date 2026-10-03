#!/usr/bin/env node
/**
 * PGlite proof for Q450 (20261003181427_full_refund_closes_decided_dispute).
 *
 *   node src/test/pglite/fullRefundClosesDecidedDispute.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/fullRefundClosesDecidedDispute.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the live shapes (information_schema / pg_constraint, 2026-10-03)
 * of the columns settle_dispute_by_external_refund reads: jobs, disputes (with
 * the live disputes_execution_status_check, which admits 'crew_fanout', and
 * disputes_execution_amounts_check), gift_cards, payout_transfers,
 * payment_refunds (with `source`), dispute_settlement_claims. The migration is
 * applied 3x verbatim, then each case builds the state rpc_decide_dispute
 * leaves (job completed / dispute_status 'resolved' / disputed_at set /
 * escrow; dispute decided, execution 'pending'), applies the full-refund flip
 * charge.refunded makes (payment_status -> 'refunded'), and calls the close as
 * the webhook's service role would.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const Q450 = readFileSync(`${MIG_DIR}20261003181427_full_refund_closes_decided_dispute.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status text, payment_status text, dispute_status text, disputed_at timestamptz,
  is_group_job boolean DEFAULT false, stripe_payment_intent_id text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY, job_id uuid, status text, decided_at timestamptz,
  payout_split jsonb, execution_status text, execution_started_at timestamptz, executed_at timestamptz,
  execution_transfer_id text, execution_refund_id text, execution_helper_cents integer,
  execution_refund_cents integer, execution_error text,
  CONSTRAINT disputes_status_check CHECK (status IN ('open','decided','withdrawn','superseded')),
  CONSTRAINT disputes_execution_status_check CHECK (execution_status IS NULL
    OR execution_status IN ('pending','executing','executed','failed','crew_fanout')),
  CONSTRAINT disputes_execution_amounts_check CHECK (COALESCE(execution_helper_cents, 0) >= 0
    AND COALESCE(execution_refund_cents, 0) >= 0));
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, restored_from_job_id uuid);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text);
CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, source text, stripe_refund_id text);
CREATE TABLE public.dispute_settlement_claims (job_id uuid PRIMARY KEY, action text, claimed_at timestamptz DEFAULT now(), money_step_at timestamptz);
CREATE OR REPLACE FUNCTION public.dispute_settlement_claim_ttl() RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '10 minutes' $$;
`);

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(Q450);
  check("the migration applies 3x verbatim (replay-safe)", true);
}

const one = async (sql) => (await db.query(sql)).rows[0];

/**
 * The state rpc_decide_dispute leaves, then a FULL refund from outside the
 * split: charge.refunded's compare-and-set moves escrow -> refunded.
 */
async function decidedThenRefunded(n, split = { poster: 0.5, helper: 0.5 }, opts = {}) {
  const job = uuid(n), d = uuid(1000 + n);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, dispute_status, disputed_at, stripe_payment_intent_id)
    VALUES ('${job}', '${POSTER}', '${HELPR}', 'Job ${n}', 'completed', 'escrow', 'resolved', now(), 'pi_${n}');
    INSERT INTO public.disputes (id, job_id, status, decided_at, payout_split, execution_status)
    VALUES ('${d}', '${job}', 'decided', now(), '${JSON.stringify(split)}'::jsonb, '${opts.execution ?? "pending"}');`);
  await db.exec(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${job}'
    AND payment_status IN ('escrow','payout_pending','cancelling','unpaid','abandoned','failed','cancelled')`);
  return { job, d };
}
const settle = async (job, refunded = 5000, charge = 5000) => {
  try {
    return (await one(`SELECT public.settle_dispute_by_external_refund('${job}', 'ch_test', ${refunded}, ${charge}) AS r`)).r;
  } catch (e) {
    return { outcome: "ERROR", error: String(e.message ?? e) };
  }
};
const dispute = (d) => one(`SELECT status, execution_status, execution_helper_cents, execution_refund_cents, execution_transfer_id, execution_refund_id, execution_error FROM public.disputes WHERE id = '${d}'`);

// ── Q450: the full outside refund closes the decided, unexecuted dispute ──
{
  const { job, d } = await decidedThenRefunded(1);
  check("precondition: decided + pending after the refund flip", (await dispute(d)).execution_status === "pending");
  const r = await settle(job);
  const row = await dispute(d);
  check("Q450: a full refund made outside the split closes the dispute", r?.outcome === "closed", JSON.stringify(r));
  check("Q450: recorded executed, Helpr 0, poster = the refunded charge, no split leg ids, with the reason",
    row.execution_status === "executed" && row.execution_helper_cents === 0 && row.execution_refund_cents === 5000
      && row.execution_transfer_id === null && row.execution_refund_id === null
      && /full refund made outside the split \(ch_test\)/.test(row.execution_error ?? ""), JSON.stringify(row));
  check("Q450: the decided split rides back to the webhook (it words the notices)", r?.payout_split?.helper === 0.5, JSON.stringify(r));
  check("Q450: the job row is left 'refunded'", (await one(`SELECT payment_status p FROM public.jobs WHERE id='${job}'`)).p === "refunded");
  const again = await settle(job);
  check("Q450: a redelivery is a no-op", again?.outcome === "no_unsettled_dispute", JSON.stringify(again));
}

// A split that FAILED earlier (e.g. it refused the refunded job) is still unexecuted, so it closes too.
{
  const { job, d } = await decidedThenRefunded(2, { poster: 1, helper: 0 }, { execution: "failed" });
  const r = await settle(job);
  check("a 'failed' split attempt is closed the same way", r?.outcome === "closed" && (await dispute(d)).execution_status === "executed", JSON.stringify(r));
}

// ── busy: a run in flight is the redelivery's to judge ────────────────────
const busy = [
  ["a live settlement claim", async (job) => {
    await db.exec(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ('${job}', 'split')`); return settle(job); }],
  ["a split run executing inside the TTL", async (job, d) => {
    await db.exec(`UPDATE public.disputes SET execution_status='executing', execution_started_at=now() WHERE id='${d}'`); return settle(job); }],
];
let n = 10;
for (const [name, act] of busy) {
  const { job, d } = await decidedThenRefunded(n++);
  const r = await act(job, d);
  check(`answers busy (nothing written) on ${name}`, r?.outcome === "busy" && (await dispute(d)).execution_status !== "executed", JSON.stringify(r));
}

// ── needs_human: every case where money is still owed or already moved ───
const refusals = [
  ["a partial refund (the rest is still owed)", async (job) => settle(job, 2000, 5000)],
  ["a gift card funded part of the job", async (job) => {
    await db.exec(`INSERT INTO public.gift_cards (job_id, status) VALUES ('${job}', 'redeemed')`); return settle(job); }],
  ["a reserved gift card on the job", async (job) => {
    await db.exec(`INSERT INTO public.gift_cards (job_id, status) VALUES ('${job}', 'reserved')`); return settle(job); }],
  ["a dead claim that stamped a money step", async (job) => {
    await db.exec(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at, money_step_at) VALUES ('${job}', 'split', now() - interval '1 day', now() - interval '1 day')`); return settle(job); }],
  ["a paid payout transfer on the job", async (job) => {
    await db.exec(`INSERT INTO public.payout_transfers (job_id, status) VALUES ('${job}', 'paid')`); return settle(job); }],
  ["a reversed payout transfer on the job", async (job) => {
    await db.exec(`INSERT INTO public.payout_transfers (job_id, status) VALUES ('${job}', 'reversed')`); return settle(job); }],
  ["a split refund already in the ledger", async (job) => {
    await db.exec(`INSERT INTO public.payment_refunds (job_id, source, stripe_refund_id) VALUES ('${job}', 'dispute_split', 're_split')`); return settle(job); }],
  ["a gift already restored from the job", async (job) => {
    await db.exec(`INSERT INTO public.gift_cards (status, restored_from_job_id) VALUES ('sent', '${job}')`); return settle(job); }],
  ["a split leg already recorded on the dispute", async (job, d) => {
    await db.exec(`UPDATE public.disputes SET execution_status='failed', execution_transfer_id='tr_1' WHERE id='${d}'`); return settle(job); }],
  ["the job is not 'refunded' (the flip this close assumes)", async (job) => {
    await db.exec(`UPDATE public.jobs SET payment_status='escrow' WHERE id='${job}'`); return settle(job); }],
];
for (const [name, act] of refusals) {
  const { job, d } = await decidedThenRefunded(n++);
  const r = await act(job, d);
  check(`refuses (needs_human) on ${name}`, r?.outcome === "needs_human" && (await dispute(d)).execution_status !== "executed",
    JSON.stringify(r));
}

// The Dashboard refund's OWN ledger row (written by charge.refunded) is not "a split moved money".
{
  const { job, d } = await decidedThenRefunded(60);
  await db.exec(`INSERT INTO public.payment_refunds (job_id, source, stripe_refund_id) VALUES ('${job}', 'stripe_dashboard', 're_dash')`);
  const r = await settle(job);
  check("the outside refund's own ledger row does not block the close", r?.outcome === "closed" && (await dispute(d)).execution_status === "executed", JSON.stringify(r));
}

// ── Not this function's ───────────────────────────────────────────────────
{
  const job = uuid(90);
  await db.exec(`INSERT INTO public.jobs (id, status, payment_status) VALUES ('${job}', 'cancelled', 'refunded')`);
  const r = await settle(job);
  check("no decided dispute on the job: no_unsettled_dispute", r?.outcome === "no_unsettled_dispute", JSON.stringify(r));
}
{
  // A crew decision is never closed by this function: its members' owed
  // shares are a person's call, and the payout fan-out that settles it never
  // runs on a refunded job, so the WEBHOOK reads it first and pages a person
  // (chargeRefunded's crew hand-back, lh-money-escrow review MEDIUM).
  const { job, d } = await decidedThenRefunded(91, { poster: 0.5, helper: 0.5 }, { execution: "crew_fanout" });
  const r = await settle(job);
  check("a crew_fanout decision is never closed here (left untouched for the webhook's page)",
    r?.outcome === "no_unsettled_dispute" && (await dispute(d)).execution_status === "crew_fanout", JSON.stringify(r));
}
{
  const { job, d } = await decidedThenRefunded(92);
  await db.exec(`UPDATE public.disputes SET execution_status='executed' WHERE id='${d}'`);
  const r = await settle(job);
  check("an executed dispute is not touched", r?.outcome === "no_unsettled_dispute", JSON.stringify(r));
}
{
  let err = "";
  try { await db.query(`SELECT public.settle_dispute_by_external_refund('${uuid(1)}', '  ', 1, 1)`); } catch (e) { err = String(e.message ?? e); }
  check("a blank charge id is refused", /required/.test(err), err || "accepted");
}

// ── Grants: service_role only ─────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const ok = MODE === "skip" ? false : !(await db.query(
    `SELECT has_function_privilege('${role}', 'public.settle_dispute_by_external_refund(uuid,text,bigint,bigint)', 'EXECUTE') AS x`,
  )).rows[0].x;
  check(`${role} cannot execute settle_dispute_by_external_refund`, ok);
}
check("service_role can execute settle_dispute_by_external_refund", MODE === "skip" ? false : (await db.query(
  `SELECT has_function_privilege('service_role', 'public.settle_dispute_by_external_refund(uuid,text,bigint,bigint)', 'EXECUTE') AS x`,
)).rows[0].x);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
