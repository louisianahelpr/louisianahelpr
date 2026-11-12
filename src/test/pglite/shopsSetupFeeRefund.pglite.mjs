#!/usr/bin/env node
/**
 * PGlite proof for 20261112082518_shops_setup_fee_refund.sql (Shops audit 11-12 S035): a refund that is not the buyer's doing
 * (shop cancel, our mistake) gives the one-time setup fee back with the order and puts the account's fee back; the
 * buyer's own cancel keeps it; an order whose charge did not carry the fee refunds no fee. The amount CHECK holds.
 *
 *   node src/test/pglite/shopsSetupFeeRefund.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsSetupFeeRefund.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 *
 * Real: shop_refunds (its CREATE TABLE with every CHECK), shop_refund_fee_policy, shop_refund_tax_kept,
 * declutter_card_fee_left, declutter_card_fee_estimate. Stubbed, and said so: shop_orders cut to the columns read;
 * shop_order_balance_open / shop_order_two_charges / shop_order_unaccounted_hand_refund false; no delivery reserved.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112082518_shops_setup_fee_refund.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `3c0b3c0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const refundsSql = readFileSync(MIG_DIR + "20261019071055_shops_refunds_cancels_strikes.sql", "utf8");
const table = refundsSql.slice(refundsSql.indexOf("CREATE TABLE IF NOT EXISTS public.shop_refunds ("),
  refundsSql.indexOf("\n);", refundsSql.indexOf("CREATE TABLE IF NOT EXISTS public.shop_refunds (")) + 3);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text,
  captured_at timestamptz DEFAULT now(), stripe_payment_intent_id text, total_cents integer, tax_cents integer DEFAULT 0,
  card_fee_cents integer, balance_cents integer DEFAULT 0, deposit_cents integer DEFAULT 0, balance_card_fee_cents integer,
  delivery_cents integer DEFAULT 0, setup_fee_cents integer NOT NULL DEFAULT 0, setup_fee_state text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, onboarding_fee_paid boolean, onboarding_fee_charged_at timestamptz);
CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, shop_refund_id uuid UNIQUE, amount_cents integer, remaining_cents integer);
CREATE TABLE public.shop_cottage_sales (source_ref uuid);
${fnFrom("20261108184654_shops_preorders.sql", "shop_refund_fee_policy")}
${fnFrom("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept")}
${fnFrom("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate")}
${fnFrom("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left")}
CREATE FUNCTION public.shop_order_balance_open(o public.shop_orders) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_order_two_charges(o public.shop_orders) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_delivery_reserved_cents(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_order_unaccounted_hand_refund(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
${table}
INSERT INTO public.profiles VALUES ('${BUYER}', true, now());
`);
if (skip) {
  await db.exec(fnFrom("20261107162454_shops_custom_two_charge_payout.sql", "shop_refund_amounts"));
  await db.exec(fnFrom("20261019071055_shops_refunds_cancels_strikes.sql", "shop_write_refund"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
let n = 0;
const order = async (state = "claimed") => (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, stripe_payment_intent_id, total_cents, card_fee_cents, setup_fee_cents, setup_fee_state)
  VALUES ('${BUYER}', '${SELLER}', 'accepted', 'pi_${++n}', 5000, 175, ${state ? 200 : 0}, ${state ? `'${state}'` : "NULL"}) RETURNING id`))[0].id;
const write = async (id, reason) => { try { return (await q(`SELECT * FROM public.shop_write_refund('${id}', '${reason}', NULL)`))[0]; } catch (e) { return { error: e.message }; } };
const paid = async () => (await q(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${BUYER}'`))[0].onboarding_fee_paid;
try {
  const o1 = await order();
  const r1 = await write(o1, "shop_cancelled");
  check(r1.refund_cents === 5200, "S035: a shop cancel refunds the order AND the $2 setup fee its charge carried", JSON.stringify(r1));
  check((await paid()) === false, "S035: the account's setup fee is put back (owed again once)", String(await paid()));
  const st = (await q(`SELECT setup_fee_state FROM public.shop_orders WHERE id = '${o1}'`))[0]?.setup_fee_state;
  check(st === "put_back", "S035: the order's fee state reads put_back", st);
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${BUYER}'`);
  const o2 = await order();
  const r2 = await write(o2, "buyer_cancelled");
  check(r2.refund_cents === 5000 - 175 && (await paid()) === true, "S035: the buyer's own cancel keeps the fee (and the card fee)", JSON.stringify(r2));
  const o3 = await order();
  const r3 = await write(o3, "problem_our_mistake");
  check(r3.refund_cents === 5200, "S035: our mistake refunds the fee too", JSON.stringify(r3));
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${BUYER}'`);
  const o4 = await order("not_charged");
  const r4 = await write(o4, "shop_cancelled");
  check(r4.refund_cents === 5000 && (await paid()) === true, "S035: an order whose charge did not carry the fee refunds no fee and leaves the account paid", JSON.stringify(r4));
  const o5 = await order(null);
  const r5 = await write(o5, "shop_removed");
  check(r5.refund_cents === 5000, "S035: an order with no fee refunds the order only", JSON.stringify(r5));
  if (!skip) {
    const o6 = await order();
    let bad = null;
    try { await q(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents, setup_fee_refund_cents)
      VALUES ('${o6}', 'pi_x6', 'buyer_cancelled', 'keep_card_fee', 5000, 0, 175, 175, 0, 5025, 200)`); } catch (e) { bad = e.message; }
    check(/shop_refunds_setup_fee_refund/.test(bad ?? ""), "S035: the table refuses a setup fee refund on a buyer's cancel", bad ?? "inserted");
    let bad2 = null;
    try { await q(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents, setup_fee_refund_cents)
      VALUES ('${o6}', 'pi_x7', 'shop_cancelled', 'full_shop_pays_fee', 5000, 0, 175, 0, 0, 5000, 200)`); } catch (e) { bad2 = e.message; }
    check(/shop_refunds_amount/.test(bad2 ?? ""), "S035: the amount CHECK counts the fee back", bad2 ?? "inserted");
  }
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
