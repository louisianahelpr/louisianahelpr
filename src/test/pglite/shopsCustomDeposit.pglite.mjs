#!/usr/bin/env node
/**
 * PGlite proof for 20261106212437_shops_custom_deposit_split.sql (Shops custom orders slice 2a, Builder 4, 11-06): the
 * 50% deposit split frozen when the hold lands, the handover gate while the rest is unpaid, and the shop's payout and
 * the refund amounts reading only what the deposit took. A full-payment order is unchanged.
 *
 *   node src/test/pglite/shopsCustomDeposit.pglite.mjs                         # ALL PASS (the migration applied 3x)
 *   DEPOSIT_MIGRATION=skip node src/test/pglite/shopsCustomDeposit.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsCustomDeposit.pglite.mjs
 *
 * Stub schema: prod-shaped columns only for what these functions read. The real refund helpers (fee policy, tax kept,
 * card fee estimate) are cut verbatim from their newest CREATE. The review follow-ups (decline closes the unpaid
 * order, custom orders off, the hint) are proven in shopsCustomRequests.pglite.mjs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106212437_shops_custom_deposit_split.sql"), "utf8");

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
-- Row types the restated custom-request RPCs declare (their behaviour is proven in shopsCustomRequests.pglite.mjs).
CREATE TABLE public.shops (id uuid PRIMARY KEY);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY);
CREATE TABLE public.fee_debt (seller_id uuid PRIMARY KEY, cents int NOT NULL);
CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  SELECT least(cents, p_max) INTO v FROM public.fee_debt WHERE seller_id = p_seller;
  UPDATE public.fee_debt SET cents = cents - COALESCE(v, 0) WHERE seller_id = p_seller;
  RETURN COALESCE(v, 0);
END $$;
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0,
  total_cents int NOT NULL, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text, card_fee_cents int,
  stripe_payment_intent_id text, captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text,
  shop_confirmed_at timestamptz, confirmed_at timestamptz, confirmed_how text, problem_at timestamptz);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz,
  CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0));
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_fee_policy"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept"));
// The --before state of what the migration restates (newest bodies).
await db.exec(cutFn("20261106180902_shops_delivery.sql", "shop_owe_shop"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_amounts"));
const skip = process.env.DEPOSIT_MIGRATION === "skip";
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
const row = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0] ?? {};

const SELLER = "00000000-0000-0000-0000-000000000011";
// items 4001, buyer fee 271, delivery 501, tax 363 -> total 5136 (total = items + fee + delivery + tax on prod).
async function order(plan, { setup = 0 } = {}) {
  const cols = plan === null ? "" : ", payment_plan";
  const vals = plan === null ? "" : `, '${plan}'`;
  const r = await svc(`INSERT INTO public.shop_orders (seller_id, items_cents, premium_cents, delivery_cents, total_cents, setup_fee_cents${cols})
    VALUES ('${SELLER}', 4001, 271, 501, 4773, ${setup}${vals}) RETURNING id`);
  return Array.isArray(r) ? r[0].id : r;
}
const hold = (id, { claimed = false } = {}) => svc(`UPDATE public.shop_orders SET status = 'held', tax_cents = 363, total_cents = 5136
  ${claimed ? ", setup_fee_state = 'claimed'" : ""} WHERE id = '${id}'`);

// --- 1. the split, frozen when the hold lands
const d1 = await order("deposit_50");
ok(typeof d1 === "string", `a deposit order is written with the plan (${JSON.stringify(d1)})`);
await hold(d1);
const r1 = await row(d1);
// balance = 4001/2 + 271/2 + 501/2 + 363/2 = 2000 + 135 + 250 + 181 = 2566; deposit = 5136 - 2566 = 2570
ok(r1.balance_cents === 2566 && r1.deposit_cents === 2570,
  `the hold freezes half (rounded down) of each part as the rest, the deposit is the other half (${r1.balance_cents}/${r1.deposit_cents})`);
const d2 = await order("deposit_50", { setup: 500 });
await hold(d2, { claimed: true });
const r2 = await row(d2);
ok(r2.balance_cents === 2566 && r2.deposit_cents === 3070, `a claimed setup fee is captured with the deposit (${r2.deposit_cents})`);
ok(refused(await svc(`UPDATE public.shop_orders SET deposit_cents = 5136, balance_cents = 0 WHERE id = '${d1}'`), /deposit_split_frozen/),
  "the split never moves after the hold");
ok(refused(await svc(`UPDATE public.shop_orders SET payment_plan = 'full_hold' WHERE id = '${d1}'`), /payment_plan_frozen/),
  "the plan never changes after the order is written");
ok(refused(await svc(`INSERT INTO public.shop_orders (seller_id, items_cents, premium_cents, total_cents, payment_plan, deposit_cents, balance_cents)
  VALUES ('${SELLER}', 100, 10, 110, 'deposit_50', 110, 0)`), /deposit_split_frozen/), "an order is never written with a split of its own");
ok(refused(await svc(`UPDATE public.shop_orders SET balance_captured_at = now() WHERE id = '${d1}'`), /shop_orders_deposit_split/),
  "the rest is never marked paid without its payment");
ok(refused(await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'ch_x' WHERE id = '${d1}'`), /shop_orders_balance_pi/),
  "the rest's payment is a PaymentIntent id");
const f1 = await order(null);
await hold(f1);
const rf = await row(f1);
ok(rf.payment_plan === "full_hold" && rf.deposit_cents === null && rf.balance_cents === null,
  "an ordinary order is full payment with no split");
ok(refused(await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'pi_x' WHERE id = '${f1}'`), /shop_orders_deposit_split/),
  "a full-payment order never carries a second payment");

// --- 2. nothing is handed over while the rest is unpaid
await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now(), stripe_payment_intent_id = 'pi_d1' WHERE id IN ('${d1}', '${f1}')`);
ok(Array.isArray(await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${d1}', now())`)), "\"It's ready\" is allowed before the rest is paid");
ok(refused(await svc(`UPDATE public.shop_handovers SET shop_confirmed_at = now() WHERE order_id = '${d1}'`), /balance_not_paid/),
  "the shop's \"Handed over\" waits for the rest");
ok(refused(await svc(`UPDATE public.shop_handovers SET ready_photo_path = 'p.jpg' WHERE order_id = '${d1}'`), /balance_not_paid/),
  "a left-out order's ready photo waits for the rest");
ok(refused(await svc(`UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = 'buyer' WHERE order_id = '${d1}'`), /balance_not_paid/),
  "the buyer's \"I got it\" (and the clock) wait for the rest");
ok(refused(await svc(`INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES ('${d2}', now())`), /balance_not_paid/),
  "a first handover row cannot carry a handover either");
ok(refused(await svc(`UPDATE public.shop_orders SET status = 'handed_over' WHERE id = '${d1}'`), /balance_not_paid/),
  "no writer reaches handed_over while the rest is unpaid");
ok(Array.isArray(await svc(`INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES ('${f1}', now())`))
  && Array.isArray(await svc(`UPDATE public.shop_orders SET status = 'handed_over' WHERE id = '${f1}'`)),
  "a full-payment order hands over as before");

// --- 3. the shop's payout and the refund read what the deposit took
const owe = async (id) => (await svc(`SELECT public.shop_owe_shop('${id}') AS v`))[0]?.v;
// shop half = (4001 - 2000) + (501 - 250) = 2252
ok(await owe(d1) === 2252, "an order ending with the rest unpaid pays the shop its half of the items and delivery");
const amounts = async (id, reason) => (await svc(`SELECT * FROM public.shop_refund_amounts('${id}', '${reason}')`))[0] ?? {};
const a2 = await amounts(d2, "shop_cancelled");
// paid = sale less the rest = 5136 - 2566 = 2570; tax = 363 - 181 = 182
ok(a2.paid_cents === 2570 && a2.tax_cents === 182 && a2.refund_cents === 2570,
  `a refund with the rest unpaid gives back only what the deposit took (${JSON.stringify(a2)})`);
const a2b = await amounts(d2, "buyer_cancelled");
ok(a2b.paid_cents === 2570 && a2b.card_fee_cents === Math.min(2570, (await svc(`SELECT public.declutter_card_fee_estimate(2570) AS v`))[0]?.v),
  "the card fee is the deposit's own fee");
// The rest paid: the whole order (a second refund row for the rest's payment is slice 2b).
await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'pi_bal', balance_captured_at = now() WHERE id = '${d2}'`);
const a3 = await amounts(d2, "shop_cancelled");
ok(a3.paid_cents === 5136 && a3.tax_cents === 363, "with the rest paid the amounts are the whole order's");
ok(await owe(d2) === 4502, "with the rest paid the shop is owed its items and delivery in full");
const f2 = await order(null);
await hold(f2);
ok(await owe(f2) === 4502 && (await amounts(f2, "shop_cancelled")).paid_cents === 5136, "a full-payment order's payout and refund are unchanged");
ok(refused(await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'pi_bal' WHERE id = '${d1}'`), /unique|duplicate/),
  "one payment is the rest of one order only");

// --- 4. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_order_balance_open', 'shop_order_shop_cents', 'shop_orders_deposit_split', 'shop_orders_deposit_insert',
                      'shop_handovers_balance_gate', 'shop_owe_shop', 'shop_refund_amounts')`);
ok(Array.isArray(grants) && grants.length === 7 && grants.every((g) => !g.m && !g.a), `no member or anon can call the money helpers (${JSON.stringify(grants)})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (DEPOSIT_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
