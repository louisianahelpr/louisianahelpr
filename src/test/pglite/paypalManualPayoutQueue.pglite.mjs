#!/usr/bin/env node
/**
 * PGlite proof for 20261023231811_paypal_manual_payout_queue (PayPal Plan A, phase 4: approve, then the
 * admin "Pay this Helpr" queue). Runs on top of 20261023223419_paypal_provider_foundation.
 *
 *   node src/test/pglite/paypalManualPayoutQueue.pglite.mjs
 *   PLANT=no_admin_check   node src/test/pglite/paypalManualPayoutQueue.pglite.mjs   # RED: a non-admin marks paid
 *   PLANT=no_evidence      node src/test/pglite/paypalManualPayoutQueue.pglite.mjs   # RED: no txn id / wrong amount accepted
 *   PLANT=no_idempotency   node src/test/pglite/paypalManualPayoutQueue.pglite.mjs   # RED: the same id twice is refused or re-audited
 *   PLANT=no_one_payee     node src/test/pglite/paypalManualPayoutQueue.pglite.mjs   # RED: one txn id marks two people
 *
 * Proves: both migrations apply 3x; the queue writer is service-role only, idempotent per (job, Helpr),
 * writes the payout_transfers claim AND the provider_payouts row (manual_paypal, pending, destination
 * copied) together, and refuses / waits / holds for every state it must not pay; no refund once a
 * payout is queued; Mark paid is admin only AND behind the switch, needs PayPal's transaction id and
 * the exact total, records marked_paid_by = the admin, writes one admin_audit_log row, moves the claim
 * to paid and the job to released, and tells the Helpr; members read "paid" only after it; the same id
 * twice is a no-op (no second audit row or notice); a different id on a paid row is refused; one id
 * names one payee + destination (a Helpr's job pay + tip in one Send Money is allowed); a held row
 * (email changed) is never marked paid by accident and is re-queued to the new email; the queue list
 * is admin only and shows approved-but-unqueued jobs; the Stripe Payout Queue no longer lists PayPal jobs.
 *
 * Prod-shaped (read-only SQL on prod, 2026-10-23): has_role, is_server_context,
 * feature_enabled_for(_user), require_feature, refuse_payout_claim_while_held, audit_money_table_change
 * (pg_get_functiondef); payout_transfers columns, checks and indexes; notifications type check;
 * jobs.status is the job_status enum. pglite loads from ~/.lh-pglite (not a repo dependency).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const phase1 = read("20261023223419_paypal_provider_foundation.sql");
let mig = read("20261023231811_paypal_manual_payout_queue.sql");
const plant = (from, to) => {
  if (!mig.includes(from)) throw new Error(`plant target not found: ${from.slice(0, 60)}`);
  mig = mig.split(from).join(to);
};
if (process.env.PLANT === "no_admin_check") {
  plant("IF v_admin IS NULL OR NOT COALESCE(public.has_role(v_admin, 'admin'::app_role), false) THEN", "IF false THEN");
}
if (process.env.PLANT === "no_evidence") {
  plant("IF v_txn = '' THEN", "IF false THEN");
  plant("IF p_total_cents IS NULL OR p_total_cents <> v_total THEN", "IF false THEN");
}
if (process.env.PLANT === "no_idempotency") {
  plant("IF v_pp.external_txn_id IS DISTINCT FROM v_txn THEN", "IF true THEN");
}
if (process.env.PLANT === "no_one_payee") {
  plant("OR o.destination_value IS DISTINCT FROM p_destination", "AND false");
  plant("IF v_pp.payee_user_id IS DISTINCT FROM v_first.payee_user_id", "IF false");
}

const db = new PGlite();
const U = {
  ordinary: "11111111-1111-4111-8111-111111111111",
  poster: "22222222-2222-4222-8222-222222222222",
  helpr: "44444444-4444-4444-8444-444444444444",
  helpr2: "55555555-5555-4555-8555-555555555555",
  admin: "33333333-3333-4333-8333-333333333333",
};
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create type public.app_role as enum ('admin','customer','helper');
create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
create table public.user_roles(user_id uuid, role public.app_role);
create table public.test_accounts(user_id uuid primary key, enrolled_at timestamptz default now(), note text);
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context() OR pg_trigger_depth() > 0
       OR EXISTS (SELECT 1 FROM public.user_roles c WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role))
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;
create table public.feature_switches(key text primary key, audience text not null default 'off' check (audience in ('off','testers','everyone')), description text not null, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE OR REPLACE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE s.audience
             WHEN 'everyone' THEN true
             WHEN 'testers' THEN
               COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
               OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
             ELSE false
           END
      FROM public.feature_switches s
     WHERE s.key = p_key AND p_user_id IS NOT NULL
  ), false);
$function$;
CREATE OR REPLACE FUNCTION public.feature_enabled_for(p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.feature_enabled_for_user(p_key, (SELECT auth.uid())); $function$;
CREATE OR REPLACE FUNCTION public.require_feature(p_key text)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.feature_enabled_for(p_key) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501', DETAIL = format('feature %s is not available to this account', p_key);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
create table public.profiles(user_id uuid primary key, full_name text, email text, stripe_account_id text);
create table public.jobs(
  id uuid primary key, title text not null, status public.job_status not null, payment_status text not null,
  helper_id uuid, customer_id uuid, is_group_job boolean default false, helpers_needed int default 1,
  disputed_at timestamptz, dispute_status text, payout_scheduled_at timestamptz,
  budget numeric default 100, urgent_fee numeric, helper_fee_percent numeric, helper_fee_flat_cents int,
  poster_completed_at timestamptz, helper_completed_at timestamptz, updated_at timestamptz default now());
create table public.disputes(id uuid primary key default gen_random_uuid(), job_id uuid, status text, execution_status text);
create table public.payout_holds(helper_id uuid primary key, reason text, held_by uuid, held_at timestamptz default now(), denied_reason text, denied_by uuid, denied_at timestamptz);
create table public.ban_settlement_queue(user_id uuid, review_state text);
create table public.job_payout_holds(job_id uuid primary key);
create table public.tips(id uuid primary key, job_id uuid, helper_id uuid, amount numeric);
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(), admin_id uuid, action text not null, target_type text, target_id text, details jsonb, created_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null,
  type text not null default 'info' check (type = any (array['info','success','warning','job_update','application','review','payment','job_match','job_updates','work_status','transit_updates','system_alert','new_offers','expired','financial_alerts','verified','message','admin_alert'])),
  read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
-- payout_transfers, prod shape (information_schema / pg_constraint / pg_indexes, 2026-10-23)
create table public.payout_transfers(
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  helper_id uuid references auth.users(id) on delete set null, stripe_transfer_id text unique, stripe_account_id text,
  amount_cents integer not null check (amount_cents > 0), currency text not null default 'usd',
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  status text not null default 'pending' check (status = any (array['pending','paid','failed','canceled','reversed','reversal_cleared'])),
  failure_reason text, initiated_by text not null default 'system' check (initiated_by = any (array['system','admin','auto'])),
  initiated_by_user_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  paid_at timestamptz, failed_at timestamptz, reversed_at timestamptz, metadata jsonb not null default '{}'::jsonb, helper_redacted_at timestamptz);
CREATE UNIQUE INDEX payout_transfers_one_live_per_job_helper ON public.payout_transfers USING btree (job_id, helper_id)
  WHERE ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'reversed'::text])) AND ((metadata ->> 'source'::text) IS DISTINCT FROM 'chargeback-repay'::text));
create function public.redact_audit_snapshot(j jsonb) returns jsonb language sql immutable as $$ select j $$;
`);
// prod bodies, verbatim (pg_get_functiondef 2026-10-23)
await db.exec(`
CREATE OR REPLACE FUNCTION public.refuse_payout_claim_while_held()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_customer uuid;
  v_helper   uuid;
BEGIN
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr''s payouts are on hold (public.payout_holds). No transfer may be claimed until an admin releases the hold.';
  END IF;
  IF NEW.status = 'pending' AND NEW.stripe_transfer_id IS NULL THEN
    SELECT j.customer_id, j.helper_id INTO v_customer, v_helper
      FROM public.jobs j
     WHERE j.id = NEW.job_id
       FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                WHERE q.review_state = 'open' AND q.user_id IN (v_customer, v_helper, NEW.helper_id)) THEN
      RAISE EXCEPTION 'payout_held' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.job_payout_holds jh WHERE jh.job_id = NEW.job_id) THEN
      RAISE EXCEPTION 'payout_held' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER refuse_payout_claim_while_held BEFORE INSERT ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION refuse_payout_claim_while_held();
CREATE OR REPLACE FUNCTION public.audit_money_table_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_target text; v_row jsonb; v_session_uid uuid := auth.uid(); v_row_actor uuid; v_admin_id uuid; v_actor text;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));
  v_target := COALESCE(v_row ->> 'id', v_row ->> 'job_id', 'unknown');
  BEGIN
    v_row_actor := NULLIF(v_row ->> 'initiated_by_user_id', '')::uuid;
  EXCEPTION WHEN others THEN v_row_actor := NULL;
  END;
  v_admin_id := COALESCE(v_session_uid, v_row_actor);
  v_actor := CASE WHEN v_session_uid IS NOT NULL THEN CASE WHEN public.has_role(v_session_uid, 'admin'::app_role) THEN 'admin' ELSE 'user' END
                  WHEN v_row_actor IS NOT NULL THEN 'admin' ELSE 'system' END;
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (v_admin_id, TG_OP, TG_TABLE_NAME, v_target, jsonb_build_object('op', TG_OP, 'actor', v_actor));
  EXCEPTION WHEN others THEN RAISE WARNING 'audit_money_table_change: %', SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE TRIGGER trg_audit_payout_transfers AFTER INSERT OR DELETE OR UPDATE ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION audit_money_table_change();
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select, insert, update on all tables in schema public to service_role;
insert into auth.users values ('${U.ordinary}'), ('${U.poster}'), ('${U.helpr}'), ('${U.helpr2}'), ('${U.admin}');
insert into public.test_accounts(user_id) values ('${U.poster}'), ('${U.helpr}'), ('${U.helpr2}');
insert into public.user_roles values ('${U.admin}', 'admin');
insert into public.profiles(user_id, full_name, email, stripe_account_id) values
  ('${U.helpr}', 'Hal Helpr', 'h@example.com', null), ('${U.helpr2}', 'Hope Two', 'h2@example.com', 'acct_1'), ('${U.admin}', 'Owner Admin', 'a@example.com', null);
`);

const r = {};
// A planted defect can make a later step throw; report every check reached so far, then fail.
process.on("uncaughtException", (e) => {
  const bad = Object.entries(r).filter(([, x]) => !String(x).startsWith("ok"));
  console.log(JSON.stringify(r, null, 1));
  console.log(`FAILED (aborted at: ${String(e?.message ?? e).slice(0, 120)}): ${bad.map(([k]) => k).join(", ")}`);
  process.exit(1);
});
const expectErr = async (label, sql, re) => {
  try { await db.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, sql) => {
  try { await db.query(sql); r[label] = "ok"; } catch (e) { r[label] = `bad: ${e.message}`; }
};
let current = "postgres";
const runAs = async (who) => {
  await db.exec("reset role");
  if (who === "service") { await db.exec("set request.jwt.claim.sub = ''; set request.jwt.claim.role = 'service_role'; set role service_role"); return; }
  if (who === "postgres") { await db.exec("set request.jwt.claim.sub = ''; set request.jwt.claim.role = ''"); return; }
  if (who === "anon") { await db.exec("set request.jwt.claim.sub = ''; set request.jwt.claim.role = 'anon'; set role anon"); return; }
  await db.exec(`set request.jwt.claim.sub = '${U[who]}'; set request.jwt.claim.role = 'authenticated'; set role authenticated`);
};
const as = async (who) => { current = who; await runAs(who); };
/** Read evidence as the database owner, then go back to whoever was acting. */
const one = async (sql) => { await runAs("postgres"); try { return (await db.query(sql)).rows[0]; } finally { await runAs(current); } };
const check = (label, cond, got) => { r[label] = cond ? "ok" : `bad: ${JSON.stringify(got)}`; };

