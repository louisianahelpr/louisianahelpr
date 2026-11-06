#!/usr/bin/env node
/**
 * PGlite proof for 20261106215722_shops_custom_deposit_balance.sql (Shops custom orders slice 2b part 1, Builder 4,
 * 11-06): the rest of a 50% deposit order, SQL side. The saved card, what is due to charge, paid (once), failed
 * (the buyer's to pay, told once), the pay-the-rest page, the 7-day lapse as the buyer's late cancel on the deposit
 * only with a strike, and the tax step owed on every close where the item never changes hands (LEAD 11-06).
 *
 *   node src/test/pglite/shopsCustomBalance.pglite.mjs                         # ALL PASS (2a + this applied 3x)
 *   BALANCE_MIGRATION=skip node src/test/pglite/shopsCustomBalance.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsCustomBalance.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const SPLIT = readFileSync(url("20261106212437_shops_custom_deposit_split.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106215722_shops_custom_deposit_balance.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
CREATE TABLE public.strikes (user_id uuid, reason text, order_id uuid);
CREATE FUNCTION public.shop_give_strike(p_user uuid, p_side text, p_reason text, p_order uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.strikes VALUES (p_user, p_reason, p_order); RETURN gen_random_uuid(); END $$;
CREATE TABLE public.cron_defects (job text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(p_job text, p_ref text, p_err text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.cron_defects VALUES (p_job, p_ref, p_err) $$;
CREATE TABLE public.today (d date NOT NULL);
INSERT INTO public.today VALUES ((now() AT TIME ZONE 'America/Chicago')::date);
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT d FROM public.today $$;
CREATE TABLE public.fee_debt (seller_id uuid PRIMARY KEY, cents int NOT NULL);
CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0,
  fulfillment text NOT NULL DEFAULT 'pickup', total_cents int NOT NULL, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text,
  card_fee_cents int, stripe_checkout_session_id text, stripe_payment_intent_id text, payment_livemode boolean,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text,
  shop_confirmed_at timestamptz, confirmed_at timestamptz, confirmed_how text, problem_at timestamptz);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz);
CREATE FUNCTION public.shop_delivery_reserved_cents(p_order uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"));
await db.exec(cutFn("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_fee_policy"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept"));
await db.exec(SPLIT);
const skip = process.env.BALANCE_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const row = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0] ?? {};
const notices = async (title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = '${title}'`));

const BUYER = "00000000-0000-0000-0000-000000000001";
const SELLER = "00000000-0000-0000-0000-000000000011";
const today = one(await svc(`SELECT d::text FROM public.today`));
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let seq = 0;
/** A deposit order, held and accepted with the deposit captured. items 4000, fee 270, tax 300 -> total 4570, rest 2000 + 135 + 150 = 2285. */
async function accepted(plan = "deposit_50", ready = today) {
  seq += 1;
  const id = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, items_cents, premium_cents, total_cents, ready_date, payment_plan)
    VALUES ('${BUYER}', '${SELLER}', 4000, 270, 4270, '${ready}', '${plan}') RETURNING id`));
  await svc(`UPDATE public.shop_orders SET status = 'held', tax_cents = 300, total_cents = 4570,
    stripe_checkout_session_id = 'cs_test_${seq}', stripe_payment_intent_id = 'pi_dep_${seq}', payment_livemode = false WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now() WHERE id = '${id}'`);
  return id;
}
const due = async () => { const r = await svc(`SELECT * FROM public.shop_balances_due(50)`); return Array.isArray(r) ? r : []; };
const save = (id, cus = "cus_1", pm = "pm_1") => svc(`SELECT public.shop_order_record_saved_card('${id}', '${cus}', '${pm}') AS r`);

// --- 1. the saved card
const a = await accepted();
ok(one(await save(a))?.result === "saved" && (await row(a)).balance_payment_method_id === "pm_1", "the webhook records the card saved for the rest");
ok(one(await save(a, "cus_1", "pm_2"))?.result === "kept_first" && (await row(a)).balance_payment_method_id === "pm_1", "a later card never replaces the first");
const f = await accepted("full_hold");
ok(one(await save(f))?.result === "not_deposit" && (await row(f)).balance_payment_method_id === null, "a full-payment order keeps no card");
ok(refused(await svc(`UPDATE public.shop_orders SET balance_payment_method_id = 'card_x' WHERE id = '${a}'`), /shop_orders_balance_card/), "only a payment method id is kept");

// --- 2. what is due
ok((await due()).some((d) => d.order_id === a && d.balance_cents === 2285 && d.payment_method_id === "pm_1"),
  "from the ready date the rest is due on the saved card");
const later = await accepted("deposit_50", plus(3));
await save(later);
ok(!(await due()).some((d) => d.order_id === later), "never before the ready date");
const nocard = await accepted();
ok(!(await due()).some((d) => d.order_id === nocard), "no saved card: nothing to charge off-session");
ok(!(await due()).some((d) => d.order_id === f), "a full-payment order owes no rest");

// --- 3. paid once
const paid = one(await svc(`SELECT public.shop_balance_paid('${a}', 'pi_bal_a', 95) AS r`));
const ra = await row(a);
ok(paid?.result === "paid" && ra.balance_payment_intent_id === "pi_bal_a" && ra.balance_captured_at instanceof Date && ra.balance_card_fee_cents === 95,
  `the rest is recorded paid (${JSON.stringify(paid)})`);
ok(one(await svc(`SELECT public.shop_balance_paid('${a}', 'pi_bal_a', 95) AS r`))?.result === "already_paid", "the same payment again is a no-op");
const twice = one(await svc(`SELECT public.shop_balance_paid('${a}', 'pi_bal_a2', 95) AS r`));
ok(twice?.result === "refund" && twice.reason === "paid_twice" && (await row(a)).balance_payment_intent_id === "pi_bal_a",
  "a second payment is never recorded: it is answered refund");
ok(!(await due()).some((d) => d.order_id === a), "a paid rest is never listed again");
ok(await notices("Order paid in full") === 1 && await notices("Custom order paid in full") === 1, "both sides are told once");
ok(Array.isArray(await svc(`INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES ('${a}', now())`)), "once paid, the handover is open");

// --- 4. failed: retried, or the buyer's to pay
const b = await accepted();
await save(b);
ok(one(await svc(`SELECT public.shop_balance_failed('${b}', 'timeout', false) AS r`))?.result === "will_retry"
  && (await row(b)).balance_attempts === 1 && (await due()).some((d) => d.order_id === b && d.attempts === 1),
  "a passing failure is counted and retried with the next key");
ok(one(await svc(`SELECT public.shop_balance_failed('${b}', 'card_declined', true) AS r`))?.result === "buyer_pays"
  && (await row(b)).balance_failed_at instanceof Date && !(await due()).some((d) => d.order_id === b),
  "a declined card is the buyer's to pay: no more off-session tries");
await svc(`SELECT public.shop_balance_failed('${b}', 'card_declined', true)`);
ok(await notices("Pay the rest of your order") === 1 && await notices("Waiting on the rest of a payment") === 1, "the buyer and the shop are told once");
ok(refused(await svc(`INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES ('${b}', now())`), /balance_not_paid/),
  "while the buyer owes the rest, the shop cannot hand it over");

// --- 5. the pay-the-rest page
ok(one(await svc(`SELECT public.shop_attach_balance_session('${b}', 'cs_test_rest') AS r`))?.result === "attached"
  && (await row(b)).balance_checkout_session_id === "cs_test_rest", "the buyer's pay-the-rest page is recorded");
ok(refused(await svc(`SELECT public.shop_attach_balance_session('${a}', 'cs_test_x')`), /nothing_owed/), "no page for a rest already paid");
ok(refused(await svc(`SELECT public.shop_attach_balance_session('${b}', 'https://x')`), /invalid_session/), "only a Checkout page id");
ok(one(await svc(`SELECT public.shop_balance_paid('${b}', 'pi_rest_b', NULL) AS r`))?.result === "paid" && (await row(b)).balance_failed_at === null,
  "the page's payment settles the rest like the off-session one");

// --- 6. the lapse, 7 days after the ready date
const c = await accepted("deposit_50", plus(-7));
const d = await accepted("deposit_50", plus(-8));
const swept = await svc(`SELECT * FROM public.shop_balance_lapse_sweep()`);
ok(Array.isArray(swept) && swept.length === 1 && swept[0].order_id === d, `only an order past 7 full days lapses (${JSON.stringify(swept)})`);
const rd = await row(d);
ok(rd.status === "cancelled" && rd.close_reason === "buyer_cancelled_late" && rd.balance_lapsed_at instanceof Date,
  "a lapsed order closes as the buyer's late cancel");
ok(swept[0]?.owed_cents === 2000 && one(await svc(`SELECT amount_cents FROM public.shop_payouts WHERE order_id = '${d}'`)) === 2000,
  "the shop is paid on the deposit only (half the items)");
ok(one(await svc(`SELECT count(*)::int FROM public.strikes WHERE order_id = '${d}' AND reason = 'buyer_cancelled_late'`)) === 1, "the buyer gets a Shops strike");
ok((await row(c)).status === "accepted", "an order on its 7th day is left alone");
ok(Array.isArray(await svc(`SELECT * FROM public.shop_balance_lapse_sweep()`)) && one(await svc(`SELECT count(*)::int FROM public.shop_payouts WHERE order_id = '${d}'`)) === 1,
  "a second sweep pays nothing twice");
const late = one(await svc(`SELECT public.shop_balance_paid('${d}', 'pi_late_d', NULL) AS r`));
ok(late?.result === "refund" && late.reason === "order_not_open", "a payment landing after the lapse is answered refund");

// --- 7. the tax step is owed on every close where the item never changes hands
const taxDue = async () => { const r = await svc(`SELECT * FROM public.shop_lapse_tax_due(50)`); return Array.isArray(r) ? r : []; };
ok((await taxDue()).some((t) => t.order_id === d && t.deposit_tax_cents === 150), "the lapse owes the tax step: the deposit's tax (300 - 150)");
const e = await accepted();
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now() WHERE id = '${e}'`);
const nsh = await accepted();
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now() WHERE id = '${nsh}'`);
ok((await taxDue()).some((t) => t.order_id === e) && (await taxDue()).some((t) => t.order_id === nsh),
  "the buyer's own late cancel and a no-show with the rest unpaid owe it too (LEAD 11-06)");
const g = await accepted();
await svc(`SELECT public.shop_balance_paid('${g}', 'pi_bal_g', NULL)`);
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now() WHERE id = '${g}'`);
const fc = await accepted("full_hold");
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now() WHERE id = '${fc}'`);
ok(!(await taxDue()).some((t) => t.order_id === g || t.order_id === fc), "a paid-in-full order's late cancel is unchanged (no tax step)");
ok(one(await svc(`SELECT public.shop_lapse_tax_done('${d}') AS r`))?.result === "done" && !(await taxDue()).some((t) => t.order_id === d)
  && one(await svc(`SELECT public.shop_lapse_tax_done('${d}') AS r`))?.result === "not_owed", "the step is recorded done once");

// --- 8. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_order_record_saved_card', 'shop_balances_due', 'shop_balance_paid', 'shop_balance_failed',
                      'shop_attach_balance_session', 'shop_balance_lapse_sweep', 'shop_lapse_tax_due', 'shop_lapse_tax_done',
                      'shop_orders_mark_unpaid_close')`);
ok(Array.isArray(grants) && grants.length === 9 && grants.every((x) => !x.m && !x.a), `service only (${JSON.stringify(grants)})`);
ok(one(await svc(`SELECT count(*)::int FROM public.cron_defects`)) === 0, "no sweep defects");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (BALANCE_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
