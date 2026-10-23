#!/usr/bin/env node
/**
 * PGlite proof for 20261023223419_paypal_provider_foundation (PayPal Plan A, phase 1).
 *
 *   node src/test/pglite/paypalProviderFoundation.pglite.mjs
 *   PLANT=no_switch_trigger node src/test/pglite/paypalProviderFoundation.pglite.mjs   # RED: the switch checks fail
 *   PLANT=no_money_guards node src/test/pglite/paypalProviderFoundation.pglite.mjs     # RED: the payout/refund rules fail
 *   PLANT=reset_on_same_destination node src/test/pglite/paypalProviderFoundation.pglite.mjs  # RED: the 2026-10-23 body (payable could never turn on)
 *
 * Proves: the migration applies 3x and once more after an admin flip (the flip
 * survives); the paypal_payments switch is created OFF and, enforced in the
 * database, refuses a PayPal payment or payout destination for any member it is
 * off for, even when the service role writes it (crons and webhooks have no
 * user); refunds and payouts of money already taken still work after the
 * switch goes off; the five tables refuse members and the anon key outright;
 * the constraints (idempotency key, sender_batch_id, USD only, captured has a
 * capture id, payee has a destination) hold; one funded payment per job; the
 * payer cannot be moved; a new payee email resets verified; a payout
 * names its payment and claim row, copies and freezes its destination, never
 * exceeds the payment (with refunds); no refund while a payout is queued; a
 * MANUAL payout (the launch path: an admin pays by hand) reads paid only with
 * PayPal's transaction id, who marked it and when, one transaction id marks one
 * payout, and once marked its money fields are frozen.
 *
 * Prod-shaped: service_role has BYPASSRLS (pg_roles, 2026-10-23);
 * has_role and feature_enabled_for_user are prod's definitions
 * (pg_get_functiondef / 20261012031120).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
let mig = readFileSync(new URL("../../../supabase/migrations/20261023223419_paypal_provider_foundation.sql", import.meta.url).pathname, "utf8");
if (process.env.PLANT === "no_switch_trigger") {
  mig = mig.replace(/CREATE TRIGGER trg_provider_payments_requires_switch[\s\S]*?;/, "").replace(/CREATE TRIGGER trg_payee_accounts_requires_switch[\s\S]*?;/, "");
}
if (process.env.PLANT === "reset_on_same_destination") {
  // The body pp-phase2/pp-phase4 measured: the reset ran on the turn-ON path too.
  mig = mig.replace(/      ELSE\n        -- A new destination \(or owner\)[\s\S]*?NEW\.verified := false;\n      END IF;\n/, "      END IF;\n      NEW.verified := false; NEW.payable := false;\n");
}
if (process.env.PLANT === "no_money_guards") {
  mig = mig.replace(/CREATE TRIGGER trg_provider_payouts_guard[\s\S]*?;/, "").replace(/CREATE TRIGGER trg_provider_refunds_guard[\s\S]*?;/, "");
}
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
for (let i = 1; i <= 3; i++) await db.exec(mig);
r.applied3x = "ok";
r.switchOff = (await db.query("select audience from feature_switches where key='paypal_payments'")).rows[0]?.audience === "off" ? "ok" : "bad";

const pay = (u, key, opts = {}) => `insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, provider_capture_id)
  values ('job', '${opts.subject ?? "a0000000-0000-4000-8000-" + key.padStart(12, "0").slice(-12).replace(/[^0-9a-f]/g, "0")}', '${u}', 'paypal_checkout', 'sandbox', '${key}', 'O-${key}', ${opts.amount ?? 10000}, '${opts.status ?? "created"}', ${opts.capture === undefined ? "null" : `'${opts.capture}'`})`;
const payee = (u, email) => `insert into payee_accounts(user_id, provider, env, paypal_email) values ('${u}', 'paypal', 'sandbox', '${email}')`;
const JOB = "b0000000-0000-4000-8000-000000000001";
const PT = ["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002", "c0000000-0000-4000-8000-000000000003", "c0000000-0000-4000-8000-000000000004"];
const payout = (pt, payId, amount, extra = "") => `insert into provider_payouts(provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents${extra ? ", status, marked_paid_at, marked_paid_by, external_txn_id" : ""})
  values ('${payId}', '${pt}', '${U.tester}', 'manual_paypal', 'sandbox', 'paypal_email', 't@example.com', ${amount}${extra})`;
const one = async (sql) => (await db.query(sql)).rows[0];

await db.exec("set role service_role");
await expectErr("off: service role cannot create a payment for a tester", pay(U.tester, "k0"), /feature_disabled/);
await expectErr("off: nor a payee destination", payee(U.tester, "t@example.com"), /feature_disabled/);
await db.exec("reset role");
await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");
await db.exec(mig);
r.replayKeepsFlip = (await one("select audience from feature_switches where key='paypal_payments'"))?.audience === "testers" ? "ok" : "bad";
await db.exec(`reset role; insert into payout_transfers(id) values ${PT.map((x) => `('${x}')`).join(", ")}; set role service_role`);

// --- entry: the switch
await expectErr("testers: ordinary member refused (payment)", pay(U.ordinary, "k1"), /feature_disabled/);
await expectOk("testers: tester allowed (payment)", pay(U.tester, "k2", { subject: JOB, status: "captured", capture: "C2" }));
await expectOk("testers: admin allowed (payment)", pay(U.admin, "k3", { status: "captured", capture: "C3" }));
await expectErr("payer cannot be moved to someone else", `update provider_payments set payer_id='${U.ordinary}' where idempotency_key='k2'`, /payer_immutable/);
await expectOk("payer may become null (account deletion)", `update provider_payments set payer_id=null where idempotency_key='k3'`);
await expectErr("one funded payment per job (second tab, second capture)", pay(U.tester, "k4", { subject: JOB, status: "captured", capture: "C4" }), /one_funded_per_subject/);
await expectOk("an unfunded second order for the same job is fine", pay(U.tester, "k5", { subject: JOB }));
await expectErr("same idempotency key twice", pay(U.tester, "k2"), /duplicate key/);
await expectErr("captured without a capture id", pay(U.tester, "k6", { status: "captured" }), /captured_has_capture/);
await expectErr("capture_pending without a capture id", pay(U.tester, "k6", { status: "capture_pending" }), /captured_has_capture/);
await expectErr("zero amount", pay(U.tester, "k7", { amount: 0 }), /check constraint/);
await expectErr("unknown provider", pay(U.tester, "k8").replace("'paypal_checkout'", "'stripe'"), /check constraint/);

// --- payee destinations
await expectErr("testers: ordinary member refused (payee)", payee(U.ordinary, "o@example.com"), /feature_disabled/);
await expectOk("testers: tester payee allowed", payee(U.tester, "t@example.com"));
await expectOk("server marks it verified and payable", `update payee_accounts set verified=true, payable=true where user_id='${U.tester}'`);
r["the same destination keeps verified=true, payable=true (stored)"] = JSON.stringify(await one(`select verified, payable from payee_accounts where user_id='${U.tester}' and env='sandbox'`)) === '{"verified":true,"payable":true}' ? "ok" : "bad";
await expectOk("upsert on the same destination (INSERT .. ON CONFLICT DO UPDATE)", `insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.tester}', 'paypal', 'sandbox', 't@example.com', true) on conflict (user_id, provider, env) do update set payable = excluded.payable, paypal_email = excluded.paypal_email`);
r["the upsert leaves the stored flags on"] = JSON.stringify(await one(`select verified, payable from payee_accounts where user_id='${U.tester}' and env='sandbox'`)) === '{"verified":true,"payable":true}' ? "ok" : "bad";
await expectErr("payee row cannot be moved to an ordinary member", `update payee_accounts set user_id='${U.ordinary}' where user_id='${U.tester}'`, /feature_disabled/);
await expectOk("changing the email is allowed for a tester", `update payee_accounts set paypal_email='t2@example.com' where user_id='${U.tester}'`);
r["a new email resets verified (payable is the writer's call)"] = JSON.stringify(await one(`select verified, payable from payee_accounts where user_id='${U.tester}' and env='sandbox'`)) === '{"verified":false,"payable":true}' ? "ok" : "bad";
await expectErr("payee needs a destination", `insert into payee_accounts(user_id, provider, env) values ('${U.admin}', 'paypal', 'sandbox')`, /payee_accounts_has_destination/);
await expectErr("payee network is PayPal only", `insert into payee_accounts(user_id, provider, env, paypal_email) values ('${U.admin}', 'paypal_payouts', 'sandbox', 'a@example.com')`, /check constraint/);
await expectOk("sandbox and live destinations are separate rows", `insert into payee_accounts(user_id, provider, env, paypal_email) values ('${U.tester}', 'paypal', 'live', 'live@example.com')`);

// --- payouts and refunds out of payment k2 ($100.00)
const K2 = (await one("select id from provider_payments where idempotency_key='k2'")).id;
await expectErr("a payout must name its claim row", payout(PT[0], K2, 9000).replace(`'${PT[0]}'`, "null"), /null value|not-null/);
await expectErr("a payout needs a destination", payout(PT[0], K2, 9000).replace("'t@example.com'", "' '"), /check constraint/);
await expectErr("a payout cannot exceed its payment", payout(PT[0], K2, 10001), /payout_exceeds_payment/);
await expectOk("manual payout queued", payout(PT[0], K2, 9000));
await expectErr("payouts together cannot exceed the payment", payout(PT[1], K2, 1001), /payout_exceeds_payment/);
await expectErr("no refund while a payout is queued (admin may already have sent it)", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${K2}', 'rf0', 500)`, /refund_after_payout_queued/);
await expectErr("a queued payout's destination is frozen", `update provider_payouts set destination_value='thief@example.com' where payout_transfer_id='${PT[0]}'`, /payout_destination_is_frozen/);
await expectErr("manual payout cannot read paid without the PayPal transaction id", `update provider_payouts set status='success', marked_paid_at=now(), marked_paid_by='${U.admin}' where payout_transfer_id='${PT[0]}'`, /manual_success_has_evidence/);
await expectErr("manual payout cannot read paid without who marked it", `update provider_payouts set status='success', marked_paid_at=now(), external_txn_id='9AB12345CD678901E' where payout_transfer_id='${PT[0]}'`, /manual_success_has_evidence/);
await expectErr("a manual payout cannot carry API batch fields", `update provider_payouts set sender_batch_id='lh_x_00000001' where payout_transfer_id='${PT[0]}'`, /manual_fields/);
await expectOk("manual payout marked paid with its evidence", `update provider_payouts set status='success', marked_paid_at=now(), marked_paid_by='${U.admin}', external_txn_id='9AB12345CD678901E' where payout_transfer_id='${PT[0]}'`);
await expectErr("once marked paid, the amount is frozen", `update provider_payouts set amount_cents=100 where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectErr("once marked paid, the transaction id is frozen", `update provider_payouts set external_txn_id='OTHER' where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectErr("one PayPal transaction id cannot mark two payouts", payout(PT[1], K2, 100, `, 'success', now(), '${U.admin}', '9AB12345CD678901E'`), /duplicate key/);
await expectErr("a paid payout cannot be cancelled (that would re-open a refund)", `update provider_payouts set status='canceled' where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectErr("nor failed", `update provider_payouts set status='failed' where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectErr("still no refund once paid", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${K2}', 'rf0b', 500)`, /refund_after_payout_queued/);
await expectErr("a paid payout comes back only with a return reference", `update provider_payouts set status='returned' where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectErr("an API payout needs its batch key", payout(PT[1], K2, 100).replace("'manual_paypal'", "'paypal_payouts'"), /api_fields/);

await expectOk("returned with PayPal's reference", `update provider_payouts set status='returned', return_ref='RET-123' where payout_transfer_id='${PT[0]}'`);
await expectErr("the return reference is then frozen", `update provider_payouts set return_ref='RET-999' where payout_transfer_id='${PT[0]}'`, /payout_marked_paid_is_frozen/);
await expectOk("after the Helpr's payout came back, the poster can be refunded", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${K2}', 'rf0c', 500)`);
await expectErr("no refund of a payment that was never captured", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) select id, 'rf0d', 100 from provider_payments where idempotency_key='k5'`, /refund_needs_captured_payment/);
await expectOk("payment k10 (disputed)", pay(U.tester, "k10", { status: "disputed", capture: "C10", amount: 1000 }));
await db.exec("reset role"); await db.exec("insert into payout_transfers(id) values ('c0000000-0000-4000-8000-000000000005'), ('c0000000-0000-4000-8000-000000000006')"); await db.exec("set role service_role");
await expectErr("no payout out of disputed money", payout("c0000000-0000-4000-8000-000000000005", (await one("select id from provider_payments where idempotency_key='k10'")).id, 500), /payout_needs_settled_payment/);
// refunds on a fresh payment k9 ($50.00): refunds cap, then a payout must fit what is left
await expectOk("payment k9", pay(U.tester, "k9", { status: "captured", capture: "C9", amount: 5000 }));
const K9 = (await one("select id from provider_payments where idempotency_key='k9'")).id;
await expectOk("partial refund 20.00 (pending)", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${K9}', 'rf1', 2000)`);
await expectErr("refunds cannot exceed the payment", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${K9}', 'rf2', 3001)`, /refund_exceeds_payment/);
await expectErr("a payout cannot exceed what refunds left", payout(PT[2], K9, 3001), /payout_exceeds_payment/);
await expectOk("a payout of what is left is fine", payout(PT[2], K9, 3000));
await expectOk("the pending refund can still be recorded as completed afterwards", `update provider_refunds set status='completed', provider_refund_id='R1' where idempotency_key='rf1'`);
await expectOk("a failed refund row can be recorded", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents, status) values ('${K9}', 'rf9', 100, 'failed')`);
await expectErr("but not revived once a payout is queued", `update provider_refunds set status='pending' where idempotency_key='rf9'`, /refund_after_payout_queued/);

// the switch going off later must not strand money already taken
await db.exec("reset role"); await db.exec("update feature_switches set audience='off' where key='paypal_payments'"); await db.exec("set role service_role");
await expectOk("off later: an admin can still turn a destination off", `update payee_accounts set payable=false where user_id='${U.tester}' and env='sandbox'`);
await expectErr("off later: but not turn one on", `update payee_accounts set payable=true where user_id='${U.tester}' and env='sandbox'`, /feature_disabled/);
await expectErr("off later: but not point it somewhere new", `update payee_accounts set paypal_email='x@example.com' where user_id='${U.tester}' and env='sandbox'`, /feature_disabled/);
await expectOk("off later: refund of an existing payment still allowed", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) select id, 'rf3', 1000 from provider_payments where idempotency_key='k3'`);
r.refundRowWritten = (await one("select count(*)::int n from provider_refunds where idempotency_key='rf3'")).n === 1 ? "ok" : "bad: no refund row";
await expectOk("off later: payout of an existing payment still allowed", payout(PT[3], (await one("select id from provider_payments where idempotency_key='k3'")).id, 5000));

// webhook inbox
await expectOk("webhook event stored", `insert into paypal_webhook_events(event_id, event_type, env, payload) values ('WH-1', 'PAYMENT.CAPTURE.COMPLETED', 'sandbox', '{}') on conflict (event_id) do nothing`);
await expectOk("webhook redelivery is a no-op", `insert into paypal_webhook_events(event_id, event_type, env, payload) values ('WH-1', 'PAYMENT.CAPTURE.COMPLETED', 'sandbox', '{}') on conflict (event_id) do nothing`);
r.oneEventRow = (await one("select count(*)::int n from paypal_webhook_events")).n === 1 ? "ok" : "bad";
await db.exec("reset role");

for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  if (role === "authenticated") await db.exec(`set request.jwt.claim.sub = '${U.tester}'`);
  for (const t of ["provider_payments", "provider_refunds", "provider_payouts", "payee_accounts", "paypal_webhook_events"]) {
    await expectErr(`${role} cannot read ${t}`, `select * from ${t}`, /permission denied/);
  }
  await expectErr(`${role} cannot insert a payee`, `insert into payee_accounts(user_id, provider, env, paypal_email) values ('${U.tester}', 'paypal', 'sandbox', 'x@example.com')`, /permission denied/);
  for (const fn of ["paypal_entry_requires_switch", "provider_payouts_guard", "provider_refunds_guard"]) {
    await expectErr(`${role} cannot call ${fn}`, `select public.${fn}()`, /permission denied|trigger functions can only be called as triggers/);
  }
  await db.exec("reset role");
}
for (const fn of ["paypal_entry_requires_switch", "provider_payouts_guard", "provider_refunds_guard"]) {
  const acl = (await db.query(`select proacl::text a from pg_proc where proname='${fn}'`)).rows[0].a;
  r[`${fn} acl`] = !/(^|[{,])=X|anon=X|authenticated=X/.test(acl ?? "") ? `ok (${acl})` : `bad (${acl})`;
}

const bad = Object.entries(r).filter(([, v]) => !String(v).startsWith("ok"));
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; migration applied 3x + 1 replay after a flip)`);
process.exit(bad.length ? 1 : 0);
