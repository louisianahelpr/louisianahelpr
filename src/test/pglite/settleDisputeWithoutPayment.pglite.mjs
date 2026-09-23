#!/usr/bin/env node
/**
 * PGlite proof for 20260923190510_settle_dispute_without_payment
 * (docs/OPEN.md Q235).
 *
 *   node src/test/pglite/settleDisputeWithoutPayment.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). Prod-shaped fixture of the columns the RPC reads: jobs,
 * disputes (+ execution columns), dispute_settlement_claims, gift_cards,
 * admin_audit_log, has_role, dispute_settlement_claim_ttl. auth.uid() reads
 * request.jwt.uid.
 *
 * OLD state (before the migration): a decided dispute on a job with no
 * PaymentIntent has no close at all (the RPC does not exist) - printed RED.
 * Then the migration is applied 3x and every refusal and the one success are
 * asserted; exits 1 on any failure.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = fileURLToPath(new URL("../../../supabase/migrations/20260923190510_settle_dispute_without_payment.sql", import.meta.url));

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.uid', true),'')::uuid $$;
create table public.user_roles(user_id uuid, role text);
create function public.has_role(_user_id uuid, _role text) returns boolean language sql as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create function public.dispute_settlement_claim_ttl() returns interval language sql as $$ select interval '10 minutes' $$;
create table public.jobs(id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid, payment_status text default 'escrow', stripe_payment_intent_id text, stripe_session_id text);
create table public.disputes(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), status text, execution_status text,
  executed_at timestamptz, execution_transfer_id text, execution_refund_id text, execution_helper_cents int, execution_refund_cents int, execution_error text);
create table public.dispute_settlement_claims(job_id uuid primary key, claimed_at timestamptz default now(), money_step_at timestamptz);
create table public.gift_cards(id uuid primary key default gen_random_uuid(), job_id uuid, status text);
create table public.admin_audit_log(id serial primary key, admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
`);
const ADMIN = "00000000-0000-0000-0000-00000000ad01", USER = "00000000-0000-0000-0000-00000000ee01", POSTER = "00000000-0000-0000-0000-00000000cc01";
await db.query(`insert into public.user_roles values ($1,'admin'),($2,'admin')`, [ADMIN, POSTER]);

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
async function fixture({ pi = null, session = null, status = "decided", exec = "failed", gift = null, claim = false } = {}) {
  const { rows: [j] } = await db.query(`insert into public.jobs(customer_id, stripe_payment_intent_id, stripe_session_id) values ($1,$2,$3) returning id`, [POSTER, pi, session]);
  const { rows: [d] } = await db.query(`insert into public.disputes(job_id, status, execution_status, execution_error) values ($1,$2,$3,'no payment intent on file — cannot verify or split the escrow') returning id`, [j.id, status, exec]);
  if (gift) await db.query(`insert into public.gift_cards(job_id, status) values ($1,$2)`, [j.id, gift]);
  if (claim) await db.query(`insert into public.dispute_settlement_claims(job_id) values ($1)`, [j.id]);
  return { job: j.id, dispute: d.id };
}
async function call(uid, disputeId, note = "never paid: seeded fixture") {
  await db.query(`select set_config('request.jwt.uid', $1, false)`, [uid ?? ""]);
  try { await db.query(`select public.rpc_settle_dispute_without_payment($1, $2)`, [disputeId, note]); return "ok"; }
  catch (e) { return e.message; }
}

// OLD state: no such close exists.
const pre = await fixture();
const before = await call(ADMIN, pre.dispute);
console.log(/does not exist/.test(before) ? "OLD STATE RED: no admin path closes a decided dispute with no payment on file" : `old state unexpected: ${before}`);

for (let i = 1; i <= 3; i++) { await db.exec(readFileSync(MIG, "utf8")); console.log(`migration applied (${i}/3)`); }

check((await call(USER, (await fixture()).dispute)) === "admin only", "a non-admin is refused");
check((await call(null, (await fixture()).dispute)) === "not authenticated", "no JWT is refused");
check((await call(ADMIN, (await fixture()).dispute, "   ")) === "settle_note_required", "a blank note is refused");
check((await call(ADMIN, (await fixture({ pi: "pi_1" })).dispute)) === "dispute_has_payment", "a job with a PaymentIntent is refused");
check((await call(ADMIN, (await fixture({ session: "cs_1" })).dispute)) === "dispute_has_payment", "a job with a checkout session is refused");
check((await call(ADMIN, (await fixture({ gift: "redeemed" })).dispute)) === "dispute_has_payment", "a gift-funded job is refused");
check((await call(ADMIN, (await fixture({ claim: true })).dispute)) === "dispute_settlement_in_progress", "a live settlement claim is refused");
check((await call(ADMIN, (await fixture({ exec: "executing" })).dispute)) === "dispute_settlement_in_progress", "an executing settlement is refused");
check((await call(ADMIN, (await fixture({ status: "open", exec: null })).dispute)) === "dispute_not_decided", "an open dispute is refused");
check((await call(ADMIN, (await fixture({ exec: "executed" })).dispute)) === "dispute_already_settled", "an executed dispute is refused");
check((await call(POSTER, (await fixture()).dispute)) === "admin_is_party", "an admin who is a party is refused");

const good = await fixture({ exec: "pending" });
check((await call(ADMIN, good.dispute)) === "ok", "an admin closes a decided dispute with no payment on file");
const { rows: [d] } = await db.query(`select * from public.disputes where id=$1`, [good.dispute]);
check(d.execution_status === "executed" && d.execution_helper_cents === 0 && d.execution_refund_cents === 0
  && d.execution_transfer_id === null && d.execution_refund_id === null && d.executed_at !== null, "recorded as executed with zero cents either way");
check(/^closed by an admin, no payment on file: never paid/.test(d.execution_error ?? ""), "the reason is on the row");
const { rows: audit } = await db.query(`select * from public.admin_audit_log where target_id=$1`, [good.dispute]);
check(audit.length === 1 && audit[0].action === "settle_dispute_without_payment" && audit[0].details.note === "never paid: seeded fixture" && audit[0].admin_id === ADMIN, "the admin and note are in admin_audit_log");
// sweep_disputes_closed_without_payment's own predicate (20260922224023) must not match it.
const { rows: [sw] } = await db.query(`select count(*)::int n from public.disputes d join public.jobs j on j.id=d.job_id
  where d.execution_status='executed' and d.execution_transfer_id is null and d.execution_refund_id is null
    and coalesce(d.execution_helper_cents,0)=0 and coalesce(d.execution_refund_cents,0)=0 and d.execution_error is null
    and j.payment_status in ('escrow','payout_pending') and d.id=$1`, [good.dispute]);
check(sw.n === 0, "the closed-without-payment detector does not page on it");
check((await call(ADMIN, good.dispute)) === "dispute_already_settled", "a second close is refused");
const { rows: [jobAfter] } = await db.query(`select payment_status from public.jobs where id=$1`, [good.job]);
check(jobAfter.payment_status === "escrow", "the job row is not touched");
const { rows: [acl] } = await db.query(`select proacl::text from pg_proc where proname='rpc_settle_dispute_without_payment'`);
check(!/(^|[{,])=X/.test(acl.proacl) && !/anon=X/.test(acl.proacl) && /authenticated=X/.test(acl.proacl), `EXECUTE: authenticated only (${acl.proacl})`);

console.log(failures ? `NEW STATE FAILED (${failures})` : "NEW STATE GREEN");
process.exit(failures ? 1 : 0);
