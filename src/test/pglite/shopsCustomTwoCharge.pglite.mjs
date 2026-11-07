#!/usr/bin/env node
/**
 * PGlite proof for 20261107162454_shops_custom_two_charge_payout.sql (Builder 4, 11-07; lh-money-escrow review of the
 * custom deposit stack, "Additional money finding" + change 1; LEAD 11-07 option B): a 50% deposit order whose rest was
 * paid (two charges) is paid out from both charges, keeps both card fees on a refund, never has a refund sent by the
 * queue (held for a person), is found by the rest's payment for a hand refund, and is never delivered by a Helpr.
 *
 *   node src/test/pglite/shopsCustomTwoCharge.pglite.mjs                       # ALL PASS (migration applied 3x)
 *   TWO_CHARGE_MIGRATION=skip node src/test/pglite/shopsCustomTwoCharge.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsCustomTwoCharge.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const SPLIT = readFileSync(url("20261106212437_shops_custom_deposit_split.sql"), "utf8");
const BALANCE = readFileSync(url("20261106215722_shops_custom_deposit_balance.sql"), "utf8");
const EDGE = readFileSync(url("20261106221300_shops_custom_balance_edge.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261107162454_shops_custom_two_charge_payout.sql"), "utf8");
const M3 = "20261019071055_shops_refunds_cancels_strikes.sql";

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}
/** A real table (every CHECK), as its migration creates it. */
function cutTable(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  return s.slice(at, s.indexOf("\n);\n", at) + 4);
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text);
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
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz,
  attempts int NOT NULL DEFAULT 0, review_held_at timestamptz, review_reason text);
CREATE TABLE public.shop_cottage_sales (source_ref uuid);
CREATE FUNCTION public.shop_delivery_reserved_cents(p_order uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.shop_order_refunds_recorded_cents(p_order uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.shop_order_unaccounted_hand_refund(p_order uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.shop_return_stock(p_order uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"));
await db.exec(cutFn("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left"));
await db.exec(cutFn(M3, "shop_refund_fee_policy"));
await db.exec(cutFn(M3, "shop_refund_tax_kept"));
await db.exec(cutTable(M3, "shop_refunds"));
await db.exec(cutTable(M3, "shop_hand_refunds"));
await db.exec(cutFn(M3, "shop_hold_order_for_hand_refund"));
await db.exec(cutFn(M3, "shop_record_hand_refund"));
await db.exec(SPLIT);
await db.exec(BALANCE);
await db.exec(EDGE);
const skip = process.env.TWO_CHARGE_MIGRATION === "skip";
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
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refundOf = async (id) => (await svc(`SELECT * FROM public.shop_refunds WHERE order_id = '${id}'`))[0];

const BUYER = "00000000-0000-0000-0000-000000000001";
const SELLER = "00000000-0000-0000-0000-000000000011";
await svc(`INSERT INTO public.profiles VALUES ('${SELLER}', 'acct_shop')`);
let seq = 0;
/**
 * An accepted order with its first charge captured. items 4001, buyer fee 270, tax 301 (+ delivery when given).
 * `rest`: 'paid' records the rest's payment (balance fee `restFee`), 'open' leaves it unpaid.
 */
async function order({ plan = "deposit_50", rest = "paid", delivery = 0, fulfillment = "pickup", restFee = 80 } = {}) {
  seq += 1;
  const total = 4001 + 270 + 301 + delivery;
  const id = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, items_cents, premium_cents, total_cents, payment_plan,
      delivery_cents, fulfillment)
    VALUES ('${BUYER}', '${SELLER}', 4001, 270, ${total - 301}, '${plan}', ${delivery}, '${fulfillment}') RETURNING id`));
  await svc(`UPDATE public.shop_orders SET status = 'held', tax_cents = 301, total_cents = ${total},
    stripe_checkout_session_id = 'cs_test_${seq}', stripe_payment_intent_id = 'pi_dep_${seq}', payment_livemode = false WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now(), card_fee_cents = 90 WHERE id = '${id}'`);
  if (plan === "deposit_50" && rest === "paid") {
    await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'pi_rest_${seq}', balance_captured_at = now(),
      balance_card_fee_cents = ${restFee === null ? "NULL" : restFee} WHERE id = '${id}'`);
  }
  return id;
}
const o2 = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0];

// --- 1. the shop's share of the deposit charge (frozen split: the rest took the floor halves)
const share = async (id) => one(await svc(`SELECT public.shop_order_deposit_shop_cents(o) AS s FROM public.shop_orders o WHERE o.id = '${id}'`));
const a = await order();
const oa = await o2(a);
ok(oa.balance_cents === 2000 + 135 + 150 && oa.deposit_cents === oa.total_cents - oa.balance_cents,
  `the split is the one frozen at the hold (rest ${oa.balance_cents}, deposit ${oa.deposit_cents})`);
