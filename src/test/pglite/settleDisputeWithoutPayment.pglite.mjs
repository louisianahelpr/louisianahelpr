#!/usr/bin/env node
/**
 * PGlite proof for rpc_settle_dispute_without_payment (docs/OPEN.md Q235):
 * 20260923205812_settle_dispute_without_payment (the close) and
 * 20260924013122_settle_without_payment_closes_funding (the four findings of
 * the lh-money-escrow review: funding closed after the $0 close, payment_status
 * and money-moved refusals, a dead 'executing' no longer blocks, and
 * redeem_gift_card refusing a settled job).
 *
 *   node src/test/pglite/settleDisputeWithoutPayment.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). Prod-shaped fixture of the columns both functions read.
 * auth.uid() reads request.jwt.uid.
 *
 * Three states, each scenario run in each:
 *   NONE  - before 20260923205812: the close does not exist (RED).
 *   OLD   - 20260923205812 applied, plus the live redeem_gift_card (its body is
 *           the new migration's minus the one added block; md5 pinned to the
 *           live prosrc, 4c2b4cd5a13a4750f6034ece1234a854, read 2026-09-23).
 *           Every follow-up scenario must be RED here.
 *   NEW   - 20260924013122 applied 3x. Every scenario must be GREEN.
 * Exits 1 when any NEW check fails or any follow-up scenario is not red on OLD.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const MIG_CLOSE = mig("20260923205812_settle_dispute_without_payment.sql");
const MIG_FOLLOWUP = mig("20260924013122_settle_without_payment_closes_funding.sql");

// The live redeem_gift_card, derived from the follow-up by removing its one addition.
const LIVE_REDEEM_MD5 = "4c2b4cd5a13a4750f6034ece1234a854";
const redeemStart = MIG_FOLLOWUP.indexOf("CREATE OR REPLACE FUNCTION public.redeem_gift_card");
const bodyOpen = MIG_FOLLOWUP.indexOf("AS $function$", redeemStart) + "AS $function$".length;
const bodyClose = MIG_FOLLOWUP.indexOf("$function$", bodyOpen);
let liveBody = MIG_FOLLOWUP.slice(bodyOpen, bodyClose).replace(", status::text as status", "");
liveBody = liveBody.slice(0, liveBody.indexOf("  -- Q235 follow-up: a closed job")) + liveBody.slice(liveBody.indexOf("  -- Lock the credit."));
if (createHash("md5").update(liveBody).digest("hex") !== LIVE_REDEEM_MD5) {
  console.log("FAIL  the derived OLD redeem_gift_card is not the live body (md5 mismatch)");
  process.exit(1);
}
const OLD_REDEEM = `CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_credit_id uuid, p_job_id uuid, p_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$${liveBody}$function$;`;

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.uid', true),'')::uuid $$;
create table public.user_roles(user_id uuid, role text);
create function public.has_role(_user_id uuid, _role text) returns boolean language sql as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create function public.dispute_settlement_claim_ttl() returns interval language sql as $$ select interval '10 minutes' $$;
create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
create table public.jobs(id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid, status public.job_status default 'completed',
  budget numeric default 100, urgent_fee numeric,
  payment_status text default 'unpaid' check (payment_status = any (array['unpaid','escrow','payout_pending','released','refunded','cancelled','abandoned','failed','chargeback','cancelling'])),
  stripe_payment_intent_id text, stripe_session_id text);
create table public.disputes(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), status text, execution_status text,
  execution_started_at timestamptz, executed_at timestamptz, execution_transfer_id text, execution_refund_id text,
  execution_helper_cents int, execution_refund_cents int, execution_error text);
create table public.dispute_settlement_claims(job_id uuid primary key, claimed_at timestamptz default now(), money_step_at timestamptz);
create table public.gift_cards(id uuid primary key default gen_random_uuid(), job_id uuid, status text default 'sent', donor_id uuid, recipient_id uuid,
  recipient_email text, amount numeric default 500, payment_status text default 'paid', category text, message text, expires_at timestamptz,
  redeemed_at timestamptz, parent_credit_id uuid, restored_from_job_id uuid);
create table public.payout_transfers(id serial primary key, job_id uuid, status text);
create table public.payment_refunds(id serial primary key, job_id uuid);
create table public.admin_audit_log(id serial primary key, admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
`);
const ADMIN = "00000000-0000-0000-0000-00000000ad01", USER = "00000000-0000-0000-0000-00000000ee01", POSTER = "00000000-0000-0000-0000-00000000cc01";
await db.query(`insert into public.user_roles values ($1,'admin'),($2,'admin')`, [ADMIN, POSTER]);

async function fixture({ pi = null, session = null, status = "decided", exec = "failed", gift = null, claim = false,
  payment = "unpaid", jobStatus = "completed", transfer = false, refund = false, restored = false, startedAgo = null } = {}) {
  const { rows: [j] } = await db.query(`insert into public.jobs(customer_id, stripe_payment_intent_id, stripe_session_id, payment_status, status)
    values ($1,$2,$3,$4,$5) returning id`, [POSTER, pi, session, payment, jobStatus]);
  const { rows: [d] } = await db.query(`insert into public.disputes(job_id, status, execution_status, execution_started_at, execution_error)
    values ($1,$2,$3, case when $4::int is null then null else now() - make_interval(mins => $4::int) end,
    'no payment intent on file — cannot verify or split the escrow') returning id`, [j.id, status, exec, startedAgo]);
  if (gift) await db.query(`insert into public.gift_cards(job_id, status) values ($1,$2)`, [j.id, gift]);
  if (claim) await db.query(`insert into public.dispute_settlement_claims(job_id) values ($1)`, [j.id]);
  if (transfer) await db.query(`insert into public.payout_transfers(job_id, status) values ($1,'failed')`, [j.id]);
  if (refund) await db.query(`insert into public.payment_refunds(job_id) values ($1)`, [j.id]);
  if (restored) await db.query(`insert into public.gift_cards(restored_from_job_id, status) values ($1,'sent')`, [j.id]);
  return { job: j.id, dispute: d.id };
}
async function call(uid, disputeId, note = "never paid: seeded fixture") {
  await db.query(`select set_config('request.jwt.uid', $1, false)`, [uid ?? ""]);
  try { await db.query(`select public.rpc_settle_dispute_without_payment($1, $2)`, [disputeId, note]); return "ok"; }
  catch (e) { return e.message; }
}
async function redeem(jobId) {
  const { rows: [g] } = await db.query(`insert into public.gift_cards(recipient_id, status) values ($1,'sent') returning id`, [POSTER]);
  try { const { rows: [r] } = await db.query(`select public.redeem_gift_card($1,$2,$3) as r`, [g.id, jobId, POSTER]); return r.r.outcome; }
  catch (e) { return e.message; }
}
const jobRow = async (id) => (await db.query(`select * from public.jobs where id=$1`, [id])).rows[0];
// create-payment's stampSession conditional write, as PostgREST sends it.
async function stampRows(jobId) {
  const { rows } = await db.query(`update public.jobs set stripe_session_id = 'cs_race', payment_status = 'unpaid'
    where id = $1 and (payment_status is null or payment_status in ('unpaid','abandoned','failed'))
      and not (status in ('completed','cancelled')) and stripe_session_id is null returning id`, [jobId]);
  return rows.length;
}

/** Follow-up scenarios (20260924013122): each returns true when the fixed behaviour holds. */
const FOLLOWUP = {
  "the close moves an unpaid job to payment_status 'cancelled'": async () => {
    const f = await fixture(); return (await call(ADMIN, f.dispute)) === "ok" && (await jobRow(f.job)).payment_status === "cancelled";
  },
  "the close moves an abandoned job to 'cancelled'": async () => {
    const f = await fixture({ payment: "abandoned" }); return (await call(ADMIN, f.dispute)) === "ok" && (await jobRow(f.job)).payment_status === "cancelled";
  },
  "after the close a gift card cannot fund the job": async () => {
    const f = await fixture(); await call(ADMIN, f.dispute); return /already been funded|no longer be funded/.test(await redeem(f.job));
  },
  "after the close create-payment's session stamp matches zero rows": async () => {
    const f = await fixture({ jobStatus: "disputed" }); await call(ADMIN, f.dispute); return (await stampRows(f.job)) === 0;
  },
  "a job whose payment_status is escrow is refused": async () =>
    (await call(ADMIN, (await fixture({ payment: "escrow" })).dispute)) === "dispute_payment_not_unfunded",
  "a job whose payment_status is refunded is refused": async () =>
    (await call(ADMIN, (await fixture({ payment: "refunded" })).dispute)) === "dispute_payment_not_unfunded",
  "a job with any payout_transfers row is refused": async () =>
    (await call(ADMIN, (await fixture({ transfer: true })).dispute)) === "dispute_money_moved",
  "a job with a payment_refunds row is refused": async () =>
    (await call(ADMIN, (await fixture({ refund: true })).dispute)) === "dispute_money_moved",
  "a job with a restored gift is refused": async () =>
    (await call(ADMIN, (await fixture({ restored: true })).dispute)) === "dispute_money_moved",
  "a dead 'executing' run (older than the TTL) no longer blocks": async () =>
    (await call(ADMIN, (await fixture({ exec: "executing", startedAgo: 60 })).dispute)) === "ok",
  "the audit row carries payment_status": async () => {
    const f = await fixture({ payment: "failed" }); await call(ADMIN, f.dispute);
    const { rows: [a] } = await db.query(`select details from public.admin_audit_log where target_id=$1`, [f.dispute]);
    return a?.details?.payment_status === "failed" && a?.details?.new_payment_status === "cancelled";
  },
  "redeem_gift_card refuses a job with a decided dispute": async () =>
    /dispute has been decided/.test(await redeem((await fixture({ jobStatus: "disputed", exec: "pending" })).job)),
  "redeem_gift_card refuses a completed job": async () =>
    /job is closed/.test(await redeem((await fixture({ status: "withdrawn", jobStatus: "completed" })).job)),
};

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// NONE: no close exists.
const before = await call(ADMIN, (await fixture()).dispute);
console.log(/does not exist/.test(before) ? "NONE STATE RED: no admin path closes a decided dispute with no payment on file" : `none state unexpected: ${before}`);

