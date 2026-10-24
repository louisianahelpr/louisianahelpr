#!/usr/bin/env node
/**
 * PGlite proof for 20261023232059_paypal_tips (PayPal tips, on top of phase 1's
 * 20261023223419_paypal_provider_foundation).
 *
 *   node src/test/pglite/paypalTips.pglite.mjs
 *   PLANT=no_link_guard node src/test/pglite/paypalTips.pglite.mjs   # RED: a tip payout can pay out of the wrong money / to the wrong member
 *   PLANT=no_amount_check node src/test/pglite/paypalTips.pglite.mjs # RED: a short capture reads as a paid tip
 *   PLANT=no_admin_check node src/test/pglite/paypalTips.pglite.mjs  # RED: a member can re-queue a tip payout
 *   PLANT=no_email_change_hold node src/test/pglite/paypalTips.pglite.mjs  # RED: a PayPal email swapped after the hire is paid
 *   PLANT=strict_gt / PLANT=null_anchor_pays                                # RED: a change at the hire time / a job with no hire time is paid
 * (The FOR SHARE lock on the payee row is a two-session race; one PGlite session cannot show it.)
 *
 * Proves: both migrations apply 3x; a tip opens as one pending tips row + one
 * provider_payments row (subject 'tip'), and a retry of the same attempt finds
 * the same rows; the switch (phase 1's trigger) refuses a tip for a payer it is
 * off for, even through the service role; paypal_record_tip_capture is
 * idempotent (return page + webhook + replays = one capture, one 'paid' flip,
 * one Helpr notification, one payout); the payout is manual_paypal, pending,
 * exactly the tip (the Helpr keeps 100%; the poster paid the fee on top), to
 * the Helpr's payable PayPal email, frozen; a held Helpr's tip payout is
 * recorded 'held', not 'pending'; no payable destination = captured and paid
 * but no payout row (the caller alerts); a pending capture is not a paid tip; a
 * decline fails the tip but never undoes settled money; a short capture is
 * refused; a tip payout cannot pay out of another payment or to another member,
 * a job payout cannot pay out of a tip's payment, exactly one of claim row /
 * tip is set; phase 1's refund rule holds for tips (no refund once the tip
 * payout is queued; refunds before it are capped at the payment); members and
 * the anon key cannot call either function; only an admin re-queues a held
 * tip payout (or an owed tip with no row) to the Helpr's CURRENT email, after
 * confirming no Send Money went out, never past a hold, audited.
 *
 * Prod-shaped: tips columns, constraints and notify_helper_on_tip are prod's
 * (information_schema / pg_get_functiondef, 2026-10-23); service_role has
 * BYPASSRLS; has_role and feature_enabled_for_user are prod's definitions.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const readMig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const base = readMig("20261023223419_paypal_provider_foundation.sql");
let mig = readMig("20261023232059_paypal_tips.sql");
if (process.env.PLANT === "no_link_guard") mig = mig.replace(/CREATE TRIGGER trg_provider_payouts_tip_link_guard[\s\S]*?;/, "");
if (process.env.PLANT === "no_email_change_hold") mig = mig.replace("(v_approved_at IS NULL OR v_changed_at >= v_approved_at)", "false");
if (process.env.PLANT === "strict_gt") mig = mig.replace("v_changed_at >= v_approved_at", "v_changed_at > v_approved_at");
if (process.env.PLANT === "null_anchor_pays") mig = mig.replace("(v_approved_at IS NULL OR v_changed_at >= v_approved_at)", "(v_approved_at IS NOT NULL AND v_changed_at >= v_approved_at)");
if (process.env.PLANT === "no_admin_check") mig = mig.replace("IF v_admin IS NULL OR NOT COALESCE(public.has_role(v_admin, 'admin'::app_role), false) THEN", "IF false THEN");
if (process.env.PLANT === "no_amount_check") mig = mig.replace(/IF p_amount_cents IS DISTINCT FROM v_pay\.amount_cents THEN/, "IF false THEN");

const db = new PGlite();
const U = {
  ordinary: "11111111-1111-4111-8111-111111111111",
  poster: "22222222-2222-4222-8222-222222222222",
  helpr: "44444444-4444-4444-8444-444444444444",
  helpr2: "55555555-5555-4555-8555-555555555555",
  heldHelpr: "66666666-6666-4666-8666-666666666666",
  admin: "33333333-3333-4333-8333-333333333333",
};
const JOB = "b0000000-0000-4000-8000-000000000001";
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; -- as on Supabase
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create type public.app_role as enum ('admin','customer','helper');
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
REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid) TO service_role;
-- prod definitions of feature_enabled_for / require_feature (20261012031120)
CREATE OR REPLACE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.feature_enabled_for_user(p_key, (SELECT auth.uid())); $function$;
CREATE OR REPLACE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.feature_enabled_for(p_key) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501', DETAIL = format('feature %s is not available to this account', p_key);
  END IF;
END;
$function$;
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(), admin_id uuid not null, action text not null, target_type text, target_id text, details jsonb, created_at timestamptz not null default now());
create table public.payout_transfers(id uuid primary key default gen_random_uuid());
create table public.jobs(id uuid primary key, title text, accepted_at timestamptz, poster_completed_at timestamptz, helper_completed_at timestamptz);
create table public.profiles(user_id uuid primary key, full_name text);
create table public.notification_preferences(user_id uuid primary key, financial_alerts boolean);
create table public.notifications(id bigserial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
create function public.member_display_name(n text, fallback text) returns text language sql as $$ select coalesce(split_part(n, ' ', 1), fallback) $$;
create function public.log_notification(a uuid, b text, c text, d text, e text, f uuid) returns void language sql as $$ select $$;
create table public.payout_holds(helper_id uuid primary key, reason text);
create table public.ban_settlement_queue(user_id uuid, review_state text);
-- prod's tips (information_schema.columns + pg_constraint, 2026-10-23)
create table public.tips(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  tipper_id uuid not null, helper_id uuid not null, amount numeric not null,
  stripe_session_id text, payment_status text not null default 'pending',
  created_at timestamptz not null default now(), stripe_payment_intent_id text,
  source text not null default 'manual', auto_prompt_sent_at timestamptz, failure_reason text,
  constraint tips_amount_positive check (amount > 0 and amount <= 1000),
  constraint tips_payment_status_valid check (payment_status in ('pending','paid','failed')),
  constraint tips_source_valid check (source in ('manual','auto')));
-- prod's notify_helper_on_tip (pg_get_functiondef, 2026-10-23)
CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pref boolean; v_title text; v_msg text; v_job_title text; v_tipper text; v_amount text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    SELECT public.member_display_name(p.full_name, 'Someone') INTO v_tipper FROM public.profiles p WHERE p.user_id = NEW.tipper_id;
    v_amount := '$' || to_char(NEW.amount, 'FM999999990.00');
    v_title := COALESCE(v_tipper, 'Someone') || ' tipped you ' || v_amount;
    v_msg := 'All of it is yours, for "' || COALESCE(v_job_title, 'your work') || '".';
    SELECT COALESCE(financial_alerts, true) INTO v_pref FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/tips/' || NEW.id, NEW.job_id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_notify_helper_tip AFTER INSERT OR UPDATE ON public.tips FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_tip();
-- prod's one-auto-tip index (pg_indexes, 2026-10-23)
CREATE UNIQUE INDEX tips_one_auto_per_job_member ON public.tips (job_id, helper_id) WHERE (source = 'auto');
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select on public.feature_switches, public.test_accounts, public.user_roles, public.payout_holds, public.ban_settlement_queue to service_role;
grant all on public.tips, public.jobs, public.notifications, public.payout_transfers to service_role;
grant usage on all sequences in schema public to service_role;
grant select on public.tips to authenticated;
insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(", ")};
insert into public.test_accounts(user_id) values ('${U.poster}'), ('${U.helpr}'), ('${U.helpr2}'), ('${U.heldHelpr}');
insert into public.user_roles values ('${U.admin}', 'admin');
insert into public.jobs values ('${JOB}', 'Move a couch', now() - interval '3 days', now() - interval '1 day', null);
insert into public.profiles values ('${U.poster}', 'Lexi Test');
insert into public.payout_holds values ('${U.heldHelpr}', 'staff review');
`);
const r = {};
const expectErr = async (label, sql, re) => {
  try { await db.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, sql) => {
  try { await db.query(sql); r[label] = "ok"; } catch (e) { r[label] = `bad: ${e.message}`; }
};
const one = async (sql) => (await db.query(sql)).rows[0];
/** Like one(), but a thrown error becomes a named failure instead of crashing the run (a PLANT can make a call throw). */
const oneJ = async (label, sql) => { try { return (await one(sql)).j; } catch (e) { r[label] = `bad: threw ${e.message}`; return {}; } };
const check = (label, cond, got) => { r[label] = cond ? "ok" : `bad: ${JSON.stringify(got)}`; };