for (let i = 1; i <= 3; i++) { await db.exec(phase1); await db.exec(mig); }
r.applied3x = "ok";
await as("postgres");
await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");

// Jobs: J1/J4 PayPal approved (Helpr 1), J2 PayPal still in escrow, J3 PayPal approved (Helpr 2, no PayPal email),
// J5 PayPal crew, J6 Stripe approved (no provider payment), J7 PayPal approved with an open dispute.
const J = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, `b0000000-0000-4000-8000-00000000000${n}`]));
await db.exec(`
insert into jobs(id, title, status, payment_status, helper_id, customer_id, payout_scheduled_at) values
 ('${J[1]}', 'Fence repair', 'completed', 'payout_pending', '${U.helpr}', '${U.poster}', now() + interval '3 days'),
 ('${J[2]}', 'Still working', 'in_progress', 'escrow', '${U.helpr}', '${U.poster}', null),
 ('${J[3]}', 'No email yet', 'completed', 'payout_pending', '${U.helpr2}', '${U.poster}', now()),
 ('${J[4]}', 'Second job', 'completed', 'payout_pending', '${U.helpr}', '${U.poster}', now()),
 ('${J[6]}', 'Stripe job', 'completed', 'payout_pending', '${U.helpr2}', '${U.poster}', now()),
 ('${J[7]}', 'Disputed', 'completed', 'payout_pending', '${U.helpr}', '${U.poster}', now());
update jobs set disputed_at = now(), dispute_status = 'open' where id = '${J[7]}';
insert into jobs(id, title, status, payment_status, helper_id, customer_id, is_group_job, helpers_needed) values
 ('${J[5]}', 'Crew move', 'completed', 'payout_pending', '${U.helpr}', '${U.poster}', true, 3);
`);
await as("service");
for (const n of [1, 2, 3, 4, 5, 7]) {
  await db.query(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status)
    values ('job', '${J[n]}', '${U.poster}', 'paypal_checkout', 'sandbox', 'lh:job:${n}:amt10570:a1', 'O-${n}', 'C-${n}', 10570, 'captured')`);
}
await db.query(`insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.helpr}', 'paypal', 'sandbox', 'hal@example.com', true)`);