// OLD: the close as first shipped + the live redeem_gift_card. Every follow-up scenario must be red.
await db.exec(MIG_CLOSE);
await db.exec(OLD_REDEEM);
for (const [label, run] of Object.entries(FOLLOWUP)) {
  const ok = await run();
  console.log(`${ok ? "NOT RED" : "RED   "}  (old) ${label}`);
  if (ok) failures++;
}

for (let i = 1; i <= 3; i++) { await db.exec(MIG_FOLLOWUP); console.log(`follow-up migration applied (${i}/3)`); }

for (const [label, run] of Object.entries(FOLLOWUP)) check(await run(), label);

check((await call(USER, (await fixture()).dispute)) === "admin only", "a non-admin is refused");
check((await call(null, (await fixture()).dispute)) === "not authenticated", "no JWT is refused");
check((await call(ADMIN, (await fixture()).dispute, "   ")) === "settle_note_required", "a blank note is refused");
check((await call(ADMIN, (await fixture({ pi: "pi_1" })).dispute)) === "dispute_has_payment", "a job with a PaymentIntent is refused");
check((await call(ADMIN, (await fixture({ session: "cs_1" })).dispute)) === "dispute_has_payment", "a job with a checkout session is refused");
check((await call(ADMIN, (await fixture({ gift: "redeemed" })).dispute)) === "dispute_has_payment", "a gift-funded job is refused");
check((await call(ADMIN, (await fixture({ claim: true })).dispute)) === "dispute_settlement_in_progress", "a live settlement claim is refused");
check((await call(ADMIN, (await fixture({ exec: "executing", startedAgo: 1 })).dispute)) === "dispute_settlement_in_progress", "an executing settlement inside the TTL is refused");
check((await call(ADMIN, (await fixture({ exec: "executing" })).dispute)) === "dispute_settlement_in_progress", "an executing settlement with no start time is refused");
check((await call(ADMIN, (await fixture({ status: "open", exec: null })).dispute)) === "dispute_not_decided", "an open dispute is refused");
check((await call(ADMIN, (await fixture({ exec: "executed" })).dispute)) === "dispute_already_settled", "an executed dispute is refused");
check((await call(POSTER, (await fixture()).dispute)) === "admin_is_party", "an admin who is a party is refused");
check((await call(ADMIN, (await fixture({ payment: "cancelled" })).dispute)) === "ok", "an already-cancelled payment closes");
check((await redeem((await fixture({ status: "withdrawn", jobStatus: "open" })).job)) === "settled", "redeem_gift_card still funds an open unpaid job");

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
for (const fn of ["rpc_settle_dispute_without_payment", "redeem_gift_card"]) {
  const { rows: [acl] } = await db.query(`select proacl::text from pg_proc where proname=$1`, [fn]);
  const want = fn === "redeem_gift_card" ? /service_role=X/ : /authenticated=X/;
  const forbidden = fn === "redeem_gift_card" ? /authenticated=X/ : /$^/;
  check(!/(^|[{,])=X/.test(acl.proacl) && !/anon=X/.test(acl.proacl) && want.test(acl.proacl) && !forbidden.test(acl.proacl), `${fn} EXECUTE (${acl.proacl})`);
}

console.log(failures ? `NEW STATE FAILED (${failures})` : "NEW STATE GREEN");
process.exit(failures ? 1 : 0);