for (let i = 1; i <= 3; i++) { await db.exec(base); await db.exec(mig); }
r.applied3x = "ok";

const open = (helper, tipCents, chargeCents, key, order, payer = U.poster) =>
  `select public.paypal_open_tip('${JOB}', '${payer}', '${helper}', ${tipCents}, ${chargeCents}, 'sandbox', '${key}', '${order}') j`;
const record = (payId, order, outcome, cap, amount) =>
  `select public.paypal_record_tip_capture('${payId}', '${order}', '${outcome}', ${cap === null ? "null" : `'${cap}'`}, ${amount}) j`;

// --- the switch: off for everyone, even through the service role
await db.exec("set role service_role");
await expectErr("off: the service role cannot open a tip (phase 1's entry trigger)", open(U.helpr, 500, 568, "lh:tip:x:checkout:amt568:a1", "ORD0"), /feature_disabled/);
r["off: no orphan tips row left behind"] = (await one("select count(*)::int n from tips")).n === 0 ? "ok" : "bad";
await db.exec("reset role; update feature_switches set audience='testers' where key='paypal_payments'; set role service_role");
await expectErr("testers: an ordinary payer is refused", open(U.helpr, 500, 568, "lh:tip:o:checkout:amt568:a1", "ORDO", U.ordinary), /feature_disabled/);