const q = (job, helper, cents = 9430) => `select public.paypal_queue_manual_payout('${job}', '${helper}', ${cents}, 570, 'system', null, 'release') as v`;
const queue = async (job, helper, cents) => (await db.query(q(job, helper, cents))).rows[0].v;

// --- the queue writer
await as("admin");
await expectErr("an admin cannot call the queue writer directly", q(J[1], U.helpr), /permission denied/);
await as("anon");
await expectErr("anon cannot call the queue writer", q(J[1], U.helpr), /permission denied/);
await as("service");
let v = await queue(J[1], U.helpr);
check("approval queues the payout", v.outcome === "queued" && v.env === "sandbox", v);
const P1 = v.payout_id;
v = await queue(J[1], U.helpr);
check("queueing again is a no-op (already_queued, same row)", v.outcome === "already_queued" && v.payout_id === P1, v);
const rows1 = await one(`select (select count(*)::int from payout_transfers where job_id='${J[1]}') pt, (select count(*)::int from provider_payouts pp join payout_transfers x on x.id=pp.payout_transfer_id where x.job_id='${J[1]}') pp`);
check("exactly one claim and one payout row", rows1.pt === 1 && rows1.pp === 1, rows1);
const row1 = await one(`select pp.provider, pp.status, pp.destination_kind, pp.destination_value, pp.amount_cents::int a, x.status xs, x.amount_cents xa, x.metadata->>'source' src
  from provider_payouts pp join payout_transfers x on x.id = pp.payout_transfer_id where pp.id='${P1}'`);
