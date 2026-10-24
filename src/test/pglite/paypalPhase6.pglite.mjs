#!/usr/bin/env node
/**
 * PGlite proof for PayPal phase 6 (cancellation fees as partial refunds, saved methods, repeat
 * visits, auto-tip), on top of phase 1's foundation migration, both run VERBATIM.
 *
 *   node --experimental-transform-types src/test/pglite/paypalPhase6.pglite.mjs
 *   PLANT=no_saved_method_guard node --experimental-transform-types src/test/pglite/paypalPhase6.pglite.mjs   # RED
 *   PLANT=payout_before_refund  node --experimental-transform-types src/test/pglite/paypalPhase6.pglite.mjs   # RED
 *   PLANT=no_money_flag          node --experimental-transform-types src/test/pglite/paypalPhase6.pglite.mjs   # RED
 *   PLANT=funds_job_any          node --experimental-transform-types src/test/pglite/paypalPhase6.pglite.mjs   # RED
 *
 * (--experimental-transform-types: the payments layer's ProviderApiError uses TypeScript
 * parameter properties, which Node's default type stripping refuses.)
 *
 * Proves:
 *   - 20261023233301 applies 3x (and the foundation under it), replay-safe;
 *   - a saved PayPal method can only be saved for the member who paid the captured payment that
 *     vaulted it, in that env, behind the switch (an ordinary account is refused, as is everyone
 *     with the switch off); one active per member+env; afterwards only active -> revoked, which
 *     works with the switch off; members and anon cannot read it;
 *   - provider_payments.funds_job_id: only a repeat-visit payment, only once captured, only once;
 *   - THE REAL cancellation settlement (paypalCancellation.ts) against these tables, for every
 *     tier in exact cents: the refund row, the payment status, the Helpr's payout row (written as
 *     phase 4's queue writer would), refunds + payouts <= the payment; a second run moves nothing;
 *     and the database refuses the other order (payout queued, then refund);
 *   - THE REAL saved-method charge (paypalSavedCharge.ts): the 'created' row before the charge, the
 *     capture recorded after; an ordinary account refused before any write; the database refuses
 *     the row anyway if the switch check were skipped;
 *   - THE REAL auto-tip (paypalAutoTip.ts) on the tips lane's claim-first shape, its migration
 *     run verbatim: the claim row is the lock, paypal_open_tip takes it over, ONE payout of the
 *     tip by tip_id, a re-run replays, the switch off refuses before any charge.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { planPayPalCancellation, settlePayPalCancellation } from "../../../supabase/functions/_shared/payments/paypalCancellation.ts";
import { chargeSavedPayment } from "../../../supabase/functions/_shared/payments/paypalSavedCharge.ts";
import { chargePayPalAutoTip, reconcileStalePayPalAutoTip } from "../../../supabase/functions/_shared/payments/paypalAutoTip.ts";
import { paypalTipChargeBreakdown } from "../../../supabase/functions/_shared/tipFees.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const foundation = read("20261023223419_paypal_provider_foundation.sql");
const tipsLane = read("20261023232059_paypal_tips.sql");
let mig = read("20261023233301_paypal_phase6_saved_methods.sql");
if (process.env.PLANT === "no_saved_method_guard") mig = mig.replace(/CREATE TRIGGER trg_paypal_saved_methods_guard[\s\S]*?;/, "");
if (process.env.PLANT === "no_money_flag") mig = mig.replace("PERFORM set_config('app.paypal_money_write', '1', true);", "");
if (process.env.PLANT === "funds_job_any") mig = mig.replace(/CHECK \(funds_job_id IS NULL OR subject_kind = 'recurring_visit'\)/, "CHECK (true)");

const db = new PGlite();
const U = { ordinary: "11111111-1111-4111-8111-111111111111", tester: "22222222-2222-4222-8222-222222222222", tester2: "44444444-4444-4444-8444-444444444444", admin: "33333333-3333-4333-8333-333333333333", helpr: "55555555-5555-4555-8555-555555555555" };
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
create table public.payout_transfers(id uuid primary key default gen_random_uuid());
-- The jobs columns phase 6 and the tips lane read or write (prod-shaped names; prod has many more).
create table public.jobs(id uuid primary key, title text, status text, payment_status text, cancellation_fee_status text,
  poster_completed_at timestamptz, helper_completed_at timestamptz, accepted_at timestamptz);
-- The tips lane's migration (20261023232059) runs verbatim below; these are the tables it reads,
-- shaped as its own PGlite proof shapes them (src/test/pglite/paypalTips.pglite.mjs).
create table public.payout_holds(helper_id uuid primary key, reason text);
create table public.ban_settlement_queue(user_id uuid, review_state text);
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(), admin_id uuid not null, action text not null, target_type text, target_id text, details jsonb, created_at timestamptz not null default now());
-- prod's tips (information_schema.columns + pg_constraint, 2026-10-23, as the tips lane measured)
-- phase 3's money guard on jobs (wip/pp-phase3 20261023232151, paypal_job_money_state_guard), copied
-- here because this proof runs before phase 3 lands: a PayPal job's payment_status moves only
-- under app.paypal_money_write. Created AFTER the PayPal migrations (it reads provider_payments).
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
-- prod's one-auto-tip-per-job+member claim index (20260925154606)
create unique index tips_one_auto_per_job_member on public.tips (job_id, helper_id) where source = 'auto';
CREATE OR REPLACE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.feature_enabled_for_user(p_key, (SELECT auth.uid())); $function$;
CREATE OR REPLACE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.feature_enabled_for(p_key) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END;
$function$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select, update on public.jobs to service_role;
grant all on public.tips to service_role;
grant select on public.payout_holds, public.ban_settlement_queue to service_role;
grant select, insert on public.payout_transfers to service_role;
grant select on public.feature_switches, public.test_accounts, public.user_roles to service_role;
insert into auth.users values ('${U.ordinary}'), ('${U.tester}'), ('${U.tester2}'), ('${U.admin}'), ('${U.helpr}');
insert into public.test_accounts(user_id) values ('${U.tester}'), ('${U.tester2}'), ('${U.helpr}');
insert into public.user_roles values ('${U.admin}', 'admin');
`);
const r = {};
const expectErr = async (label, sql, re) => {
  try { await db.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, sql) => {
  try { await db.query(sql); r[label] = "ok"; } catch (e) { r[label] = `bad: ${e.message}`; }
};
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const eq = (label, got, want) => { r[label] = JSON.stringify(got) === JSON.stringify(want) ? "ok" : `bad: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`; };

await db.exec(foundation);
await db.exec(tipsLane);
for (let i = 1; i <= 3; i++) await db.exec(mig);
r.applied3x = "ok";
await db.exec(`
CREATE OR REPLACE FUNCTION public.paypal_job_money_state_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND current_setting('app.paypal_money_write', true) IS DISTINCT FROM '1'
     AND EXISTS (SELECT 1 FROM public.provider_payments p
                  WHERE ((p.subject_kind = 'job' AND p.subject_id = OLD.id) OR p.funds_job_id = OLD.id)
                    AND p.status IN ('approved', 'capture_pending', 'captured', 'partially_refunded', 'disputed')) THEN
    RAISE EXCEPTION 'paypal_job_money_outside_paypal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_paypal_job_money_state_guard BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.paypal_job_money_state_guard();
`);
await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");

let n = 0;
const uuid = (p) => `${p}0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const payment = async (payer, opts = {}) => {
  const id = uuid("a");
  await db.query(`insert into provider_payments(id, subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status)
    values ($1, $2, $3, $4, 'paypal_checkout', $5, $6, $7, $8, $9, $10)`,
  [id, opts.kind ?? "job", opts.subject ?? uuid("b"), payer, opts.env ?? "sandbox", `k-${id}`, `O${n}`, opts.status === "created" ? null : `CAP${n}`, opts.amount ?? 10000, opts.status ?? "captured"]);
  return id;
};
await db.exec("set role service_role");

// ── 1. Saved methods ──
const tPay = await payment(U.tester);
const t2Pay = await payment(U.tester2);
const tCreated = await payment(U.tester, { status: "created" });
const save = (user, pay, vault, env = "sandbox") => `insert into paypal_saved_payment_methods(user_id, env, vault_id, source, from_payment_id) values ('${user}', '${env}', '${vault}', 'card', '${pay}')`;
await expectOk("a tester saves the token their own captured payment vaulted", save(U.tester, tPay, "V1"));
await expectErr("a second active token for the same member+env", save(U.tester, tPay, "V2"), /one_active|duplicate key/);
await expectErr("a token from SOMEONE ELSE's payment", save(U.tester2, tPay, "V3"), /saved_method_not_from_members_payment/);
await expectErr("a token in the other env", save(U.tester2, t2Pay, "V4", "live"), /saved_method_not_from_members_payment/);
await expectErr("a token from a payment that never captured", save(U.tester2, tCreated, "V5"), /saved_method_not_from_members_payment/);
await expectErr("an ordinary account (switch off for them), even naming a real payment", save(U.ordinary, tPay, "V6"), /saved_method_not_from_members_payment|feature_disabled/);
await expectErr("the same vault id twice", save(U.tester2, t2Pay, "V1"), /duplicate key/);
await expectErr("a saved token's vault id cannot be changed", `update paypal_saved_payment_methods set vault_id='VX' where vault_id='V1'`, /saved_method_is_frozen/);
await expectErr("nor moved to another member", `update paypal_saved_payment_methods set user_id='${U.tester2}' where vault_id='V1'`, /saved_method_is_frozen/);
await expectErr("revoked needs its time", `update paypal_saved_payment_methods set status='revoked' where vault_id='V1'`, /revoked_has_time/);
await db.exec("reset role; update feature_switches set audience='off' where key='paypal_payments'; set role service_role");
await expectErr("switch off: no new saved method for anyone", save(U.tester2, t2Pay, "V7"), /feature_disabled/);
await expectOk("switch off: a token can still be revoked", `update paypal_saved_payment_methods set status='revoked', revoked_at=now() where vault_id='V1'`);
await db.exec("reset role; update feature_switches set audience='testers' where key='paypal_payments'; set role service_role");
await expectErr("a revoked token is never brought back", `update paypal_saved_payment_methods set status='active', revoked_at=null where vault_id='V1'`, /saved_method_revoked_is_final|revoked_has_time/);
await expectOk("after revoking, a new token can be saved", save(U.tester, tPay, "V8"));

// ── 2. funds_job_id ──
const visitJob = uuid("c");
await db.query("reset role");
await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [visitJob]);
await db.exec("set role service_role");
const jobPay = await payment(U.tester);
const visitPay = await payment(U.tester, { kind: "recurring_visit" });
const visitCreated = await payment(U.tester, { kind: "recurring_visit", status: "created" });
await expectErr("a job's own payment cannot claim to fund a visit", `update provider_payments set funds_job_id='${visitJob}' where id='${jobPay}'`, /funds_job_is_visit/);
await expectErr("a visit payment that never captured cannot fund a visit", `update provider_payments set funds_job_id='${visitJob}' where id='${visitCreated}'`, /funds_job_needs_captured_payment/);
await expectOk("a captured visit payment names its visit", `update provider_payments set funds_job_id='${visitJob}' where id='${visitPay}'`);
const otherJob = uuid("c");
await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [otherJob]); await db.exec("set role service_role");
await expectErr("and never another one", `update provider_payments set funds_job_id='${otherJob}' where id='${visitPay}'`, /funds_job_is_frozen/);
const visitPay2 = await payment(U.tester, { kind: "recurring_visit" });
await expectErr("two payments cannot fund one visit", `update provider_payments set funds_job_id='${visitJob}' where id='${visitPay2}'`, /duplicate key/);

// ── 3. The REAL cancellation settlement against these tables, every tier ──
const START_UTC = Date.parse("2026-11-11T00:00:00Z");
const jobRow = (id, hoursBefore, over = {}) => ({
  id, customer_id: U.tester, budget: 100, date_needed: "2026-11-10", start_time: "18:00:00",
  cancelled_at: new Date(START_UTC - hoursBefore * 3600_000).toISOString(), helper_id: U.helpr, helper_confirmed_at: "2026-11-01T00:00:00Z",
  helper_fee_flat_cents: 70, helper_fee_percent: 8, customer_fee_amount: 0, poster_fee_flat_cents: null, onboarding_fee_amount: 0,
  sales_tax_amount: 0, is_group_job: false, parent_job_id: null, recurrence_days: null, series_ban_cancelled_at: null, ...over,
});
const pgStore = {
  async fundedPaymentForJob(jobId) {
    const rows = (await db.query(`select id, env, amount_cents, provider_capture_id, status from provider_payments
      where ((subject_kind='job' and subject_id=$1) or funds_job_id=$1) and status in ('captured','partially_refunded','refunded','disputed','capture_pending')`, [jobId])).rows;
    if (rows.length !== 1) return rows.length ? (() => { throw new Error("two funded"); })() : null;
    const p = rows[0];
    return { id: p.id, env: p.env, amountCents: Number(p.amount_cents), providerCaptureId: p.provider_capture_id, status: p.status };
  },
  async refundsFor(pid) {
    return (await db.query("select id, idempotency_key, amount_cents, status, provider_refund_id, created_at from provider_refunds where provider_payment_id=$1", [pid])).rows
      .map((x) => ({ id: x.id, idempotencyKey: x.idempotency_key, amountCents: Number(x.amount_cents), status: x.status, providerRefundId: x.provider_refund_id, createdAtMs: new Date(x.created_at).getTime() }));
  },
  // The one jobs write: paypal_settle_cancelled_job (sets phase 3's app.paypal_money_write).
  async settleJob(id, patch) {
    return (await one("select public.paypal_settle_cancelled_job($1, $2) ok", [id, patch.cancellation_fee_status])).ok === true;
  },
};
let refundCalls = 0;
let refuseNext = 0;
const fakePayPal = { async refund(i) { refundCalls++; return { providerRefundId: `RF${refundCalls}`, status: "COMPLETED", settled: true, amountCents: i.amountCents }; } };
// Phase 5's refund door, in its order (claim the row by key, ask PayPal with the key, record), on
// these tables; phase 1's guards decide every claim. Swapped for phase 5's own RPCs once it lands.
const pgDoor = {
  async refund(req) {
    let row = (await db.query("select id, amount_cents, status, provider_refund_id from provider_refunds where idempotency_key=$1", [req.idempotencyKey])).rows[0];
    if (!row) {
      try {
        row = (await db.query("insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents, reason, status) values ($1,$2,$3,$4,'pending') returning id, amount_cents, status, provider_refund_id", [req.paymentId, req.idempotencyKey, req.amountCents, req.reason])).rows[0];
      } catch (e) {
        return { kind: "refused", code: (e.message.match(/refund_[a-z_]+/) ?? ["claim_failed"])[0], message: e.message, refundRowId: null };
      }
    }
    if (row.status === "completed") return { kind: "refunded", refundRowId: row.id, providerRefundId: row.provider_refund_id, settled: true, amountCents: Number(row.amount_cents), askedCents: req.amountCents, amountMismatch: false, replay: true, paymentStatus: null };
    const cap = (await one("select provider_capture_id, amount_cents from provider_payments where id=$1", [req.paymentId]));
    if (refuseNext > 0) {
      refuseNext--;
      await db.query("update provider_refunds set status='failed' where id=$1", [row.id]);
      return { kind: "refused", code: "provider_refused", message: "422 REFUND_TIME_LIMIT_EXCEEDED", refundRowId: row.id };
    }
    const paid = await fakePayPal.refund({ idempotencyKey: req.idempotencyKey, providerCaptureId: cap.provider_capture_id, amountCents: req.amountCents });
    await db.query("update provider_refunds set status='completed', provider_refund_id=$2, amount_cents=$3 where id=$1", [row.id, paid.providerRefundId, paid.amountCents]);
    const total = Number((await one("select coalesce(sum(amount_cents),0) t from provider_refunds where provider_payment_id=$1 and status not in ('failed','cancelled')", [req.paymentId])).t);
    await db.query("update provider_payments set status=$2 where id=$1 and status in ('captured','partially_refunded')", [req.paymentId, total >= Number(cap.amount_cents) ? "refunded" : "partially_refunded"]);
    return { kind: "refunded", refundRowId: row.id, providerRefundId: paid.providerRefundId, settled: true, amountCents: paid.amountCents, askedCents: req.amountCents, amountMismatch: false, replay: false, paymentStatus: null };
  },
};
// Phase 4's writer, as it inserts (payout_transfers claim, then provider_payouts manual_paypal pending).
const queueAsPhase4 = {
  async queue(i) {
    const live = (await db.query("select id from provider_payouts where provider_payment_id=$1 and status not in ('failed','returned','canceled')", [i.providerPaymentId])).rows[0];
    if (live) return { outcome: "already_queued", reason: null, payoutId: live.id, recorded: true };
    const pt = (await db.query("insert into payout_transfers default values returning id")).rows[0].id;
    const po = (await db.query(`insert into provider_payouts(provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents)
      values ($1, $2, $3, 'manual_paypal', 'sandbox', 'paypal_email', 'helpr@example.com', $4) returning id`, [i.providerPaymentId, pt, i.helperId, i.amountCents])).rows[0].id;
    return { outcome: "queued", reason: null, payoutId: po, recorded: true };
  },
};
const PAYPAL_FEE = 398;
const deps = { store: pgStore, refunds: pgDoor, queue: queueAsPhase4, readCaptureFeeCents: async () => PAYPAL_FEE, env: "sandbox" };
for (const [label, hours, want] of [
  ["0% (48 h out)", 48, { refund: 9602, payout: null, status: "partially_refunded", fee: null }],
  ["25% (10 h out)", 10, { refund: 7102, payout: 2200, status: "partially_refunded", fee: "charged" }],
  ["50% (1 h out)", 1, { refund: 4602, payout: 4500, status: "partially_refunded", fee: "charged" }],
]) {
  const jid = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid]); await db.exec("set role service_role");
  const pid = await payment(U.tester, { subject: jid });
  const before = refundCalls;
  const out = await settlePayPalCancellation(deps, jobRow(jid, hours), false);
  const refunds = (await db.query("select amount_cents, status from provider_refunds where provider_payment_id=$1", [pid])).rows.map((x) => [Number(x.amount_cents), x.status]);
  const payouts = (await db.query("select amount_cents, status from provider_payouts where provider_payment_id=$1", [pid])).rows.map((x) => Number(x.amount_cents));
  const pay = await one("select status from provider_payments where id=$1", [pid]);
  const job = await one("select payment_status, cancellation_fee_status from jobs where id=$1", [jid]);
  eq(`${label}: settled`, out.outcome, "settled");
  eq(`${label}: one refund of exactly the poster's share`, refunds, [[want.refund, "completed"]]);
  eq(`${label}: the Helpr's share queued, exactly`, payouts, want.payout ? [want.payout] : []);
  eq(`${label}: payment status`, pay.status, want.status);
  eq(`${label}: job left escrow with the fee status`, [job.payment_status, job.cancellation_fee_status], ["refunded", want.fee]);
  eq(`${label}: refunds + payouts <= the payment`, want.refund + (want.payout ?? 0) <= 10000, true);
  const again = await settlePayPalCancellation(deps, jobRow(jid, hours), false);
  const refunds2 = (await one("select count(*)::int c from provider_refunds where provider_payment_id=$1", [pid])).c;
  const payouts2 = (await one("select count(*)::int c from provider_payouts where provider_payment_id=$1", [pid])).c;
  // (The sweep only selects jobs still in escrow; run it anyway: no second refund, no second payout.)
  void again;
  eq(`${label}: a second run moves nothing`, [refunds2, payouts2, refundCalls - before], [1, want.payout ? 1 : 0, 1]);
}
// Phase 5's round-3 contract (a): a cancel refund phase 5 finished on its own while the job stayed in
// escrow is settled by the sweep, never re-sent.
{
  const jid = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid]); await db.exec("set role service_role");
  const pid = await payment(U.tester, { subject: jid });
  await db.query("insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents, status, provider_refund_id) values ($1, $2, 7102, 'completed', 'RF-P5')", [pid, `lh:job:${jid}:refund:cancel`]);
  await db.query("update provider_payments set status='partially_refunded' where id=$1", [pid]);
  const c0 = refundCalls;
  const out = await settlePayPalCancellation(deps, jobRow(jid, 10), false);
  eq("(a) a refund phase 5 finished: settled now, not re-sent, fee share queued, job refunded",
    [out.outcome, refundCalls - c0, (await db.query("select amount_cents from provider_payouts where provider_payment_id=$1", [pid])).rows.map((x) => Number(x.amount_cents)), (await one("select payment_status from jobs where id=$1", [jid])).payment_status],
    ["settled", 0, [2200], "refunded"]);
}
// (b) a refused cancel refund is offered again as a new attempt, at most 3, then a person.
{
  const jid = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid]); await db.exec("set role service_role");
  const pid = await payment(U.tester, { subject: jid });
  refuseNext = 3;
  const outs = [];
  for (let n = 0; n < 4; n++) outs.push((await settlePayPalCancellation(deps, jobRow(jid, 10), false)).outcome);
  const keys = (await db.query("select idempotency_key, status from provider_refunds where provider_payment_id=$1 order by created_at", [pid])).rows.map((x) => `${x.idempotency_key.split(":").slice(4).join(":")} ${x.status}`);
  eq("(b) refused 3 times: three attempts (base, a2, a3), all failed, then a person; never flipped, no payout",
    [outs, keys, (await one("select payment_status from jobs where id=$1", [jid])).payment_status, (await one("select count(*)::int c from provider_payouts where provider_payment_id=$1", [pid])).c],
    [["needs_review", "needs_review", "needs_review", "needs_review"], ["cancel failed", "cancel:a2 failed", "cancel:a3 failed"], "escrow", 0]);
  refuseNext = 1;
  const jid2 = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid2]); await db.exec("set role service_role");
  const pid2 = await payment(U.tester, { subject: jid2 });
  await settlePayPalCancellation(deps, jobRow(jid2, 10), false);
  const second = await settlePayPalCancellation(deps, jobRow(jid2, 10), false);
  eq("(b) refused once, then a good second attempt: settled", [second.outcome, (await db.query("select status from provider_refunds where provider_payment_id=$1 order by created_at", [pid2])).rows.map((x) => x.status)], ["settled", ["failed", "completed"]]);
}
// Phase 3's guard: a plain flip of a PayPal job's payment_status is refused; only the settle RPC
// (under app.paypal_money_write) moves it, and the RPC refuses a job with no PayPal money.
{
  const jid = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid]); await db.exec("set role service_role");
  await payment(U.tester, { subject: jid });
  await expectErr("phase 3's guard: a plain payment_status write on a PayPal job is refused", `update jobs set payment_status='refunded' where id='${jid}'`, /paypal_job_money_outside_paypal/);
  const noMoney = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [noMoney]); await db.exec("set role service_role");
  await expectErr("the settle RPC refuses a job with no PayPal money", `select public.paypal_settle_cancelled_job('${noMoney}', null)`, /no_paypal_money_for_job/);
  eq("the settle RPC flips once, then answers false (zero rows), never an error", [
    (await one("select public.paypal_settle_cancelled_job($1, 'charged') ok", [jid])).ok,
    (await one("select public.paypal_settle_cancelled_job($1, 'charged') ok", [jid])).ok,
    (await one("select payment_status from jobs where id=$1", [jid])).payment_status,
  ], [true, false, "refunded"]);
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await expectErr("members cannot call the settle RPC", `select public.paypal_settle_cancelled_job('${jid}', null)`, /permission denied/);
  await db.exec("reset role; set role service_role");
}
// The other order is refused by the database (why the settlement refunds first).
{
  const jid = uuid("d");
  await db.query("reset role"); await db.query("insert into jobs(id, status, payment_status) values ($1, 'cancelled', 'escrow')", [jid]); await db.exec("set role service_role");
  const pid = await payment(U.tester, { subject: jid });
  const plan = planPayPalCancellation({ job: jobRow(jid, 10), sellerFault: false, capturedCents: 10000, providerFeeCents: PAYPAL_FEE, alreadyRefundedCents: 0 });
  if (process.env.PLANT === "payout_before_refund") {
    // RED plant: the settlement's order reversed. The refund is refused, the poster gets nothing back.
    await queueAsPhase4.queue({ jobId: jid, helperId: U.helpr, amountCents: plan.helprPayoutCents, platformFeeCents: 300, source: "cancellation_fee", providerPaymentId: pid });
    const out = await settlePayPalCancellation(deps, jobRow(jid, 10), false).catch((e) => ({ outcome: `threw: ${e.message}` }));
    eq("refund first: the settlement works in its own order", out.outcome, "settled");
  } else {
    await queueAsPhase4.queue({ jobId: jid, helperId: U.helpr, amountCents: plan.helprPayoutCents, platformFeeCents: 300, source: "cancellation_fee", providerPaymentId: pid });
    await expectErr("payout queued first, then refund: refused by the database", `insert into provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('${pid}', 'other-order', ${plan.refundCents})`, /refund_after_payout_queued/);
  }
}

// ── 4. The REAL saved-method charge (repeat visits) against these tables ──
const toRow = (x) => ({ id: x.id, idempotencyKey: x.idempotency_key, status: x.status, amountCents: Number(x.amount_cents), providerOrderId: x.provider_order_id, providerCaptureId: x.provider_capture_id, createdAtMs: new Date(x.created_at).getTime(), updatedAtMs: new Date(x.updated_at).getTime() });
const PCOLS = "id, idempotency_key, status, amount_cents, provider_order_id, provider_capture_id, created_at, updated_at";
const pgCharge = {
  async switchOnFor(u) { return (await one("select public.feature_enabled_for_user('paypal_payments', $1) ok", [u])).ok === true; },
  async activeMethod(u, env) { const m = await one("select id, user_id, env, vault_id, source, created_at from paypal_saved_payment_methods where user_id=$1 and env=$2 and status='active'", [u, env]); return m ? { id: m.id, userId: m.user_id, env: m.env, vaultId: m.vault_id, source: m.source, createdAtMs: new Date(m.created_at).getTime() } : null; },
  async paymentsForSubject(kind, id) { return (await db.query(`select ${PCOLS} from provider_payments where subject_kind=$1 and subject_id=$2`, [kind, id])).rows.map(toRow); },
  async insertPayment(p) {
    return toRow((await db.query(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status)
      values ($1,$2,$3,'paypal_checkout',$4,$5,$6,$7,'created') returning ${PCOLS}`,
    [p.subjectKind, p.subjectId, p.payerId, p.env, p.idempotencyKey, `pending:${p.idempotencyKey}`, p.amountCents])).rows[0]);
  },
  async markCaptured(id, c) { await db.query("update provider_payments set provider_order_id=$2, provider_capture_id=$3, status=$4, updated_at=now() where id=$1 and status='created'", [id, c.providerOrderId, c.providerCaptureId, c.status]); },
  async markCaptureMismatch(id, c) { await db.query("update provider_payments set provider_order_id=$2, provider_capture_id=$3, updated_at=now() where id=$1 and status='created'", [id, c.providerOrderId, c.providerCaptureId]); },
  async markFailed(id) { await db.query("update provider_payments set status='failed', updated_at=now() where id=$1", [id]); },
};
let chargeCalls = 0;
let shortBy = 0;
// PayPal replays a reused PayPal-Request-Id with the ORIGINAL order (sandbox 2026-10-23), so this
// fake answers a repeated key with the first answer; `chargeCalls` counts NEW orders only.
const orders = new Map();
const fakeSaved = { async chargeSaved(i) {
  if (orders.has(i.idempotencyKey)) return orders.get(i.idempotencyKey);
  chargeCalls++;
  const r = { providerOrderId: `ORD${chargeCalls}`, providerCaptureId: `CAPS${chargeCalls}`, status: "COMPLETED", settled: true, amountCents: i.amountCents - shortBy, feeCents: 30, vaultId: null };
  orders.set(i.idempotencyKey, r);
  return r;
} };
{
  const subj = uuid("9");
  const v1 = await chargeSavedPayment({ store: pgCharge, provider: fakeSaved, env: "sandbox" }, { subjectKind: "recurring_visit", subjectId: subj, payerId: U.tester, amountCents: 8000 });
  eq("visit charge: a tester's saved method is charged and the row recorded captured", [v1.outcome, (await one("select status from provider_payments where subject_id=$1", [subj]))?.status], ["charged", "captured"]);
  const c0 = chargeCalls;
  const again = await chargeSavedPayment({ store: pgCharge, provider: fakeSaved, env: "sandbox" }, { subjectKind: "recurring_visit", subjectId: subj, payerId: U.tester, amountCents: 8000 });
  const repriced = await chargeSavedPayment({ store: pgCharge, provider: fakeSaved, env: "sandbox" }, { subjectKind: "recurring_visit", subjectId: subj, payerId: U.tester, amountCents: 9000 });
  eq("visit charge: re-run adopts; a re-price never charges beside a funded row", [again.outcome, repriced.outcome, chargeCalls - c0], ["charged", "needs_review", 0]);
  const subj2 = uuid("9");
  shortBy = 1;
  const mm = await chargeSavedPayment({ store: pgCharge, provider: fakeSaved, env: "sandbox" }, { subjectKind: "recurring_visit", subjectId: subj2, payerId: U.tester, amountCents: 8000 });
  shortBy = 0;
  eq("visit charge: a different captured amount is recorded but never funded", [mm.outcome, (await one("select status, provider_capture_id is not null cap from provider_payments where subject_id=$1", [subj2]))], ["needs_review", { status: "created", cap: true }]);
}
const before = chargeCalls;
const ordOut = await chargeSavedPayment({ store: pgCharge, provider: fakeSaved, env: "sandbox" }, { subjectKind: "recurring_visit", subjectId: uuid("e"), payerId: U.ordinary, amountCents: 538 });
eq("saved charge: an ordinary account is refused before any write or charge", [ordOut.outcome, chargeCalls - before], ["switch_off", 0]);
await expectErr("and the database refuses the row even if that check were skipped", `insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents) values ('tip', '${uuid("e")}', '${U.ordinary}', 'paypal_checkout', 'sandbox', 'k-ord', 'pending:k-ord', 538)`, /feature_disabled/);
await expectErr("funds_job_id named on INSERT is held to the captured-only rule", `insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, funds_job_id) values ('recurring_visit', '${uuid("e")}', '${U.tester}', 'paypal_checkout', 'sandbox', 'k-ins', 'pending:k-ins', 538, '${otherJob}')`, /funds_job_needs_captured_payment/);

// ── 5. Auto-tip, end to end on the tips lane's claim-first shape (its migration run verbatim) ──
const tipJob = uuid("f");
const tipId = uuid("e");
await db.query("reset role");
await db.query("insert into jobs(id, title, status, payment_status, poster_completed_at) values ($1, 'Mow', 'completed', 'released', now() - interval '1 day')", [tipJob]);
// (1) the claim, as auto-tip-charge writes it before the charge
await db.query("insert into tips(id, job_id, tipper_id, helper_id, amount, source, payment_status) values ($1, $2, $3, $4, 5, 'auto', 'pending')", [tipId, tipJob, U.tester, U.helpr]);
await db.query("insert into payee_accounts(user_id, provider, env, paypal_email, payable) values ($1, 'paypal', 'sandbox', 'helpr@example.com', true)", [U.helpr]);
await db.exec("set role service_role");
await expectErr("the claim is the lock: a second auto claim for the same job+Helpr is refused", `insert into tips(job_id, tipper_id, helper_id, amount, source, payment_status) values ('${tipJob}', '${U.tester}', '${U.helpr}', 5, 'auto', 'pending')`, /duplicate key|tips_one_auto_per_job_member/);
const tipDeps = {
  provider: fakeSaved,
  env: "sandbox",
  jobStateNow: async () => "chargeable",
  switchOnFor: (u) => pgCharge.switchOnFor(u),
  activeMethod: (u, env) => pgCharge.activeMethod(u, env),
  openTip: async (a) => {
    const x = await one("select public.paypal_open_tip($1, $2, $3, $4, $5, $6, $7, $8, 'auto', $9) a", [a.jobId, a.tipperId, a.helperId, a.tipCents, a.chargeCents, a.env, a.idempotencyKey, a.orderId, a.tipId]);
    return { providerPaymentId: x.a.provider_payment_id };
  },
  markClaim: async (id, marker) => {
    const r2 = (await db.query("update tips set failure_reason=$2 where id=$1 and payment_status='pending' returning id", [id, marker])).rows;
    if (r2.length !== 1) throw new Error("marker matched 0 rows");
  },
  // What settlePayPalTip does once PayPal's order reads COMPLETED: record the capture (idempotent).
  settle: async (pid) => {
    const p = await one("select provider_order_id, amount_cents from provider_payments where id=$1", [pid]);
    const capId = [...orders.values()].find((o) => o.providerOrderId === p.provider_order_id).providerCaptureId;
    const x = await one("select public.paypal_record_tip_capture($1, $2, 'completed', $3, $4) a", [pid, p.provider_order_id, capId, p.amount_cents]);
    return { state: "recorded", payoutId: x.a.payout_id, payoutReason: x.a.payout_reason, paymentStatus: x.a.payment_status };
  },
};
const tipIn = { tipId, jobId: tipJob, posterId: U.tester, helperId: U.helpr, tipCents: 500 };
const card = paypalTipChargeBreakdown(500, "card_standard");
const t1 = await chargePayPalAutoTip(tipDeps, tipIn);
if (t1.outcome !== "charged") console.log("t1", JSON.stringify(t1));
const tipPay = await one("select id, amount_cents, status, subject_id from provider_payments where subject_kind='tip' and subject_id=$1", [tipId]);
eq("auto-tip: charged tip + PayPal's card fee, on the CLAIMED tips row (taken over, not a second row)",
  [t1.outcome, Number(tipPay?.amount_cents), tipPay?.status, (await one("select count(*)::int c from tips where job_id=$1", [tipJob])).c],
  ["charged", card.chargeCents, "captured", 1]);
eq("auto-tip: the tips lane marked the tip paid", (await one("select payment_status from tips where id=$1", [tipId])).payment_status, "paid");
const tipPayouts = (await db.query("select amount_cents, status from provider_payouts where tip_id=$1", [tipId])).rows.map((x) => [Number(x.amount_cents), x.status]);
eq("auto-tip: ONE payout of exactly the tip (100%), named by the tip", tipPayouts, [[500, "pending"]]);
// A second run of the same claim (a crash after the charge): same key, a replay, nothing new.
const callsBefore = chargeCalls;
const t2 = await chargePayPalAutoTip(tipDeps, tipIn);
// (A crash between charge and record leaves the claim pending with its marker: section 6 covers it.)
eq("auto-tip re-run on a settled claim: nothing charged, no second payment row, no second payout",
  [t2.outcome, chargeCalls - callsBefore, (await one("select count(*)::int c from provider_payments where subject_kind='tip' and subject_id=$1", [tipId])).c, (await one("select count(*)::int c from provider_payouts where tip_id=$1", [tipId])).c],
  ["unreadable", 0, 1, 1]);
// The switch off for the poster: refused BEFORE the charge.
await db.exec("reset role"); await db.exec("update feature_switches set audience='off' where key='paypal_payments'"); await db.exec("set role service_role");
const tipId2 = uuid("e"); const tipJob2 = uuid("f");
await db.query("reset role");
await db.query("insert into jobs(id, title, status, payment_status) values ($1, 'Rake', 'completed', 'released')", [tipJob2]);
await db.query("insert into tips(id, job_id, tipper_id, helper_id, amount, source, payment_status) values ($1, $2, $3, $4, 5, 'auto', 'pending')", [tipId2, tipJob2, U.tester, U.helpr]);
await db.exec("set role service_role");
const c1 = chargeCalls;
const t3 = await chargePayPalAutoTip(tipDeps, { ...tipIn, tipId: tipId2, jobId: tipJob2 });
eq("auto-tip with the switch off for the poster: given up before any charge", [t3.outcome, t3.reason, chargeCalls - c1], ["give_up", "paypal_switch_off", 0]);
await db.exec("reset role"); await db.exec("update feature_switches set audience='testers' where key='paypal_payments'"); await db.exec("set role service_role");
await db.exec("reset role");

// ── 6. Stale auto-tip claims (the tips lane's round-4 conditions): never charged again ──
{
  await db.exec("set role service_role");
  const staleDeps = (orderStatus) => ({
    env: "sandbox",
    now: () => Date.now(),
    readOrder: async (id) => ({ status: orderStatus, capture: orderStatus === "COMPLETED" ? { providerCaptureId: `CAPX-${id}`, amountCents: card.chargeCents, settled: true } : null }),
    openTip: tipDeps.openTip,
    settle: async (pid) => {
      const p = await one("select provider_order_id, amount_cents from provider_payments where id=$1", [pid]);
      const x = await one("select public.paypal_record_tip_capture($1, $2, 'completed', $3, $4) a", [pid, p.provider_order_id, `CAPX-${p.provider_order_id}`, p.amount_cents]);
      return { state: "recorded", payoutId: x.a.payout_id, payoutReason: x.a.payout_reason, paymentStatus: x.a.payment_status };
    },
    closeClaim: async (id, why) => {
      const r2 = (await db.query("update tips set payment_status='failed', failure_reason=$2 where id=$1 and payment_status='pending' returning id", [id, why])).rows;
      if (r2.length !== 1) throw new Error("close matched 0 rows");
    },
    alert: async () => { alerts++; },
  });
  let alerts = 0;
  const staleClaim = async (marker) => {
    const id = uuid("e"); const jid = uuid("f");
    await db.query("reset role");
    await db.query("insert into jobs(id, title, status, payment_status) values ($1, 'Old', 'completed', 'released')", [jid]);
    await db.query("insert into tips(id, job_id, tipper_id, helper_id, amount, source, payment_status, failure_reason, created_at) values ($1, $2, $3, $4, 5, 'auto', 'pending', $5, now() - interval '4 hours')", [id, jid, U.tester, U.helpr, marker]);
    await db.exec("set role service_role");
    const t = await one("select id, job_id, tipper_id, helper_id, amount, created_at, failure_reason from tips where id=$1", [id]);
    return { tipId: t.id, jobId: t.job_id, posterId: t.tipper_id, helperId: t.helper_id, tipCents: 500, createdAtMs: new Date(t.created_at).getTime(), marker: t.failure_reason, paymentId: null };
  };
  const c0 = chargeCalls;
  const never = await staleClaim(null);
  eq("stale claim, no marker (died before any charge): closed, so it no longer holds the job+Helpr", [await reconcileStalePayPalAutoTip(staleDeps("COMPLETED"), never), (await one("select payment_status from tips where id=$1", [never.tipId])).payment_status], ["closed_never_charged", "failed"]);
  const lost = await staleClaim("paypal_charging:lh:autotip:x:charge:amt566:a1");
  eq("stale claim, charge answer lost: a person is paged, the claim stays, NOTHING is charged", [await reconcileStalePayPalAutoTip(staleDeps("COMPLETED"), lost), (await one("select payment_status from tips where id=$1", [lost.tipId])).payment_status, alerts, chargeCalls - c0], ["needs_human", "pending", 1, 0]);
  const notCap = await staleClaim("paypal_charged:ORDNOTCAP");
  eq("stale claim, order not captured at PayPal: closed", [await reconcileStalePayPalAutoTip(staleDeps("VOIDED"), notCap), (await one("select payment_status from tips where id=$1", [notCap.tipId])).payment_status], ["closed_not_captured", "failed"]);
  const capd = await staleClaim("paypal_charged:ORDCAPTURED");
  const rc = await reconcileStalePayPalAutoTip(staleDeps("COMPLETED"), capd);
  eq("stale claim, order captured but unrecorded: recorded late on the claimed row, ONE payout of the tip, nothing charged",
    [rc, (await one("select payment_status from tips where id=$1", [capd.tipId])).payment_status, (await db.query("select amount_cents from provider_payouts where tip_id=$1", [capd.tipId])).rows.map((x) => Number(x.amount_cents)), chargeCalls - c0],
    ["recorded_late", "paid", [500], 0]);
  await db.exec("reset role");
}

for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  await expectErr(`${role} cannot read saved methods`, "select * from paypal_saved_payment_methods", /permission denied/);
  await db.exec("reset role");
}
// Replay after all of it: still applies, nothing changed.
await db.exec(mig);
r.replayAfterData = (await one("select count(*)::int c from paypal_saved_payment_methods")).c === 2 ? "ok" : "bad";

const bad = Object.entries(r).filter(([, v]) => v !== "ok");
for (const [k, v] of Object.entries(r)) console.log(`${v === "ok" ? "ok  " : "FAIL"} ${k}${v === "ok" ? "" : `: ${v}`}`);
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; migration applied 3x + 1 replay with data)`);
process.exit(bad.length ? 1 : 0);
