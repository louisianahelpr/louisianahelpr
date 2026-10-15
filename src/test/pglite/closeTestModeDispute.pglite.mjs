#!/usr/bin/env node
/**
 * PGlite proof for rpc_close_test_mode_dispute (docs/OPEN.md Q1769, owner
 * decision 2026-10-15): a decided dispute on a Stripe TEST-mode payment
 * between TEST ACCOUNTS closes as "test, no money moved"; a real dispute does
 * not. Migration 20261015061949_close_test_mode_dispute.
 *
 *   node src/test/pglite/closeTestModeDispute.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). Prod-shaped fixture of the columns the function reads.
 * auth.uid() reads request.jwt.uid.
 *
 * Two states:
 *   NONE - before the migration: the stuck dispute has no way out (RED). The
 *          sibling close (rpc_settle_dispute_without_payment, 20260924013122)
 *          is installed and REFUSES it ("dispute_has_payment"), which is the
 *          defect the item names.
 *   NEW  - the migration applied 3x. Every check must be GREEN.
 * Exits 1 when any NEW check fails or the NONE state is not red.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const MIG_SIBLING = mig("20260924013122_settle_without_payment_closes_funding.sql");
const MIG = mig("20261015061949_close_test_mode_dispute.sql");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.uid', true),'')::uuid $$;
create table public.user_roles(user_id uuid, role text);
create function public.has_role(_user_id uuid, _role text) returns boolean language sql as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create function public.dispute_settlement_claim_ttl() returns interval language sql as $$ select interval '10 minutes' $$;
create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
create table public.profiles(user_id uuid primary key, is_seed boolean default false);
create table public.test_accounts(user_id uuid primary key, enrolled_at timestamptz default now(), note text);
create table public.jobs(id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid, status public.job_status default 'completed',
  budget numeric default 100, urgent_fee numeric,
  payment_status text default 'escrow' check (payment_status = any (array['unpaid','escrow','payout_pending','released','refunded','cancelled','abandoned','failed','chargeback','cancelling'])),
  stripe_payment_intent_id text, stripe_session_id text);
create table public.group_job_helpers(id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text default 'confirmed');
create table public.disputes(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), status text, execution_status text,
  execution_started_at timestamptz, executed_at timestamptz, execution_transfer_id text, execution_refund_id text,
  execution_helper_cents int, execution_refund_cents int, execution_error text,
  check ((execution_status is null) or (execution_status = any (array['pending','executing','executed','failed','crew_fanout']))));
create table public.dispute_settlement_claims(job_id uuid primary key, claimed_at timestamptz default now(), money_step_at timestamptz);
create table public.gift_cards(id uuid primary key default gen_random_uuid(), job_id uuid, status text default 'sent', donor_id uuid, recipient_id uuid,
  recipient_email text, amount numeric default 500, payment_status text default 'paid', category text, message text, expires_at timestamptz,
  redeemed_at timestamptz, parent_credit_id uuid, restored_from_job_id uuid);
create table public.payout_transfers(id serial primary key, job_id uuid, status text);
create table public.payment_refunds(id serial primary key, job_id uuid);
create table public.crew_block_fees(id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, slot_no int default 0,
  share_basis_cents int default 1000, fee_percent int default 25, fee_cents int default 250,
  status text not null default 'owed' check (status = any (array['owed','paid','failed','void'])),
  stripe_transfer_id text, failure_reason text, created_at timestamptz default now(), paid_at timestamptz,
  check ((status <> 'paid') or (stripe_transfer_id is not null)));
create table public.admin_audit_log(id serial primary key, admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
`);
const ADMIN = "00000000-0000-0000-0000-00000000ad01";
const TEST_ADMIN = "00000000-0000-0000-0000-00000000ad02";
const USER = "00000000-0000-0000-0000-00000000ee01";
const POSTER = "00000000-0000-0000-0000-00000000cc01";
const HELPR = "00000000-0000-0000-0000-00000000cc02";
const CREW = "00000000-0000-0000-0000-00000000cc03";
const REAL = "00000000-0000-0000-0000-00000000dd01";
const ENROLLED_NOT_SEED = "00000000-0000-0000-0000-00000000dd02";
await db.query(`insert into public.user_roles values ($1,'admin'),($2,'admin')`, [ADMIN, TEST_ADMIN]);
for (const id of [POSTER, HELPR, CREW, TEST_ADMIN]) {
  await db.query(`insert into public.profiles values ($1, true)`, [id]);
  await db.query(`insert into public.test_accounts(user_id) values ($1)`, [id]);
}
await db.query(`insert into public.profiles values ($1, false), ($2, false)`, [REAL, ENROLLED_NOT_SEED]);
await db.query(`insert into public.test_accounts(user_id) values ($1)`, [ENROLLED_NOT_SEED]);

async function fixture({ session = "cs_test_a1b2", customer = POSTER, helper = HELPR, crew = [], status = "decided", exec = "failed",
  payment = "escrow", gift = null, restored = false, claim = false, transfer = false, refund = false, disputeTransfer = null,
  disputeRefund = null, fees = [], startedAgo = null } = {}) {
  const { rows: [j] } = await db.query(`insert into public.jobs(customer_id, helper_id, stripe_payment_intent_id, stripe_session_id, payment_status)
    values ($1,$2,'pi_3Abc',$3,$4) returning id`, [customer, helper, session, payment]);
  const { rows: [d] } = await db.query(`insert into public.disputes(job_id, status, execution_status, execution_started_at, execution_error,
      execution_transfer_id, execution_refund_id)
    values ($1,$2,$3, case when $4::int is null then null else now() - make_interval(mins => $4::int) end,
    'this escrow was paid in Stripe test mode, so there is no real money behind it — split refused. No money was moved.', $5, $6) returning id`,
    [j.id, status, exec, startedAgo, disputeTransfer, disputeRefund]);
  for (const c of crew) await db.query(`insert into public.group_job_helpers(job_id, helper_id) values ($1,$2)`, [j.id, c]);
  if (gift) await db.query(`insert into public.gift_cards(job_id, status) values ($1,$2)`, [j.id, gift]);
  if (restored) await db.query(`insert into public.gift_cards(restored_from_job_id, status) values ($1,'sent')`, [j.id]);
  if (claim) await db.query(`insert into public.dispute_settlement_claims(job_id) values ($1)`, [j.id]);
  if (transfer) await db.query(`insert into public.payout_transfers(job_id, status) values ($1,'failed')`, [j.id]);
  if (refund) await db.query(`insert into public.payment_refunds(job_id) values ($1)`, [j.id]);
  for (const f of fees) {
    await db.query(`insert into public.crew_block_fees(job_id, helper_id, status, stripe_transfer_id) values ($1,$2,$3,$4)`,
      [j.id, CREW, f, f === "paid" ? "tr_test_1" : null]);
  }
  return { job: j.id, dispute: d.id };
}
async function call(uid, disputeId, note = "a test journey between the shared test accounts") {
  await db.query(`select set_config('request.jwt.uid', $1, false)`, [uid ?? ""]);
  try { await db.query(`select public.rpc_close_test_mode_dispute($1, $2)`, [disputeId, note]); return "ok"; }
  catch (e) { return e.message; }
}
async function sibling(uid, disputeId) {
  await db.query(`select set_config('request.jwt.uid', $1, false)`, [uid ?? ""]);
  try { await db.query(`select public.rpc_settle_dispute_without_payment($1, $2)`, [disputeId, "test"]); return "ok"; }
  catch (e) { return e.message; }
}
const jobRow = async (id) => (await db.query(`select * from public.jobs where id=$1`, [id])).rows[0];
const disputeRow = async (id) => (await db.query(`select * from public.disputes where id=$1`, [id])).rows[0];

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// NONE: the sibling close exists and refuses; the test close does not exist.
await db.exec(MIG_SIBLING);
{
  const f = await fixture();
  const s = await sibling(ADMIN, f.dispute);
  const t = await call(ADMIN, f.dispute);
  const red = s === "dispute_has_payment" && /does not exist/.test(t);
  console.log(red ? "NONE STATE RED: a decided test-mode dispute between test accounts has no way out (close-without-payment refuses it)" : `none state unexpected: sibling=${s} test=${t}`);
  if (!red) failures++;
}

for (let i = 1; i <= 3; i++) { await db.exec(MIG); console.log(`migration applied (${i}/3)`); }

// The close itself.
const good = await fixture({ fees: ["owed", "failed"] });
check((await call(ADMIN, good.dispute)) === "ok", "an admin closes a decided test-mode dispute between test accounts");
const d = await disputeRow(good.dispute);
check(d.execution_status === "executed" && d.execution_helper_cents === 0 && d.execution_refund_cents === 0
  && d.execution_transfer_id === null && d.execution_refund_id === null && d.executed_at !== null, "recorded as executed with zero cents either way");
check((d.execution_error ?? "").startsWith("closed by an admin, Stripe test mode between test accounts, no real money moved: a test journey"), "the reason is on the row, with the client's prefix");
check((await jobRow(good.job)).payment_status === "cancelled", "the job's payment leaves escrow for 'cancelled', so no settle path moves it afterwards");
const { rows: fees } = await db.query(`select status from public.crew_block_fees where job_id=$1`, [good.job]);
check(fees.length === 2 && fees.every((r) => r.status === "void"), "every owed or failed crew block fee on the job is voided");
const { rows: audit } = await db.query(`select * from public.admin_audit_log where target_id=$1`, [good.dispute]);
check(audit.length === 1 && audit[0].action === "close_test_mode_dispute" && audit[0].admin_id === ADMIN
  && audit[0].details.payment_status === "escrow" && audit[0].details.new_payment_status === "cancelled"
  && audit[0].details.stripe_session_id === "cs_test_a1b2" && audit[0].details.crew_block_fees_voided === 2, "the admin, note and before/after are in admin_audit_log");
const { rows: [sw] } = await db.query(`select count(*)::int n from public.disputes d join public.jobs j on j.id=d.job_id
  where d.execution_status='executed' and d.execution_transfer_id is null and d.execution_refund_id is null
    and coalesce(d.execution_helper_cents,0)=0 and coalesce(d.execution_refund_cents,0)=0 and d.execution_error is null
    and j.payment_status in ('escrow','payout_pending') and d.id=$1`, [good.dispute]);
check(sw.n === 0, "the closed-without-payment detector does not page on it");
check((await call(ADMIN, good.dispute)) === "dispute_already_settled", "a second close is refused");

check((await call(ADMIN, (await fixture({ payment: "payout_pending" })).dispute)) === "ok", "a payout_pending test job closes");
check((await call(ADMIN, (await fixture({ payment: "unpaid" })).dispute)) === "ok", "an unpaid test checkout closes");
{
  const f = await fixture({ crew: [CREW] });
  check((await call(ADMIN, f.dispute)) === "ok" && (await jobRow(f.job)).payment_status === "cancelled", "a job whose crew are all test accounts closes");
}
check((await call(ADMIN, (await fixture({ exec: "executing", startedAgo: 60 })).dispute)) === "ok", "a dead 'executing' run (older than the TTL) does not block");
check((await call(TEST_ADMIN, (await fixture()).dispute)) === "ok", "an admin who is a test account but not a party closes it");

// Real disputes are untouched.
async function refusedUnchanged(f, want, label) {
  const before = { j: await jobRow(f.job), d: await disputeRow(f.dispute) };
  const got = await call(ADMIN, f.dispute);
  const after = { j: await jobRow(f.job), d: await disputeRow(f.dispute) };
  check(got === want && JSON.stringify(before) === JSON.stringify(after), `${label} (${got})`);
}
await refusedUnchanged(await fixture({ session: "cs_live_a1b2" }), "dispute_not_test_mode", "a LIVE checkout is refused, nothing changed");
await refusedUnchanged(await fixture({ session: null }), "dispute_not_test_mode", "no checkout session is refused");
await refusedUnchanged(await fixture({ session: "xcs_test_1" }), "dispute_not_test_mode", "a session id that only contains cs_test_ is refused");
await refusedUnchanged(await fixture({ helper: REAL }), "dispute_not_test_accounts", "a real Helpr is refused");
await refusedUnchanged(await fixture({ customer: REAL }), "dispute_not_test_accounts", "a real poster is refused");
await refusedUnchanged(await fixture({ customer: null }), "dispute_not_test_accounts", "a job whose poster is gone is refused");
await refusedUnchanged(await fixture({ crew: [CREW, REAL] }), "dispute_not_test_accounts", "a real crew member is refused");
await refusedUnchanged(await fixture({ helper: ENROLLED_NOT_SEED }), "dispute_not_test_accounts", "an enrolled account whose profile is not is_seed is refused");
await refusedUnchanged(await fixture({ gift: "redeemed" }), "dispute_has_live_gift", "a redeemed gift card (live money) is refused");
await refusedUnchanged(await fixture({ gift: "reserved" }), "dispute_has_live_gift", "a reserved gift card is refused");
await refusedUnchanged(await fixture({ restored: true }), "dispute_has_live_gift", "a gift restored from the job is refused");
await refusedUnchanged(await fixture({ transfer: true }), "dispute_money_moved", "a payout_transfers row is refused");
await refusedUnchanged(await fixture({ refund: true }), "dispute_money_moved", "a payment_refunds row is refused");
await refusedUnchanged(await fixture({ disputeTransfer: "tr_test_9" }), "dispute_money_moved", "a transfer id on the dispute is refused");
await refusedUnchanged(await fixture({ disputeRefund: "re_test_9" }), "dispute_money_moved", "a refund id on the dispute is refused");
await refusedUnchanged(await fixture({ fees: ["paid"] }), "dispute_money_moved", "a paid crew block fee is refused");
for (const p of ["released", "refunded", "chargeback", "cancelling"]) {
  await refusedUnchanged(await fixture({ payment: p }), "dispute_payment_settled", `payment_status ${p} is refused`);
}
await refusedUnchanged(await fixture({ status: "open", exec: null }), "dispute_not_decided", "an open dispute is refused");
await refusedUnchanged(await fixture({ status: "superseded" }), "dispute_not_decided", "a superseded dispute is refused");
await refusedUnchanged(await fixture({ exec: "executed" }), "dispute_already_settled", "an executed dispute is refused");
await refusedUnchanged(await fixture({ exec: "crew_fanout", crew: [CREW] }), "dispute_crew_fanout", "a crew fan-out decision is refused");
await refusedUnchanged(await fixture({ claim: true }), "dispute_settlement_in_progress", "a live settlement claim is refused");
await refusedUnchanged(await fixture({ exec: "executing", startedAgo: 1 }), "dispute_settlement_in_progress", "an executing run inside the TTL is refused");
{
  const f = await fixture();
  check((await call(USER, f.dispute)) === "admin only", "a non-admin is refused");
  check((await call(null, f.dispute)) === "not authenticated", "no JWT is refused");
  check((await call(ADMIN, f.dispute, "   ")) === "settle_note_required", "a blank note is refused");
  check((await call(ADMIN, "00000000-0000-0000-0000-000000000000")) === "dispute not found", "an unknown dispute is refused");
}
// An admin who is a party (poster, Helpr or crew member).
await db.query(`insert into public.user_roles values ($1,'admin')`, [CREW]);
{
  const f = await fixture({ crew: [CREW] });
  check((await call(CREW, f.dispute)) === "admin_is_party", "an admin who is a crew member is refused");
  const g = await fixture({ helper: CREW });
  check((await call(CREW, g.dispute)) === "admin_is_party", "an admin who is the Helpr is refused");
}

const { rows: [acl] } = await db.query(`select proacl::text from pg_proc where proname='rpc_close_test_mode_dispute'`);
check(!/(^|[{,])=X/.test(acl.proacl) && !/anon=X/.test(acl.proacl) && /authenticated=X/.test(acl.proacl), `EXECUTE is authenticated only, never PUBLIC or anon (${acl.proacl})`);

console.log(failures ? `NEW STATE FAILED (${failures})` : "NEW STATE GREEN");
process.exit(failures ? 1 : 0);