check("the row is manual_paypal, pending, to the Helpr's PayPal email, claim pending with the same amount",
  row1.provider === "manual_paypal" && row1.status === "pending" && row1.destination_kind === "paypal_email" && row1.destination_value === "hal@example.com" && row1.a === 9430 && row1.xs === "pending" && row1.xa === 9430 && row1.src === "manual_paypal", row1);
check("job not approved yet: refused", (await queue(J[2], U.helpr)).reason === "job_not_approved", await queue(J[2], U.helpr));
check("no PayPal email: waiting_for_payee", (await queue(J[3], U.helpr2)).outcome === "waiting_for_payee", await queue(J[3], U.helpr2));
check("crew job: refused (not built for PayPal yet)", (await queue(J[5], U.helpr)).reason === "crew_not_supported", await queue(J[5], U.helpr));
check("Stripe job: refused (no captured PayPal payment)", (await queue(J[6], U.helpr2)).reason === "no_captured_paypal_payment", await queue(J[6], U.helpr2));
check("open dispute: refused", (await queue(J[7], U.helpr)).reason === "dispute_open", await queue(J[7], U.helpr));
check("someone else than the job's Helpr: refused", (await queue(J[4], U.helpr2)).reason === "not_the_jobs_helpr", await queue(J[4], U.helpr2));
await as("postgres"); await db.exec(`insert into payout_holds(helper_id, reason) values ('${U.helpr}', 'review')`); await as("service");
check("Helpr on a payout hold: held, nothing written", (await queue(J[4], U.helpr)).outcome === "held"
  && (await one(`select count(*)::int n from payout_transfers where job_id='${J[4]}'`)).n === 0, await queue(J[4], U.helpr));