// --- input rules
await expectErr("under $3 refused", open(U.helpr, 299, 350, "lh:tip:a:checkout:amt350:a1", "ORDA"), /tip_amount_out_of_range/);
await expectErr("over $1,000 refused", open(U.helpr, 100001, 103700, "lh:tip:b:checkout:amt103700:a1", "ORDB"), /tip_amount_out_of_range/);
await expectErr("the charge must exceed the tip (the fee is on top)", open(U.helpr, 500, 500, "lh:tip:c:checkout:amt500:a1", "ORDC"), /tip_charge_must_exceed_tip/);
await expectErr("the key must name the charged amount", open(U.helpr, 500, 568, "lh:tip:d:checkout:amt500:a1", "ORDD"), /tip_key_must_name_amount/);

// --- open, and a retry of the same attempt
const K1 = "lh:tip:job1:checkout:amt568:a1";
const o1 = (await one(open(U.helpr, 500, 568, K1, "ORD1"))).j;
const o1b = (await one(open(U.helpr, 500, 568, K1, "ORD1"))).j;
check("open: a pending tip and a created payment", o1.status === "created" && o1.replay === false, o1);
check("retry of the same attempt finds the same rows", o1b.replay === true && o1b.tip_id === o1.tip_id && o1b.provider_payment_id === o1.provider_payment_id, o1b);
const counts = await one("select (select count(*) from tips)::int t, (select count(*) from provider_payments)::int p");
check("one tips row, one payment row", counts.t === 1 && counts.p === 1, counts);
check("the tips row is the tip, pending, manual, for the Helpr", (await one(`select amount = 5 and payment_status = 'pending' and source = 'manual' and helper_id = '${U.helpr}' ok from tips where id='${o1.tip_id}'`)).ok === true, null);
const pay1 = await one(`select amount_cents::int a, subject_kind k, subject_id::text s from provider_payments where id='${o1.provider_payment_id}'`);
check("the payment is the tip + fee, subject = this tip", pay1.a === 568 && pay1.k === "tip" && pay1.s === o1.tip_id, pay1);
await expectErr("a key reused with a different order is refused", open(U.helpr, 500, 568, K1, "ORD-OTHER"), /tip_key_reused/);