ok(await share(a) === 4001 - 2000, `two charges: the deposit pays the shop items - floor(items/2) = 2001 (${await share(a)})`);
const sd = await order({ delivery: 501, fulfillment: "shop_delivers" });
ok(await share(sd) === 2001 + (501 - 250), `the shop's own delivery: its deposit half too, 2001 + 251 (${await share(sd)})`);
const open = await order({ rest: "open" });
ok(await share(open) === null, "rest unpaid (one charge): no share, the payout stays one transfer");
const full = await order({ plan: "full_hold" });
ok(await share(full) === null, "a full-payment order: no share");
const shopTotal = async (id) => one(await svc(`SELECT public.shop_order_shop_cents(o) AS s FROM public.shop_orders o WHERE o.id = '${id}'`));
const sdo = await o2(sd);
ok(await share(sd) + (sdo.items_cents / 2 | 0) + (sdo.delivery_cents / 2 | 0) === await shopTotal(sd)
  && (sdo.items_cents / 2 | 0) + (sdo.delivery_cents / 2 | 0) <= sdo.balance_cents && await share(sd) <= sdo.deposit_cents,
  "deposit share + rest share = what the shop is owed, and each fits inside its own charge");

// --- 2. the payout queue names the rest's payment and the share
for (const id of [a, full]) {
  await svc(`UPDATE public.shop_orders SET status = 'handed_over', handed_over_at = now() WHERE id = '${id}'`);
  await svc(`INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
    VALUES ('${id}', 4001, 0, 4001, 'pending', now() - interval '1 minute')`);
}
const due = await svc(`SELECT * FROM public.shop_payouts_due(50)`);
const dueA = Array.isArray(due) ? due.find((d) => d.order_id === a) : undefined;
const dueF = Array.isArray(due) ? due.find((d) => d.order_id === full) : undefined;
ok(dueA?.balance_payment_intent_id === `pi_rest_1` && dueA?.deposit_shop_cents === 2001 && dueA?.payment_intent_id === "pi_dep_1",
  `two charges: due row carries both payments and the deposit share (${JSON.stringify(dueA ?? due)})`);
ok(dueF && dueF.balance_payment_intent_id === null && dueF.deposit_shop_cents === null,
  "a full-payment order's due row is unchanged (one charge)");

// --- 3. the rest leg's transfer is recorded once
const pid = dueA?.payout_id;
ok(one(await svc(`SELECT public.shop_payout_rest_sent('${pid}', 'tr_rest1') AS r`)) === "recorded"
  && one(await svc(`SELECT rest_transfer_id FROM public.shop_payouts WHERE id = '${pid}'`)) === "tr_rest1", "the rest leg is recorded");
ok(one(await svc(`SELECT public.shop_payout_rest_sent('${pid}', 'tr_rest1') AS r`)) === "recorded", "the same transfer again: no-op");
const differs = await svc(`SELECT public.shop_payout_rest_sent('${pid}', 'tr_other') AS r`);
ok(differs?.error?.includes("rest_transfer_differs") && one(await svc(`SELECT rest_transfer_id FROM public.shop_payouts WHERE id = '${pid}'`)) === "tr_rest1",
  "a different rest transfer is refused (the shop is never paid the rest twice)");
ok((await svc(`SELECT public.shop_payout_rest_sent('${pid}', 'nope')`))?.error?.includes("invalid_transfer"), "a non-transfer id is refused");
ok((await svc(`SELECT public.shop_payout_rest_sent(gen_random_uuid(), 'tr_x')`))?.code === "PT404", "an unknown payout is PT404");

// --- 4. the card fee: both charges' fees once the rest is paid
const fee = async (id, reason = "shop_cancelled") => (await svc(`SELECT * FROM public.shop_refund_amounts('${id}', '${reason}')`))[0];
const b = await order();
ok((await fee(b))?.card_fee_cents === 90 + 80, `two charges: card fee = deposit 90 + rest 80 (${JSON.stringify(await fee(b))})`);
const bk = await fee(b, "buyer_cancelled");
ok(bk?.kept_cents === 170 && bk?.refund_cents === bk.paid_cents - 170 - bk.tax_kept_cents, `a keep-the-fee refund keeps both fees (${JSON.stringify(bk)})`);
const c = await order({ restFee: null });
const ce = one(await svc(`SELECT public.declutter_card_fee_estimate(balance_cents) FROM public.shop_orders WHERE id = '${c}'`));
ok((await fee(c))?.card_fee_cents === 90 + ce, `the rest's fee unknown: its estimate on the rest (90 + ${ce})`);
ok((await fee(open))?.card_fee_cents === 90, "rest unpaid: only the deposit's fee, as before");
ok((await fee(full))?.card_fee_cents === 90, "a full-payment order: unchanged");