await as("postgres"); await db.exec(`delete from payout_holds`); await as("service");
check("over the payment: refused", (await queue(J[4], U.helpr, 10571)).reason === "payout_exceeds_payment", await queue(J[4], U.helpr, 10571));
v = await queue(J[4], U.helpr, 1000);
check("second job queued for the same Helpr", v.outcome === "queued", v);
const P4 = v.payout_id;

// --- no refund once a payout is queued (phase 1's guard, reached through this path)
await expectErr("no refund once the payout is queued", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents)
  select id, 'lh:job:1:refund:1', 500 from provider_payments where subject_id='${J[1]}'`, /refund_after_payout_queued/);

// --- members see "paid" only after Mark paid
const before = await one(`select x.status xs, j.payment_status js from payout_transfers x join jobs j on j.id = x.job_id where x.job_id='${J[1]}'`);
check("before Mark paid the claim reads pending and the job payout_pending", before.xs === "pending" && before.js === "payout_pending", before);

// --- Mark paid: who may
const mark = (ids, txn, total, held = false) => `select public.admin_mark_paypal_payout_paid(array[${ids.map((i) => `'${i}'::uuid`).join(",")}], ${txn === null ? "null" : `'${txn}'`}, ${total}, ${held}) as v`;
const TXN = "9AB12345CD678901E";
await as("anon");
await expectErr("anon cannot mark paid", mark([P1], TXN, 9430), /permission denied/);
await as("ordinary");
await expectErr("an ordinary member cannot mark paid (switch)", mark([P1], TXN, 9430), /feature_disabled/);
await as("helpr");
await expectErr("the Helpr (a tester, switch on) cannot mark their own payout paid", mark([P1], TXN, 9430), /admin_only/);
await as("helpr");
await expectErr("a tester cannot read the pay queue", "select * from admin_paypal_payout_queue()", /admin_only/);
await as("postgres"); await db.exec("update feature_switches set audience='off' where key='paypal_payments'");
await as("admin");
await expectErr("switch off: even the admin is refused", mark([P1], TXN, 9430), /feature_disabled/);
await as("postgres"); await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");

// --- evidence
await as("admin");
await expectErr("transaction id required", mark([P1], "  ", 9430), /txn_id_required/);
await expectErr("transaction id required (null)", mark([P1], null, 9430), /txn_id_required/);
await expectErr("transaction id must look like one", mark([P1], "paid!", 9430), /txn_id_invalid/);
await expectErr("the total sent must match what was queued", mark([P1], TXN, 9431), /payout_amount_mismatch/);
const auditBefore = (await one("select count(*)::int n from admin_audit_log where action='paypal_payout_marked_paid'")).n;
check("nothing was written by the refused presses", auditBefore === 0 && (await one(`select status from provider_payouts where id='${P1}'`)).status === "pending", auditBefore);

// --- the press
v = (await db.query(mark([P1], " " + TXN.toLowerCase() + " ", 9430))).rows[0].v;
check("Mark paid succeeds (id trimmed, upper-cased)", v.outcome === "marked_paid" && v.external_txn_id === TXN, v);
const paid = await one(`select pp.status, pp.external_txn_id, pp.marked_paid_by, pp.marked_paid_at is not null at, x.status xs, x.paid_at is not null xp, j.payment_status js
  from provider_payouts pp join payout_transfers x on x.id = pp.payout_transfer_id join jobs j on j.id = x.job_id where pp.id = '${P1}'`);
check("marked_paid_by is the admin's auth.uid(), with the time and id", paid.status === "success" && paid.external_txn_id === TXN && paid.marked_paid_by === U.admin && paid.at, paid);
check("the claim is paid and the job released (members now read paid)", paid.xs === "paid" && paid.xp && paid.js === "released", paid);
const audit = await one(`select count(*)::int n, max(admin_id::text) a, max(details->>'external_txn_id') t, max((details->>'total_cents')) c from admin_audit_log where action='paypal_payout_marked_paid'`);
check("one admin_audit_log row, by the admin, with the id and amount", audit.n === 1 && audit.a === U.admin && audit.t === TXN && audit.c === "9430", audit);
const note = await one(`select count(*)::int n, max(title) t, max(message) m, max(type) ty from notifications where user_id='${U.helpr}'`);
check("the Helpr is told, once", note.n === 1 && note.t === "You've been paid" && /\$94\.30 was sent to your PayPal for "Fence repair"/.test(note.m) && note.ty === "payment", note);

// --- replays
try { v = (await db.query(mark([P1], TXN, 9430))).rows[0].v; } catch (e) { v = { error: e.message }; }
check("the same id twice is a no-op", v.outcome === "already_paid", v);
const after2 = await one(`select (select count(*)::int from admin_audit_log where action='paypal_payout_marked_paid') a, (select count(*)::int from notifications where user_id='${U.helpr}') n`);
check("no second audit row or notice on the replay", after2.a === 1 && after2.n === 1, after2);
await expectErr("a different id on a paid row is refused", mark([P1], "7XY98765ZW432109K", 9430), /payout_already_marked_paid/);
check("the paid row still carries the first id", (await one(`select external_txn_id from provider_payouts where id='${P1}'`)).external_txn_id === TXN, null);

// --- one id names one payee + destination
await as("postgres");
await db.exec(`insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.helpr2}', 'paypal', 'sandbox', 'hope@example.com', true)`);
await as("service");
const P3 = (await queue(J[3], U.helpr2, 5000)).payout_id;
await as("admin");
await expectErr("one PayPal id cannot mark a payout to a different person", mark([P3], TXN, 5000), /txn_id_already_used/);
await expectErr("one press pays one person", mark([P3, P4], "5PQ11111AA222222B", 6000), /payouts_not_one_payee/);
// a Helpr's job pay and a later line in the SAME Send Money share the id (tips): allowed
v = (await db.query(mark([P1, P4], TXN, 10430))).rows[0].v;
check("the same id may cover more lines to the same person (job pay + tip in one Send Money)", v.outcome === "marked_paid" && v.payout_ids.length === 1 && v.payout_ids[0] === P4, v);
check("J4 released too", (await one(`select payment_status from jobs where id='${J[4]}'`)).payment_status === "released", null);

