#!/usr/bin/env node
/**
 * PGlite proof for 20261023232438_paypal_refunds_and_helpr_fee (PayPal Plan A, phase 5), on top
 * of phase 1's 20261023223419 (both run verbatim, each 3x).
 *
 *   node src/test/pglite/paypalRefundsAndFee.pglite.mjs
 *   PLANT=no_fee_stamp     ... # RED: a tester's new job is not stamped 8% + 70c
 *   PLANT=claim_no_replay  ... # RED: a replayed refund claim makes a second refund row
 *   PLANT=no_refund_guard  ... # RED: over-refund and refund-after-payout-queued are let through
 *   PLANT=no_orphan_carveout ... # RED: an orphan capture cannot be refunded
 *   PLANT=no_ceiling       ... # RED: two keys together pass the refundable ceiling
 *   PLANT=no_money_flag    ... # RED: a refund door cannot settle its job (phase 3's guard)
 *   PLANT=no_sanctioned_flag ... # RED: the poster's PayPal cancel is refused (phase 3's lock)
 *
 * Proves: the fee is stamped AT POST only while paypal_payments is on for the poster (8/70),
 * cleared for everyone else exactly as before, server inserts untouched, and members still cannot
 * move it; the refund claim is one row per key (a replay answers the same row, even after a payout
 * was queued; the same key for another amount is refused); refunds never exceed the payment and
 * are refused once a payout is queued or held; PayPal's answer is recorded once and moves the
 * payment to partially_refunded / refunded; PAYMENT.CAPTURE.REFUNDED reconciles (known refund,
 * lost answer attached, refund made outside the app recorded, outside refund while a payout is
 * queued holds that payout), and a 3x replay leaves one refund row; the cancelled-jobs hand-out;
 * review round 1: env refused before a row, the refundable ceiling under the lock; a cancelled
 * PayPal job (lead decision 2026-10-23): the poster's door only cancels (phase 3's lock and money
 * guard copied in), the cancellation sweep's key gives exactly one refund, and the job is settled
 * only under phase 3's money flag; orphan captures refunded in full only; PayPal refunding less than
 * asked is recorded and flagged; members and anon cannot call any of it.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const p1 = read("20261023223419_paypal_provider_foundation.sql");
let mig = read("20261023232438_paypal_refunds_and_helpr_fee.sql");
const plant = (from, to) => {
  if (!mig.includes(from)) throw new Error(`plant target missing: ${from.slice(0, 60)}`);
  mig = mig.replace(from, to);
};
if (process.env.PLANT === "no_fee_stamp") plant("IF public.feature_enabled_for_user('paypal_payments', NEW.customer_id) THEN", "IF false THEN");
if (process.env.PLANT === "no_orphan_carveout") plant("IF NOT v_orphan AND NOT EXISTS (SELECT 1 FROM public.provider_payments", "IF NOT EXISTS (SELECT 1 FROM public.provider_payments");
if (process.env.PLANT === "no_money_flag") plant("  PERFORM set_config('app.paypal_money_write', '1', true);\n  UPDATE public.jobs", "  UPDATE public.jobs");
if (process.env.PLANT === "no_sanctioned_flag") plant("  PERFORM set_config('app.paypal_sanctioned_cancel', '1', true);\n", "");
if (process.env.PLANT === "no_ceiling") plant("+ p_amount_cents > p_max_total_cents THEN", "+ p_amount_cents > p_max_total_cents + 1000000 THEN");
if (process.env.PLANT === "claim_no_replay") {
  plant("SELECT * INTO v_ref FROM public.provider_refunds WHERE idempotency_key = p_idempotency_key;\n  IF FOUND THEN", "SELECT * INTO v_ref FROM public.provider_refunds WHERE false;\n  IF FOUND THEN");
  plant("EXCEPTION WHEN unique_violation THEN", "EXCEPTION WHEN division_by_zero THEN");
}
const p1Run = process.env.PLANT === "no_refund_guard" ? p1.replace(/CREATE TRIGGER trg_provider_refunds_guard[\s\S]*?;/, "") : p1;
if (process.env.PLANT === "no_refund_guard") mig = mig.replace(/CREATE TRIGGER trg_provider_refunds_guard[\s\S]*?;/, "");
const db = new PGlite();
const U = { ordinary: "11111111-1111-4111-8111-111111111111", tester: "22222222-2222-4222-8222-222222222222", admin: "33333333-3333-4333-8333-333333333333" };
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; -- as on Supabase
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.app_role as enum ('admin','customer','helper');
create table public.user_roles(user_id uuid, role public.app_role);
create table public.test_accounts(user_id uuid primary key, enrolled_at timestamptz default now(), note text);
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
-- prod definition of is_server_context (pg_get_functiondef, 2026-10-23)
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
-- prod definition of has_role (pg_get_functiondef, 2026-10-23)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context() OR pg_trigger_depth() > 0
       OR EXISTS (SELECT 1 FROM public.user_roles c WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role))
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;
create table public.feature_switches(key text primary key, audience text not null default 'off' check (audience in ('off','testers','everyone')), description text not null, created_at timestamptz default now(), updated_at timestamptz default now());
-- prod definition of feature_enabled_for_user (20261012031120)
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
REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid) TO service_role;
create table public.payout_transfers(id uuid primary key default gen_random_uuid());
-- jobs, prod-shaped for the columns these functions touch (+ prod's poster-fee CHECK, 20261017230824)
create type public.job_status as enum ('open', 'accepted', 'in_progress', 'revision_requested', 'completed', 'cancelled', 'disputed');
create table public.jobs(
  id uuid primary key default gen_random_uuid(), customer_id uuid, status public.job_status not null default 'open',
  payment_status text, budget numeric, helper_fee_flat_cents integer, helper_fee_percent numeric,
  poster_fee_flat_cents integer, cancellation_fee numeric, is_group_job boolean default false,
  recurrence_days integer, parent_job_id uuid, cancelled_at timestamptz,
  constraint jobs_poster_fee_model_consistent check (
    (poster_fee_flat_cents IS NULL) = (helper_fee_flat_cents IS DISTINCT FROM 0)
    AND (poster_fee_flat_cents IS NULL OR helper_fee_percent IS NOT DISTINCT FROM 0)));
grant select, insert, update on public.jobs to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select on public.feature_switches, public.test_accounts, public.user_roles to service_role;
insert into auth.users values ('${U.ordinary}'), ('${U.tester}'), ('${U.admin}');
insert into public.test_accounts(user_id) values ('${U.tester}');
insert into public.user_roles values ('${U.admin}', 'admin');
-- a pre-existing admin flip must survive replays
`);
const r = {};
const expectErr = async (label, sql, re) => {
  try { await db.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, sql) => {
  try { await db.query(sql); r[label] = "ok"; } catch (e) { r[label] = `bad: ${e.message}`; }
};
const one = async (sql) => (await db.query(sql)).rows[0];
// A function call's jsonb answer, or its error (so a planted defect reports its checks instead of crashing).
const jx = async (sql) => { try { return (await one(sql)).j; } catch (e) { return { error: e.message }; } };
const check = (label, cond, got) => { r[label] = cond ? "ok" : `bad: ${JSON.stringify(got)}`; };
for (let i = 1; i <= 3; i++) await db.exec(p1Run);
for (let i = 1; i <= 3; i++) await db.exec(mig);
r.applied3x = "ok";

// ── 1. the fee stamp at post ──
const asMember = async (u, sql) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${u}'`);
  try { return await db.query(sql); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
};
const post = (u, extra = "") => `insert into jobs(customer_id, budget, helper_fee_percent${extra ? ", " + extra.split("=")[0] : ""}) values ('${u}', 100, 12${extra ? ", " + extra.split("=")[1] : ""}) returning id, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents`;
let row = (await asMember(U.tester, post(U.tester))).rows[0];
check("switch OFF: a tester's new job carries no stamp (today's behaviour)", row.helper_fee_flat_cents === null && Number(row.helper_fee_percent) === 12, row);
await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");
for (let i = 1; i <= 2; i++) await db.exec(mig);
r.replayKeepsFlip = (await one("select audience from feature_switches where key='paypal_payments'")).audience === "testers" ? "ok" : "bad";
row = (await asMember(U.tester, post(U.tester))).rows[0];
check("switch ON (testers): a tester's new job is stamped 8% + 70c at post", row.helper_fee_flat_cents === 70 && Number(row.helper_fee_percent) === 8 && row.poster_fee_flat_cents === null, row);
const TJOB = row.id;
row = (await asMember(U.ordinary, post(U.ordinary))).rows[0];
check("switch ON (testers): an ordinary member's job is unstamped, as before", row.helper_fee_flat_cents === null && Number(row.helper_fee_percent) === 12, row);
row = (await asMember(U.admin, post(U.admin, "poster_fee_flat_cents=70"))).rows[0];
check("a member's own poster-fee stamp is cleared, then the PayPal stamp applies", row.poster_fee_flat_cents === null && row.helper_fee_flat_cents === 70 && Number(row.helper_fee_percent) === 8, row);
await db.exec("set role service_role");
row = (await db.query(`insert into jobs(customer_id, budget, helper_fee_flat_cents, helper_fee_percent) values ('${U.tester}', 50, 70, 5) returning helper_fee_flat_cents, helper_fee_percent`)).rows[0];
await db.exec("reset role");
check("a server insert keeps what the server wrote (5/70 stays 5/70)", row.helper_fee_flat_cents === 70 && Number(row.helper_fee_percent) === 5, row);
try { await asMember(U.tester, `update jobs set helper_fee_flat_cents = 0 where id = '${TJOB}'`); r["a member cannot move the stamp"] = "bad: allowed"; }
catch (e) { r["a member cannot move the stamp"] = /Only the server may set jobs.helper_fee_flat_cents/.test(e.message) ? "ok" : `wrong: ${e.message}`; }

// ── 2. refunds ──
await db.exec("set role service_role");
const JOB = "b0000000-0000-4000-8000-000000000001";
const JOB2 = "b0000000-0000-4000-8000-000000000002";
const PT = ["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002"];
await db.exec(`reset role; insert into payout_transfers(id) values ('${PT[0]}'), ('${PT[1]}'); insert into jobs(id, customer_id, status, payment_status, budget) values ('${JOB}', '${U.tester}', 'cancelled', 'escrow', 100), ('${JOB2}', '${U.tester}', 'completed', 'escrow', 50); set role service_role`);
const payRow = async (key, subject, amount, capture) => (await one(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, provider_capture_id)
  values ('job', '${subject}', '${U.tester}', 'paypal_checkout', 'sandbox', '${key}', 'O-${key}', ${amount}, 'captured', '${capture}') returning id`)).id;
const P1 = await payRow("lh:job:p1:checkout:amt10000:a1", JOB, 10000, "CAP1");
const P2 = await payRow("lh:job:p2:checkout:amt5000:a1", JOB2, 5000, "CAP2");
const K = (job, tail) => `lh:job:${job}:refund:${tail}`;
const claim = (pay, key, amt) => `select public.paypal_refund_claim('${pay}', '${key}', ${amt}, 'test') j`;

let c1 = (await jx(claim(P1, K(JOB, "cancel"), 9611)));
check("claim: a pending row", c1.status === "pending" && c1.replay === false && c1.capture_id === "CAP1", c1);
let c1b = (await jx(claim(P1, K(JOB, "cancel"), 9611)));
check("claim replay: the same row, said as a replay", c1b.refund_id === c1.refund_id && c1b.replay === true, c1b);
await expectErr("the same key for another amount is refused", claim(P1, K(JOB, "cancel"), 9000), /refund_key_reused/);
await expectErr("a key that is not ours is refused", claim(P1, "rf-random", 100), /refund_key_invalid/);
check("one row per key after the replays", (await one(`select count(*)::int n from provider_refunds where idempotency_key = '${K(JOB, "cancel")}'`)).n === 1, null);
check("a pending refund already moves the payment to partially_refunded", (await one(`select status from provider_payments where id='${P1}'`)).status === "partially_refunded", null);
await expectErr("over-refund: more than what is left is refused", claim(P1, K(JOB, "admin:" + "d0000000-0000-4000-8000-000000000001"), 390), /refund_exceeds_payment/);
let rec = (await jx(`select public.paypal_refund_record('${c1.refund_id}', 'REF1', 'completed', 9611) j`));
check("record completed: partially_refunded, 96.11 refunded", rec.payment_status === "partially_refunded" && Number(rec.refunded_cents) === 9611, rec);
rec = (await jx(`select public.paypal_refund_record('${c1.refund_id}', 'REF1', 'completed', 9611) j`));
check("record replay: no change", rec.changed === false && Number(rec.refunded_cents) === 9611, rec);
await expectErr("PayPal's other refund id on a recorded row is refused", `select public.paypal_refund_record('${c1.refund_id}', 'REF-OTHER', 'completed', 9611)`, /refund_id_mismatch/);
await expectErr("a different amount from PayPal is refused", `select public.paypal_refund_record('${c1.refund_id}', 'REF1', 'completed', 9600)`, /refund_amount_mismatch/);
await expectErr("a completed refund cannot become failed", `select public.paypal_refund_record('${c1.refund_id}', 'REF1', 'failed', 9611)`, /refund_status_final/);
const c2 = (await jx(claim(P1, K(JOB, "admin:d0000000-0000-4000-8000-000000000002"), 389)));
rec = (await jx(`select public.paypal_refund_record('${c2.refund_id}', 'REF2', 'completed', 389) j`));
check("the rest refunded: payment refunded", rec.payment_status === "refunded" && Number(rec.refunded_cents) === 10000, rec);
await expectErr("nothing left: a further refund is refused", claim(P1, K(JOB, "admin:d0000000-0000-4000-8000-000000000003"), 1), /refund_exceeds_payment|refund_needs_captured_payment/);

// payout queued / held blocks a new refund, never a replay
const payoutSql = (pt, pay, amt) => `insert into provider_payouts(provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${pay}', '${pt}', '${U.tester}', 'manual_paypal', 'sandbox', 'paypal_email', 't@example.com', ${amt})`;
const c3 = (await jx(claim(P2, K(JOB2, "admin:d0000000-0000-4000-8000-000000000004"), 1000)));
await expectOk("a payout of what is left is queued", payoutSql(PT[0], P2, 4000));
await expectErr("refused once a payout is QUEUED", claim(P2, K(JOB2, "admin:d0000000-0000-4000-8000-000000000005"), 100), /refund_after_payout_queued/);
const c3b = (await jx(claim(P2, K(JOB2, "admin:d0000000-0000-4000-8000-000000000004"), 1000)));
check("but a replay of the claim made before the payout still answers its row", c3b.refund_id === c3.refund_id && c3b.replay === true, c3b);
await expectOk("phase 2: the Helpr changed their email, the payout is held", `update provider_payouts set status='held' where payout_transfer_id='${PT[0]}'`);
await expectErr("refused while a payout is HELD", claim(P2, K(JOB2, "admin:d0000000-0000-4000-8000-000000000006"), 100), /refund_after_payout_queued/);
await expectOk("the payout is cancelled", `update provider_payouts set status='canceled' where payout_transfer_id='${PT[0]}'`);

// reconcile (PAYMENT.CAPTURE.REFUNDED re-read from PayPal)
const recon = (cap, ref, st, amt, env = "sandbox", hint = null) => `select public.paypal_refund_reconcile('${env}', '${cap}', '${ref}', '${st}', ${amt}${hint ? `, '${hint}'` : ""}) j`;
let o = (await jx(recon("CAP1", "REF1", "completed", 9611)));
check("reconcile a refund we recorded: already", o.outcome === "already", o);
o = (await jx(recon("CAP-NOT-OURS", "REFX", "completed", 100)));
check("reconcile a capture that is not ours: unknown_capture", o.outcome === "unknown_capture", o);
await expectErr("reconcile across environments is refused", recon("CAP1", "REF1", "completed", 9611, "live"), /reconcile_env_mismatch/);
for (let i = 0; i < 3; i++) o = (await jx(recon("CAP2", "REF3", "completed", 1000)));
check("lost answer: the pending claim takes PayPal's refund id (and stays one row over 3 replays)", o.outcome === "already" && (await one(`select provider_refund_id, status from provider_refunds where id='${c3.refund_id}'`)).provider_refund_id === "REF3", o);
check("3 replays of the event: still one refund row for REF3", (await one("select count(*)::int n from provider_refunds where provider_refund_id='REF3'")).n === 1, null);
for (let i = 0; i < 3; i++) o = (await jx(recon("CAP2", "REF-DASH", "completed", 500)));
check("a refund made in the PayPal dashboard is recorded once", (await one("select count(*)::int n from provider_refunds where provider_refund_id='REF-DASH'")).n === 1 && o.outcome === "already", o);
check("...and moves the payment", (await one(`select status from provider_payments where id='${P2}'`)).status === "partially_refunded", null);
await expectOk("a new payout is queued", payoutSql(PT[1], P2, 3000));
o = (await jx(recon("CAP2", "REF-DASH-2", "completed", 200)));
check("an outside refund while a payout is queued: refused by the guard, the queued payout held", o.outcome === "outside_refund_refused" && o.payouts_held === 1, o);
check("...the payout now reads held", (await one(`select status from provider_payouts where payout_transfer_id='${PT[1]}'`)).status === "held", null);
o = (await jx(recon("CAP2", "REF-DEAD", "failed", 200)));
check("a failed refund we never claimed moved no money", o.outcome === "ignored_dead", o);

// two lost answers of the same amount: PayPal's custom_id picks the right claim
const JOB3 = "b0000000-0000-4000-8000-000000000003";
await db.exec(`reset role; insert into jobs(id, customer_id, status, payment_status, budget) values ('${JOB3}', '${U.tester}', 'completed', 'escrow', 80); set role service_role`);
const P3 = await payRow("lh:job:p3:checkout:amt8000:a1", JOB3, 8000, "CAP3");
const h1 = await jx(claim(P3, K(JOB3, "admin:e0000000-0000-4000-8000-000000000001"), 1000));
const h2 = await jx(claim(P3, K(JOB3, "admin:e0000000-0000-4000-8000-000000000002"), 1000));
o = await jx(recon("CAP3", "REF-H2", "completed", 1000, "sandbox", h2.refund_id));
check("custom_id names the claim: the SECOND same-amount claim takes it, not the oldest", o.outcome === "attached" && (await one(`select provider_refund_id from provider_refunds where id='${h2.refund_id}'`)).provider_refund_id === "REF-H2" && (await one(`select provider_refund_id from provider_refunds where id='${h1.refund_id}'`)).provider_refund_id === null, o);

// ── 2b. review round 1 (lh-money-escrow / lh-silent-failure 2026-10-23) ──
const JOB4 = "b0000000-0000-4000-8000-000000000004";
await db.exec(`reset role; insert into jobs(id, customer_id, status, payment_status, budget) values ('${JOB4}', '${U.tester}', 'cancelled', 'escrow', 100); set role service_role`);
const P4 = await payRow("lh:job:p4:checkout:amt10000:a1", JOB4, 10000, "CAP4");
const claim6 = (pay, key, amt, env, max) => `select public.paypal_refund_claim('${pay}', '${key}', ${amt}, 'test', ${env ? `'${env}'` : "null"}, ${max ?? "null"}) j`;
o = await jx(claim6(P4, K(JOB4, "admin:f0000000-0000-4000-8000-000000000001"), 100, "live"));
check("env mismatch is refused BEFORE a row is written (no phantom claim)", /refund_env_mismatch/.test(o.error ?? "") && (await one(`select count(*)::int n from provider_refunds where provider_payment_id='${P4}'`)).n === 0, o);
o = await jx(claim6(P4, K(JOB4, "admin:f0000000-0000-4000-8000-000000000002"), 9700, "sandbox", 9611));
check("the refundable ceiling (PayPal keeps its fee) is enforced under the lock", /refund_exceeds_refundable/.test(o.error ?? ""), o);
const okClaim = await jx(claim6(P4, K(JOB4, "admin:f0000000-0000-4000-8000-000000000003"), 9000, "sandbox", 9611));
o = await jx(claim6(P4, K(JOB4, "admin:f0000000-0000-4000-8000-000000000004"), 612, "sandbox", 9611));
check("a second key racing the first cannot pass the ceiling together (9000 + 612 > 9611)", okClaim.refund_id && /refund_exceeds_refundable/.test(o.error ?? ""), { okClaim, o });
o = await jx(claim6(P4, K(JOB4, "admin:f0000000-0000-4000-8000-000000000003"), 9000, "sandbox", 9611));
check("...while the first key's replay still answers its row", o.refund_id === okClaim.refund_id && o.replay === true, o);
await jx(`select public.paypal_refund_record('${okClaim.refund_id}', 'REF-P4', 'failed', 9000) j`);
const c4 = await jx(claim6(P4, K(JOB4, "cancel"), 9611, "sandbox", 9611));
await jx(`select public.paypal_refund_record('${c4.refund_id}', 'REF-P4C', 'pending', 9611) j`);
o = await jx(recon("CAP4", "REF-P4C", "failed", 9611));
check("PayPal failing a recorded refund: 'updated' with the key and previous status (the handler pages)", o.outcome === "updated" && o.status === "failed" && o.previous_status === "pending" && o.idempotency_key === K(JOB4, "cancel"), o);

// ── 2c. one money path for a cancelled PayPal job (lead decision 2026-10-23) ──
// Phase 3's two triggers, copied from wip/pp-phase3 @048e868bd2 (20261023232151 lines 166-237):
// the money-state guard verbatim; the member cancel lock with the ONE line this phase proposes as
// the contract (honour app.paypal_sanctioned_cancel, set only by paypal_poster_cancel_job).
// poster_cancel_job: a stand-in for prod's (13 kB): the poster cancels; the fee tier is recorded.
await db.exec(`reset role;
CREATE OR REPLACE FUNCTION public.paypal_job_money_state_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND current_setting('app.paypal_money_write', true) IS DISTINCT FROM '1'
     AND EXISTS (SELECT 1 FROM public.provider_payments p
                  WHERE p.subject_kind = 'job' AND p.subject_id = OLD.id
                    AND p.status IN ('approved', 'capture_pending', 'captured', 'partially_refunded', 'disputed')) THEN
    RAISE EXCEPTION 'paypal_job_money_outside_paypal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_paypal_job_money_state_guard BEFORE UPDATE OF payment_status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.paypal_job_money_state_guard();
CREATE OR REPLACE FUNCTION public.paypal_capture_locks_job_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF (TG_OP = 'DELETE' OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'cancelled'))
     AND NOT (TG_OP = 'UPDATE' AND current_setting('app.paypal_sanctioned_cancel', true) IS NOT DISTINCT FROM '1')
     AND EXISTS (SELECT 1 FROM public.provider_payments p
                  WHERE p.subject_kind = 'job' AND p.subject_id = OLD.id
                    AND p.status IN ('captured', 'partially_refunded', 'disputed')) THEN
    RAISE EXCEPTION 'paypal_payment_held' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
CREATE TRIGGER trg_paypal_capture_locks_job_price BEFORE UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.paypal_capture_locks_job_price();
CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL, p_expected_fee_cents bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.jobs SET status = 'cancelled', cancellation_fee = 0 WHERE id = p_job_id AND customer_id = auth.uid() AND status::text IN ('open', 'accepted');
  IF NOT FOUND THEN RAISE EXCEPTION 'not_cancellable'; END IF;
  RETURN jsonb_build_object('cancelled', true, 'fee', 0);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text, bigint) TO authenticated;`);
for (let i = 0; i < 2; i++) await db.exec(mig);
const JOB7 = "b0000000-0000-4000-8000-000000000007";
await db.exec(`insert into jobs(id, customer_id, status, payment_status, budget) values ('${JOB7}', '${U.tester}', 'open', 'escrow', 40); set role service_role`);
const P7 = await payRow("lh:job:p7:checkout:amt4000:a1", JOB7, 4000, "CAP7");
try { await asMember(U.tester, `update jobs set status = 'cancelled' where id = '${JOB7}'`); r["phase 3's lock refuses the ordinary member cancel while PayPal money is held"] = "bad: allowed"; }
catch (e) { r["phase 3's lock refuses the ordinary member cancel while PayPal money is held"] = /paypal_payment_held/.test(e.message) ? "ok" : `wrong: ${e.message}`; }
try { await asMember(U.ordinary, `select public.paypal_poster_cancel_job('${JOB7}')`); r["another member cannot cancel through the PayPal door"] = "bad: allowed"; }
catch (e) { r["another member cannot cancel through the PayPal door"] = /not_cancellable/.test(e.message) ? "ok" : `wrong: ${e.message}`; }
try { row = (await asMember(U.tester, `select public.paypal_poster_cancel_job('${JOB7}', 'plans changed') j`)).rows[0]; } catch (e) { row = { error: e.message }; }
const j7 = await one(`select status::text, payment_status from jobs where id='${JOB7}'`);
check("the poster cancels through the PayPal door: cancelled, money untouched (payment_status escrow, no refund)", j7.status === "cancelled" && j7.payment_status === "escrow" && (await one(`select count(*)::int n from provider_refunds where provider_payment_id='${P7}'`)).n === 0, { row, j7 });
try { await asMember(U.tester, `select public.paypal_poster_cancel_job('${JOB}')`); r["the PayPal door refuses a job with no held PayPal money"] = "bad: allowed"; }
catch (e) { r["the PayPal door refuses a job with no held PayPal money"] = /not_a_paypal_job/.test(e.message) ? "ok" : `wrong: ${e.message}`; }
let waitingRows = (await db.query("select * from public.paypal_cancelled_jobs_waiting(50)")).rows;
check("the watcher waits an hour after the cancel", !waitingRows.some((w) => w.job_id === JOB7), waitingRows);
await db.exec(`reset role; update jobs set cancelled_at = now() - interval '2 hours' where id = '${JOB7}'; set role service_role`);
waitingRows = (await db.query("select * from public.paypal_cancelled_jobs_waiting(50)")).rows;
check("the watcher lists a cancelled PayPal job still holding money, no cancel refund (paged daily)", waitingRows.some((w) => w.job_id === JOB7 && w.cancel_refund_status === null), waitingRows);
const sweep = async () => jx(claim6(P7, K(JOB7, "cancel"), 3847, "sandbox", 3847));
const s1 = await sweep(); const s2 = await sweep(); const s3 = await sweep();
waitingRows = (await db.query("select * from public.paypal_cancelled_jobs_waiting(50)")).rows;
check("...still lists it, refund under way, until the job is settled", waitingRows.some((w) => w.job_id === JOB7 && w.cancel_refund_status === "pending"), waitingRows);
check("cancel, then the cancellation sweep run 3 times = exactly ONE refund (one key)", s1.refund_id && s2.refund_id === s1.refund_id && s3.replay === true && (await one(`select count(*)::int n from provider_refunds where provider_payment_id='${P7}'`)).n === 1, { s1, s2, s3 });
await expectErr("phase 3's guard refuses a plain payment_status write on a PayPal job", `update jobs set payment_status = 'refunded' where id = '${JOB7}'`, /paypal_job_money_outside_paypal/);
o = await jx(`select public.paypal_job_mark_refunded('${JOB7}', '${s1.refund_id}', false, 'cancelled') j`);
check("paypal_job_mark_refunded settles it under the money flag", o.updated === 1 && (await one(`select payment_status from jobs where id='${JOB7}'`)).payment_status === "refunded", o);
check("...and the watcher drops it once settled", !(await db.query("select * from public.paypal_cancelled_jobs_waiting(50)")).rows.some((w) => w.job_id === JOB7), null);
await expectErr("...and the flag does not outlive the function", `update jobs set payment_status = 'escrow' where id = '${JOB7}'`, /paypal_job_money_outside_paypal/);
o = await jx(`select public.paypal_job_mark_refunded('${JOB7}', '${c3.refund_id}', false, 'cancelled') j`);
check("a refund of ANOTHER job cannot settle this one", /refund_not_for_job/.test(o.error ?? ""), o);
o = await jx(`select public.paypal_job_mark_refunded('${JOB7}', '${s1.refund_id}', true, 'open') j`);
check("compare-and-swap: a job no longer in the status read is left alone", o.updated === 0, o);

// orphan captures (phase 3's contract: voided + capture + status_reason 'orphan:%'; that column is phase 3's)
await db.exec("reset role; alter table public.provider_payments add column if not exists status_reason text; set role service_role");
const JOB5 = "b0000000-0000-4000-8000-000000000005";
const orphan = async (key, subject, amount, capture, reason) => (await one(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, provider_capture_id, status_reason)
  values ('job', '${subject}', '${U.tester}', 'paypal_checkout', 'sandbox', '${key}', 'O-${key}', ${amount}, 'voided', '${capture}', ${reason ? `'${reason}'` : "null"}) returning id`)).id;
const PO = await orphan("lh:job:p5:checkout:amt4000:a2", JOB5, 4000, "CAP-ORPH", "orphan:second_capture");
const PV = await orphan("lh:job:p5:checkout:amt4000:a3", JOB5, 4000, "CAP-VOID", null);
const odue = (await db.query("select * from public.paypal_orphan_refunds_due(20)")).rows;
check("an orphan capture is handed out for a full refund; a plain voided row is not", odue.some((r) => r.provider_payment_id === PO && r.orphan_reason === "orphan:second_capture") && !odue.some((r) => r.provider_payment_id === PV), odue);
const OK_ = (id) => `lh:pp:${id}:refund:orphan`;
o = await jx(claim6(PO, OK_(PO), 3000, "sandbox", null));
check("an orphan cannot be refunded in part", /orphan_refund_must_be_full/.test(o.error ?? ""), o);
o = await jx(claim6(PV, OK_(PV), 4000, "sandbox", null));
check("a voided row that is not an orphan still cannot be refunded", /refund_needs_captured_payment/.test(o.error ?? ""), o);
const co = await jx(claim6(PO, OK_(PO), 4000, "sandbox", 4000));
check("an orphan is refunded in full (card fee included: the money was never ours)", !!co.refund_id && co.status === "pending", co);
check("...and is not handed out twice", !(await db.query("select * from public.paypal_orphan_refunds_due(20)")).rows.some((r) => r.provider_payment_id === PO), null);
o = await jx(`select public.paypal_refund_record('${co.refund_id}', 'REF-ORPH', 'completed', 4000) j`);
check("a fully refunded orphan reads 'refunded' (phase 3's orphan alert clears)", o.payment_status === "refunded" && (await one(`select status from provider_payments where id='${PO}'`)).status === "refunded", o);

// PayPal refunds LESS than asked (phase 6's sandbox probe): the real amount is recorded and flagged.
const JOB6 = "b0000000-0000-4000-8000-000000000006";
await db.exec(`reset role; insert into jobs(id, customer_id, status, payment_status, budget) values ('${JOB6}', '${U.tester}', 'completed', 'escrow', 50); set role service_role`);
const P6 = await payRow("lh:job:p6:checkout:amt5000:a1", JOB6, 5000, "CAP6");
const c6 = await jx(claim6(P6, K(JOB6, "admin:a0000000-0000-4000-8000-000000000006"), 5000, "sandbox", null));
o = await jx(`select public.paypal_refund_record('${c6.refund_id}', 'REF-P6', 'completed', 3000) j`);
check("PayPal answering with less than asked: the real amount is recorded and flagged", o.amount_mismatch === true && Number(o.asked_cents) === 5000 && (await one(`select amount_cents from provider_refunds where id='${c6.refund_id}'`)).amount_cents === "3000" || (await one(`select amount_cents from provider_refunds where id='${c6.refund_id}'`)).amount_cents === 3000, o);
await expectErr("more than claimed is never recorded", `select public.paypal_refund_record('${c6.refund_id}', 'REF-P6', 'completed', 6000)`, /refund_amount_mismatch/);
const c6b = await jx(claim6(P6, K(JOB6, "admin:a0000000-0000-4000-8000-000000000007"), 1500, "sandbox", null));
o = await jx(recon("CAP6", "REF-P6B", "completed", 1200, "sandbox", c6b.refund_id));
check("a lost answer of a smaller amount is attached to the claim PayPal names, at PayPal's amount", o.outcome === "attached" && o.amount_mismatch === true && Number((await one(`select amount_cents from provider_refunds where id='${c6b.refund_id}'`)).amount_cents) === 1200, o);

// ── 3. who can call it ──
await db.exec("reset role");
for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  if (role === "authenticated") await db.exec(`set request.jwt.claim.sub = '${U.tester}'`);
  await expectErr(`${role} cannot claim a refund`, claim(P2, K(JOB2, "x"), 1), /permission denied/);
  await expectErr(`${role} cannot record a refund`, `select public.paypal_refund_record('${c3.refund_id}', 'R', 'completed', 1)`, /permission denied/);
  await expectErr(`${role} cannot reconcile`, recon("CAP2", "R", "completed", 1), /permission denied/);
  await expectErr(`${role} cannot settle a job's payment status`, `select public.paypal_job_mark_refunded('${JOB7}', '${c3.refund_id}', false, 'cancelled')`, /permission denied/);
  await expectErr(`${role} cannot list orphans`, "select * from public.paypal_orphan_refunds_due(1)", /permission denied/);
  await expectErr(`${role} cannot list waiting cancels`, "select * from public.paypal_cancelled_jobs_waiting(1)", /permission denied/);
  if (role === "anon") await expectErr("anon cannot use the PayPal cancel door", `select public.paypal_poster_cancel_job('${JOB7}')`, /permission denied/);
  await expectErr(`${role} cannot run the status sync`, `select public.paypal_payment_sync_refund_status('${P2}')`, /permission denied/);
  await db.exec("reset role");
}
await db.exec("set role service_role");
await expectErr("service_role cannot run the internal status sync directly", `select public.paypal_payment_sync_refund_status('${P2}')`, /permission denied/);
await db.exec("reset role");

const bad = Object.entries(r).filter(([, v]) => !String(v).startsWith("ok"));
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; phase 1 + this migration each applied 3x, then 2 replays after a flip)`);
process.exit(bad.length ? 1 : 0);