// --- 5. option B: a refund of a two-charge order is held for a person
const ins = (id, reason = "shop_cancelled", policy = "full_shop_pays_fee") => svc(`INSERT INTO public.shop_refunds (order_id,
  stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents)
  VALUES ('${id}', (SELECT stripe_payment_intent_id FROM public.shop_orders WHERE id = '${id}'), '${reason}', '${policy}',
          1000, 0, 0, 0, 0, 1000) RETURNING id`);
const d = await order();
await ins(d);
const rd = await refundOf(d);
ok(rd?.status === "held_for_review" && rd.review_held_at && /^two_charges:/.test(rd.review_reason ?? ""),
  `written straight to held_for_review (${rd?.status}: ${rd?.review_reason})`);
const release = await svc(`UPDATE public.shop_refunds SET status = 'pending' WHERE id = '${rd?.id}'`);
ok(release?.error?.includes("two_charge_refund_by_hand") && (await refundOf(d))?.status === "held_for_review",
  "releasing it to the automatic queue is refused");
const e = await order({ rest: "open" });
await ins(e);
ok((await refundOf(e))?.status === "pending", "one charge (rest unpaid): pending, sent by the queue as before");
const f = await order({ plan: "full_hold" });
await ins(f);
ok((await refundOf(f))?.status === "pending", "a full-payment order: pending as before");
await svc(`UPDATE public.shop_orders SET balance_payment_intent_id = 'pi_rest_late', balance_captured_at = now() WHERE id = '${e}'`);
const re = await refundOf(e);
ok(re?.status === "held_for_review" && /^two_charges:/.test(re.review_reason ?? ""), "a pending row is held when the rest is paid after it");
ok(Array.isArray(await svc(`UPDATE public.shop_refunds SET status = 'pending' WHERE id = '${(await refundOf(f))?.id}'`))
  && (await refundOf(f))?.status === "pending", "a one-charge row's own status writes are untouched");

// --- 6. a hand refund on the rest's payment is found and holds the order
const g = await order();
const hr = one(await svc(`SELECT public.shop_record_hand_refund('pi_rest_${seq}', 're_hand1', 500, false, 'webhook', NULL, NULL) AS r`));
const hg = (await svc(`SELECT * FROM public.shop_hand_refunds WHERE stripe_refund_id = 're_hand1'`))[0];
ok(hr && hr !== "not_shops" && hg?.order_id === g && hg.stripe_payment_intent_id === `pi_rest_${seq}`,
  `the rest's payment finds its order (${hr}; ${JSON.stringify(hg && { order: hg.order_id, pi: hg.stripe_payment_intent_id })})`);
ok(one(await svc(`SELECT public.shop_record_hand_refund('pi_dep_${seq}', 're_hand2', 500, false, 'webhook', NULL, NULL) AS r`)) !== "not_shops",
  "the deposit's payment still finds it");
ok(one(await svc(`SELECT public.shop_record_hand_refund('pi_nobody', 're_hand3', 500, false, 'webhook', NULL, NULL) AS r`)) === "not_shops",
  "an unknown payment is still not a Shops order");

// --- 7. a deposit order is never delivered by a Helpr
const h = await order({ rest: "open" });
const helpr = await svc(`UPDATE public.shop_orders SET fulfillment = 'helpr_delivers' WHERE id = '${h}'`);
ok(helpr?.code === "23514" && (await o2(h)).fulfillment === "pickup", `a deposit order refuses Helpr delivery (${JSON.stringify(helpr)})`);
const hf = await order({ plan: "full_hold" });
ok(Array.isArray(await svc(`UPDATE public.shop_orders SET fulfillment = 'helpr_delivers' WHERE id = '${hf}'`)), "a full-payment order may");

// --- 8. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_order_two_charges', 'shop_order_deposit_shop_cents', 'shop_payouts_due', 'shop_payout_rest_sent',
                      'shop_refund_amounts', 'shop_refunds_two_charge_hold', 'shop_orders_two_charge_hold_refunds', 'shop_record_hand_refund')`);
ok(Array.isArray(grants) && grants.length === 8 && grants.every((x) => !x.m && !x.a), `service only (${JSON.stringify(grants)})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (TWO_CHARGE_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