// --- held (the Helpr changed their PayPal email, phase 2) and re-queue
await as("service");
await db.query(`update provider_payouts set status = 'held' where id = '${P3}'`);
await db.query(`update payee_accounts set paypal_email = 'hope.new@example.com' where user_id = '${U.helpr2}'`);
await as("admin");
const heldLine = (await db.query("select * from admin_paypal_payout_queue()")).rows.find((x) => x.payout_id === P3);
check("the queue shows the held row with the OLD destination and the current one", heldLine?.status === "held" && heldLine.destination_value === "hope@example.com" && heldLine.current_destination === "hope.new@example.com", heldLine);
await expectErr("a held row is not marked paid by accident", mark([P3], "5PQ11111AA222222B", 5000), /payout_held_email_changed/);
await as("service");
await db.query(`update payee_accounts set payable = false where user_id = '${U.helpr2}'`);
await as("admin");
await expectErr("re-queue needs a payable new email", `select public.admin_requeue_held_paypal_payout('${P3}')`, /no_payable_paypal_account/);
await as("service");
await db.query(`update payee_accounts set payable = true where user_id = '${U.helpr2}'`);
await as("postgres"); await db.exec(`insert into payout_holds(helper_id, reason) values ('${U.helpr2}', 'review')`);
await as("admin");
await expectErr("re-queue refused while the Helpr is on a payout hold", `select public.admin_requeue_held_paypal_payout('${P3}')`, /payout_held/);
await as("postgres"); await db.exec(`delete from payout_holds`);
await as("helpr2");
await expectErr("a non-admin cannot re-queue", `select public.admin_requeue_held_paypal_payout('${P3}')`, /admin_only/);
await as("admin");
v = (await db.query(`select public.admin_requeue_held_paypal_payout('${P3}') as v`)).rows[0].v;
check("re-queued to the new email", v.outcome === "requeued", v);
const rq = await one(`select (select status from provider_payouts where id='${P3}') old_s,
  (select status from payout_transfers where id=(select payout_transfer_id from provider_payouts where id='${P3}')) old_x,
  (select destination_value from provider_payouts where id='${v.payout_id}') new_d,
  (select status from provider_payouts where id='${v.payout_id}') new_s,
  (select count(*)::int from admin_audit_log where action='paypal_payout_requeued') a`);