// --- capture without a payable destination: paid, owed, no payout
const c0 = (await one(record(o1.provider_payment_id, "ORD1", "completed", "CAP1", 568))).j;
check("captured, tip paid, no destination yet -> no payout row", c0.payment_status === "captured" && c0.tip_status === "paid" && c0.payout_id === null && c0.payout_reason === "no_payable_destination", c0);
await expectOk("Helpr sets a PayPal email (server marks it payable)", `insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.helpr}', 'paypal', 'sandbox', 'helpr@example.com', true)`);
// replays: the return page, the webhook, redeliveries
const c1 = (await one(record(o1.provider_payment_id, "ORD1", "completed", "CAP1", 568))).j;
const c2 = (await one(record(o1.provider_payment_id, "ORD1", "completed", "CAP1", 568))).j;
const c3 = (await one(record(o1.provider_payment_id, "ORD1", "completed", "CAP1", 568))).j;
check("a later call queues the payout", c1.payout_reason === "queued" && c1.payout_status === "pending", c1);
check("replays change nothing (same payout)", c2.payout_id === c1.payout_id && c3.payout_reason === "already_queued", [c2, c3]);
check("one capture recorded", (await one(`select count(*)::int n from provider_payments where provider_capture_id='CAP1'`)).n === 1, null);
check("one payout for the tip", (await one(`select count(*)::int n from provider_payouts where tip_id='${o1.tip_id}'`)).n === 1, null);
check("the Helpr was told once", (await one(`select count(*)::int n from notifications where user_id='${U.helpr}'`)).n === 1, null);
const p1 = await one(`select provider, status, amount_cents::int a, destination_kind, destination_value, payee_user_id::text u, payout_transfer_id from provider_payouts where tip_id='${o1.tip_id}'`);
check("payout: manual_paypal, pending, exactly the tip, to the Helpr's email", p1.provider === "manual_paypal" && p1.status === "pending" && p1.a === 500 && p1.destination_kind === "paypal_email" && p1.destination_value === "helpr@example.com" && p1.u === U.helpr && p1.payout_transfer_id === null, p1);
await expectErr("a different capture for the same tip is refused", record(o1.provider_payment_id, "ORD1", "completed", "CAP-OTHER", 568), /tip_capture_mismatch/);
await expectErr("the wrong order is refused", record(o1.provider_payment_id, "ORD-X", "completed", "CAP1", 568), /tip_order_mismatch/);
const late = (await one(record(o1.provider_payment_id, "ORD1", "failed", null, 568))).j;
check("a late 'declined' never undoes settled money", late.payment_status === "captured" && late.tip_status === "paid", late);
await expectErr("the tip payout's destination is frozen (phase 1)", `update provider_payouts set destination_value='thief@example.com' where tip_id='${o1.tip_id}'`, /payout_destination_is_frozen/);
await expectErr("the tip payout's link is frozen", `update provider_payouts set tip_id=null where tip_id='${o1.tip_id}'`, /payout_link_is_frozen|claim_or_tip/);
await expectErr("no refund once the tip payout is queued (phase 1)", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${o1.provider_payment_id}', 'rf-t1', 100)`, /refund_after_payout_queued/);
await expectErr("a second live payout for the same tip is refused", `insert into provider_payouts(provider_payment_id, tip_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${o1.provider_payment_id}', '${o1.tip_id}', '${U.helpr}', 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', 68)`, /one_live_per_tip|duplicate key/);

// --- a short capture never reads as paid
const K2 = "lh:tip:job1:checkout:amt1087:a2";
const o2 = (await one(open(U.helpr2, 1000, 1087, K2, "ORD2"))).j;
await expectErr("a short capture is refused", record(o2.provider_payment_id, "ORD2", "completed", "CAP2", 1000), /tip_capture_amount_mismatch/);
check("... and the tip stays pending", (await one(`select payment_status s from tips where id='${o2.tip_id}'`)).s === "pending", null);
// pending capture (eCheck): not a paid tip, no payout; then it settles
await expectOk("Helpr 2 email", `insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.helpr2}', 'paypal', 'sandbox', 'h2@example.com', true)`);
const pend = (await one(record(o2.provider_payment_id, "ORD2", "pending", "CAP2", 1087))).j;
check("a pending capture is not a paid tip and queues nothing", pend.payment_status === "capture_pending" && pend.tip_status === "pending" && pend.payout_id === null, pend);
const done = (await one(record(o2.provider_payment_id, "ORD2", "completed", "CAP2", 1087))).j;
check("when it settles: paid and queued", done.payment_status === "captured" && done.tip_status === "paid" && done.payout_status === "pending", done);
check("payout is the tip ($10.00), not the charge ($10.87)", (await one(`select amount_cents::int a from provider_payouts where tip_id='${o2.tip_id}'`)).a === 1000, null);

// --- decline before anything settled
const o3 = (await one(open(U.helpr, 300, 362, "lh:tip:job1:checkout:amt362:a3", "ORD3"))).j;
const dec = (await one(record(o3.provider_payment_id, "ORD3", "failed", null, 362))).j;
check("a decline fails the payment and the tip", dec.payment_status === "failed" && dec.tip_status === "failed", dec);
// a refund before the payout is queued is capped at the payment (phase 1)
const o4 = (await one(open(U.helpr2, 2000, 2122, "lh:tip:job1:checkout:amt2122:a4", "ORD4"))).j;
await expectOk("captured tip with its payout cancelled by an admin", record(o4.provider_payment_id, "ORD4", "completed", "CAP4", 2122));
await expectOk("admin cancels that payout", `update provider_payouts set status='canceled' where tip_id='${o4.tip_id}'`);
await expectErr("a tip refund cannot exceed the tip's payment", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${o4.provider_payment_id}', 'rf-t4', 2123)`, /refund_exceeds_payment/);
await expectOk("a tip refund of the whole payment is fine once nothing is queued", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${o4.provider_payment_id}', 'rf-t4b', 2122)`);

// --- held Helpr: recorded 'held', not payable from the queue
await expectOk("held Helpr email", `insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.heldHelpr}', 'paypal', 'sandbox', 'held@example.com', true)`);
const o5 = (await one(open(U.heldHelpr, 500, 568, "lh:tip:job1:checkout:amt568:a5", "ORD5"))).j;
const h = (await one(record(o5.provider_payment_id, "ORD5", "completed", "CAP5", 568))).j;
check("a held Helpr's tip payout is 'held'", h.payout_status === "held" && h.payout_reason === "held", h);
check("... with its reason recorded for mark-paid", (await one(`select held_reason from provider_payouts where id='${h.payout_id}'`))?.held_reason === "payout_hold", null);

// --- a pending capture PayPal later DENIES is recorded as a decline
const o8 = (await one(open(U.helpr2, 700, 774, "lh:tip:job1:checkout:amt774:a8", "ORD8"))).j;
await expectOk("o8 pending capture", record(o8.provider_payment_id, "ORD8", "pending", "CAP8", 774));
const den = await oneJ("o8 denial ran", record(o8.provider_payment_id, "ORD8", "failed", null, 774));
check("a pending capture later denied: payment failed, tip failed, nothing queued", den.payment_status === "failed" && den.tip_status === "failed" && den.payout_id === null, den);

// --- an email changed AFTER the job was approved holds the tip payout (phase 4's rule for job pay;
//     destination_changed_at is phase 4's column, simulated here as phase 4 adds it)
await db.exec("reset role; alter table payee_accounts add column if not exists destination_changed_at timestamptz");
await db.exec(`update payee_accounts set destination_changed_at = now() where user_id='${U.helpr2}'`);
await db.exec("set role service_role");
const o9 = (await one(open(U.helpr2, 900, 980, "lh:tip:job1:checkout:amt980:a9", "ORD9"))).j;
const h9 = await oneJ("o9 capture ran", record(o9.provider_payment_id, "ORD9", "completed", "CAP9", 980));
check("an email changed since the Helpr was hired: the tip payout is held", h9.payout_status === "held" && h9.payout_reason === "held", h9);
check("... with reason destination_changed_since_hire (mark-paid refuses it)", (await one(`select held_reason from provider_payouts where id='${h9.payout_id}'`))?.held_reason === "destination_changed_since_hire", null);
// Changed after the hire but BEFORE the approval (the gap a completion-only anchor missed): held.
await db.exec(`reset role; update payee_accounts set destination_changed_at = now() - interval '2 days' where user_id='${U.helpr2}'; set role service_role`);
const o10 = (await one(open(U.helpr2, 900, 980, "lh:tip:job1:checkout:amt980:a10", "ORD10"))).j;
const p10 = await oneJ("o10 capture ran", record(o10.provider_payment_id, "ORD10", "completed", "CAP10", 980));
check("an email changed after the hire, before the approval: held", p10.payout_status === "held", p10);
// Set before the hire: pending.
await db.exec(`reset role; update payee_accounts set destination_changed_at = now() - interval '5 days' where user_id='${U.helpr2}'; set role service_role`);
const o11 = (await one(open(U.helpr2, 900, 980, "lh:tip:job1:checkout:amt980:a11", "ORD11"))).j;
const p11 = await oneJ("o11 capture ran", record(o11.provider_payment_id, "ORD11", "completed", "CAP11", 980));
check("an email set before the hire: the tip payout is pending", p11.payout_status === "pending", p11);
// Changed at exactly the hire time: held (>=, as phase 4).
await db.exec(`reset role; update jobs set accepted_at = '2026-10-20T12:00:00Z' where id='${JOB}'; update payee_accounts set destination_changed_at = '2026-10-20T12:00:00Z' where user_id='${U.helpr2}'; set role service_role`);
const o12 = (await one(open(U.helpr2, 900, 980, "lh:tip:job1:checkout:amt980:a12", "ORD12"))).j;
const p12 = await oneJ("o12 capture ran", record(o12.provider_payment_id, "ORD12", "completed", "CAP12", 980));
check("an email changed at exactly the hire time: held", p12.payout_status === "held", p12);
// A job with no hire or approval time: held whenever the change time is known.
await db.exec(`reset role; update jobs set accepted_at = null, poster_completed_at = null, helper_completed_at = null where id='${JOB}'; update payee_accounts set destination_changed_at = now() - interval '30 days' where user_id='${U.helpr2}'; set role service_role`);
const o13 = (await one(open(U.helpr2, 900, 980, "lh:tip:job1:checkout:amt980:a13", "ORD13"))).j;
const p13 = await oneJ("o13 capture ran", record(o13.provider_payment_id, "ORD13", "completed", "CAP13", 980));
check("a job with no hire or approval time: held", p13.payout_status === "held", p13);
// Back to the fixture's times, the change long before them, for the cases below.
await db.exec(`reset role; update jobs set accepted_at = now() - interval '3 days', poster_completed_at = now() - interval '1 day' where id='${JOB}'; set role service_role`);

// --- an auto-tip (phase 6): CLAIM FIRST (a pending 'auto' tips row), charge off-session, then hand the
//     claim to paypal_open_tip (p_tip_id) and record the capture. No return page.
const claim = (await one(`insert into tips(job_id, tipper_id, helper_id, amount, payment_status, source) values ('${JOB}', '${U.poster}', '${U.helpr2}', 5, 'pending', 'auto') returning id`)).id;
await expectErr("auto-tip: a second claim for the same job + Helpr is refused BEFORE any charge", `insert into tips(job_id, tipper_id, helper_id, amount, payment_status, source) values ('${JOB}', '${U.poster}', '${U.helpr2}', 5, 'pending', 'auto')`, /tips_one_auto_per_job_member|duplicate key/);
const autoKey = `lh:autotip:${claim}:charge:amt565:a1`;
const openAuto = (order) => `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', '${autoKey}', '${order}', 'auto', '${claim}') j`;
const oA = await oneJ("auto-tip open ran", openAuto("ORDA1"));
const oA2 = await oneJ("auto-tip retry ran", openAuto("ORDA1"));
check("auto-tip: the claim row is taken over (no second tips row); a cron retry finds the same rows",
  oA.tip_id === claim && oA2.replay === true && oA2.tip_id === claim && (await one(`select count(*)::int n from tips where source='auto'`)).n === 1, [oA, oA2]);
await expectErr("auto-tip: a replay naming a different claim is refused", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', '${autoKey}', 'ORDA1', 'auto', '${o1.tip_id}')`, /tip_key_reused/);
await expectErr("auto-tip: the claim's key cannot be replayed as a manual tip", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', '${autoKey}', 'ORDA1', 'manual')`, /tip_key_reused/);
await expectErr("auto-tip: a claim cannot take a second payment under another key", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', 'lh:autotip:other:charge:amt565:a1', 'ORDA9', 'auto', '${claim}')`, /tip_claim_has_payment/);
await expectErr("auto-tip: a claim for another amount is refused", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 600, 670, 'sandbox', 'lh:autotip:x:charge:amt670:a1', 'ORDA8', 'auto', '${claim}')`, /tip_claim_mismatch/);
await expectErr("a claim id is for auto-tips only", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', 'lh:tip:y:checkout:amt565:a1', 'ORDA7', 'manual', '${claim}')`, /tip_claim_is_auto_only/);
await expectErr("tip source must be manual or auto", `select public.paypal_open_tip('${JOB}', '${U.poster}', '${U.helpr2}', 500, 565, 'sandbox', 'lh:autotip:job1:charge:amt565:a3', 'ORDA3', 'gift')`, /tip_source_invalid/);
const cA = await oneJ("auto-tip capture ran", record(oA.provider_payment_id, "ORDA1", "completed", "CAPA1", 565));
check("auto-tip: recorded with no return page: paid and its payout queued (pending)", cA.tip_status === "paid" && cA.payout_status === "pending", cA);

// --- the link guard
await db.exec("reset role; insert into payout_transfers(id) values ('c0000000-0000-4000-8000-000000000009'); set role service_role");
const jobPay = "lh:job:x:checkout:amt9000:a1";
await expectOk("a job payment", `insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, provider_capture_id) values ('job', '${JOB}', '${U.poster}', 'paypal_checkout', 'sandbox', '${jobPay}', 'ORDJ', 9000, 'captured', 'CAPJ')`);
const jobPayId = (await one(`select id from provider_payments where idempotency_key='${jobPay}'`)).id;
await expectErr("a payout names exactly one of claim row / tip (neither)", `insert into provider_payouts(provider_payment_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${jobPayId}', '${U.helpr}', 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', 100)`, /claim_or_tip/);
await expectErr("a tip payout cannot pay out of a job's payment", `insert into provider_payouts(provider_payment_id, tip_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${jobPayId}', '${o3.tip_id}', '${U.helpr}', 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', 100)`, /tip_payout_wrong_payment/);
const o6 = (await one(open(U.helpr, 400, 463, "lh:tip:job1:checkout:amt463:a6", "ORD6"))).j;
await db.exec("reset role; delete from payee_accounts where user_id='" + U.helpr + "'; set role service_role");
await expectOk("tip 6 captured with no destination (no payout)", record(o6.provider_payment_id, "ORD6", "completed", "CAP6", 463));
await expectErr("a tip payout cannot go to another member", `insert into provider_payouts(provider_payment_id, tip_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${o6.provider_payment_id}', '${o6.tip_id}', '${U.helpr2}', 'manual_paypal', 'sandbox', 'paypal_email', 'h2@example.com', 400)`, /tip_payout_wrong_payee/);
await expectErr("a job payout cannot pay out of a tip's payment", `insert into provider_payouts(provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${o6.provider_payment_id}', 'c0000000-0000-4000-8000-000000000009', '${U.helpr}', 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', 400)`, /tip_payment_needs_tip_payout/);
await expectOk("a job payout out of the job's payment still works (claim row)", `insert into provider_payouts(provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents) values ('${jobPayId}', 'c0000000-0000-4000-8000-000000000009', '${U.helpr}', 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', 8000)`);

// --- admin re-queue of a held tip payout (o5: held Helpr) and of an owed tip with no row (o6)
const requeue = (tip, confirm) => `select public.admin_requeue_paypal_tip_payout('${tip}', ${confirm}) j`;
await db.exec("reset role");
for (const [label, who] of [["an ordinary member", U.ordinary], ["the Helpr", U.heldHelpr]]) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${who}'`);
  await expectErr(`re-queue: ${label} is refused`, requeue(o5.tip_id, true), /admin_only|feature_disabled/);
  await db.exec("reset role");
}
await db.exec(`set role authenticated; set request.jwt.claim.sub = '${U.admin}'`);
await expectErr("re-queue: refused while the Helpr is still on hold", requeue(o5.tip_id, true), /payout_held/);
await db.exec("reset role; delete from payout_holds where helper_id='" + U.heldHelpr + "'");
await db.exec(`set role authenticated; set request.jwt.claim.sub = '${U.admin}'`);
await expectErr("re-queue: the admin must confirm no Send Money went out", requeue(o5.tip_id, false), /confirm_no_send_money/);
const rq = await oneJ("re-queue o5 ran", requeue(o5.tip_id, true));
check("re-queue: the held row is canceled and a pending one queued", rq.outcome === "requeued" && rq.previous_payout_id && rq.payout_id !== rq.previous_payout_id, rq);
await expectErr("re-queue: a pending (not held) tip payout is not re-queued", requeue(o5.tip_id, true), /tip_payout_not_held/);
await expectErr("re-queue: no payable email -> refused (tip 6's Helpr removed theirs)", requeue(o6.tip_id, true), /no_payable_paypal_account/);
await expectErr("re-queue: a declined tip is never paid out", requeue(o3.tip_id, true), /tip_not_captured/);
await db.exec("reset role");
await db.exec(`insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ('${U.helpr}', 'paypal', 'sandbox', 'helpr-new@example.com', true)`);
await db.exec(`set role authenticated; set request.jwt.claim.sub = '${U.admin}'`);
const rq6 = await oneJ("re-queue o6 ran", requeue(o6.tip_id, false));
check("re-queue: an owed tip with no payout row is queued once the Helpr has an email", rq6.outcome === "requeued" && rq6.previous_payout_id === null, rq6);
await db.exec("reset role");
try {
const held5 = await one(`select (select status from provider_payouts where id='${rq.previous_payout_id}') old, (select status from provider_payouts where id='${rq.payout_id}') new, (select count(*)::int from admin_audit_log where action='paypal_tip_payout_requeued') audits`);
check("re-queue: old canceled, new pending, both audited", held5.old === "canceled" && held5.new === "pending" && held5.audits === 2, held5);
const p6 = await one(`select destination_value d, amount_cents::int a from provider_payouts where id='${rq6.payout_id}'`);
check("re-queue: to the CURRENT email, exactly the tip", p6.d === "helpr-new@example.com" && p6.a === 400, p6);
} catch (e) { r["re-queue rows read back"] = `bad: threw ${e.message}`; }
await db.exec("set role service_role");
const again5 = await oneJ("o5 replay ran", record(o5.provider_payment_id, "ORD5", "completed", "CAP5", 568));
check("a late webhook replay after a re-queue changes nothing", again5.payout_id === rq.payout_id && again5.payout_reason === "already_queued", again5);

// --- the switch going off later never strands money already taken
await db.exec("reset role; update feature_switches set audience='off' where key='paypal_payments'; set role service_role");
await expectErr("off later: no new tip", open(U.helpr2, 500, 568, "lh:tip:job1:checkout:amt568:a7", "ORD7"), /feature_disabled/);
const o2again = (await one(record(o2.provider_payment_id, "ORD2", "completed", "CAP2", 1087))).j;
check("off later: recording an existing tip's capture still works", o2again.payout_reason === "already_queued", o2again);
await db.exec("reset role");

for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  if (role === "authenticated") await db.exec(`set request.jwt.claim.sub = '${U.poster}'`);
  await expectErr(`${role} cannot open a tip`, open(U.helpr, 500, 568, "lh:tip:z:checkout:amt568:a1", "ORDZ"), /permission denied/);
  await expectErr(`${role} cannot record a capture`, record(o1.provider_payment_id, "ORD1", "completed", "CAP1", 568), /permission denied/);
  await db.exec("reset role");
}
for (const fn of ["paypal_open_tip", "paypal_record_tip_capture", "provider_payouts_tip_link_guard", "admin_requeue_paypal_tip_payout"]) {
  const acl = (await db.query(`select proacl::text a from pg_proc where proname='${fn}'`)).rows[0].a;
  // The admin RPC is callable by signed-in members (it refuses non-admins itself); the rest by the server only.
  const ok = fn.startsWith("admin_")
    ? !/(^|[{,])=X|anon=X/.test(acl ?? "") && /authenticated=X/.test(acl ?? "")
    : !/(^|[{,])=X|anon=X|authenticated=X/.test(acl ?? "");
  r[`${fn} acl`] = ok ? `ok (${acl})` : `bad (${acl})`;
}

const bad = Object.entries(r).filter(([, v]) => !String(v).startsWith("ok"));
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; both migrations applied 3x)`);
process.exit(bad.length ? 1 : 0);