check("old row and claim canceled, new row pending to hope.new@, audited", rq.old_s === "canceled" && rq.old_x === "canceled" && rq.new_d === "hope.new@example.com" && rq.new_s === "pending" && rq.a === 1, rq);
const P3b = v.payout_id;
// sent before the hold: the admin may record it explicitly
await as("service");
await db.query(`update provider_payouts set status = 'held' where id = '${P3b}'`);
await as("admin");
v = (await db.query(mark([P3b], "5PQ11111AA222222B", 5000, true))).rows[0].v;
check("a held row CAN be recorded when the admin confirms it was sent before the change", v.outcome === "marked_paid", v);

// --- the queue list
await as("admin");
const lines = (await db.query("select * from admin_paypal_payout_queue()")).rows;
const nq = lines.filter((x) => x.row_kind === "not_queued").map((x) => `${x.job_title}:${x.status}`).sort();
check("approved-but-unqueued PayPal jobs are listed with why", JSON.stringify(nq) === JSON.stringify(["Crew move:crew_not_supported", "Disputed:not_queued_yet"]), nq);
check("Stripe jobs are not in the PayPal queue", !lines.some((x) => x.job_title === "Stripe job"), lines.map((x) => x.job_title));
const paidLine = lines.find((x) => x.payout_id === P1);
check("a paid line shows its id and who marked it", paidLine?.status === "success" && paidLine.external_txn_id === TXN && paidLine.marked_paid_by_name === "Owner Admin" && paidLine.line_kind === "job" && paidLine.helper_name === "Hal Helpr", paidLine);

// --- the Stripe Payout Queue no longer lists PayPal jobs
await as("postgres");
await db.exec(`update jobs set payment_status='payout_pending' where id='${J[4]}'`);
await as("admin");
const batches = (await db.query("select * from get_payout_batches()")).rows;
check("get_payout_batches lists the Stripe job only", batches.length === 1 && batches[0].helper_id === U.helpr2 && batches[0].job_count === 1, batches);

// --- grants
await as("postgres");
for (const [fn, sig] of [["paypal_queue_manual_payout", "uuid, uuid, integer, integer, text, uuid, text"], ["paypal_payout_destination", "uuid, text"],
  ["admin_mark_paypal_payout_paid", "uuid[], text, bigint, boolean"], ["admin_requeue_held_paypal_payout", "uuid"], ["admin_paypal_payout_queue", ""], ["paypal_txn_names_other_payee", "text, uuid, text, text, uuid"]]) {
  const acl = (await one(`select proacl::text a from pg_proc where oid = 'public.${fn}(${sig})'::regprocedure`)).a ?? "";
  const anonOk = !/(^|[{,])=X|anon=X/.test(acl);
  const authOk = fn.startsWith("admin_") ? /authenticated=X/.test(acl) : !/authenticated=X/.test(acl);
  r[`${fn} acl`] = anonOk && authOk ? `ok (${acl})` : `bad (${acl})`;
}

const bad = Object.entries(r).filter(([, x]) => !String(x).startsWith("ok"));
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; both migrations applied 3x)`);
process.exit(bad.length ? 1 : 0);
