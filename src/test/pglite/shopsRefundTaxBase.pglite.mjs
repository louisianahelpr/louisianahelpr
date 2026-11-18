#!/usr/bin/env node
/**
 * PGlite proof for 20261118060158_shops_refund_tax_on_taxed_base.sql (Q2111 cash layer, Shops launch pass 2,
 * 2026-11-18): a keep-card-fee refund keeps the tax on the kept fee at the rate the tax was figured on, items plus
 * buyer fee, never counting the untaxed delivery. The item's worked example: items 2000, fee 170, delivery 500,
 * tax 195 (charge 2865), card fee kept 100: tax kept 9 (was 8), refund 2756 (was 2757).
 *
 *   node src/test/pglite/shopsRefundTaxBase.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsRefundTaxBase.pglite.mjs # RED: 20261112082518's bodies (paid - tax)
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * Harness from shopsSetupFeeRefund.pglite.mjs. Real: shop_refunds (its CREATE TABLE with every CHECK, then the
 * setup-fee migration's), shop_refund_fee_policy, shop_refund_tax_kept, declutter_card_fee_left/estimate. Stubbed:
 * shop_orders cut to the columns read; balance_open / two_charges / hand refund false; no delivery reserved.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261118060158_shops_refund_tax_on_taxed_base.sql";
const SETUP = MIG_DIR + "20261112082518_shops_setup_fee_refund.sql";
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
for (let k = 1; k <= 3; k++) await db.exec(readFileSync(SETUP, "utf8"));
if (!skip) for (let k = 1; k <= 3; k++) await db.exec(readFileSync(THIS, "utf8"));
const q = async (s) => (await db.query(s)).rows;
let n = 0;
const order = async ({ total, tax, delivery, fee }) => (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status,
  stripe_payment_intent_id, total_cents, tax_cents, delivery_cents, card_fee_cents, setup_fee_cents, setup_fee_state)
  VALUES ('${BUYER}', '${SELLER}', 'accepted', 'pi_${++n}', ${total}, ${tax}, ${delivery}, ${fee}, 0, NULL) RETURNING id`))[0].id;
const write = async (id, reason) => { try { return (await q(`SELECT * FROM public.shop_write_refund('${id}', '${reason}', NULL)`))[0]; } catch (e) { return { error: e.message }; } };
try {
  // The item's worked example: a delivery order, keep-card-fee (the buyer's own cancel).
  const o1 = await order({ total: 2865, tax: 195, delivery: 500, fee: 100 });
  const r1 = await write(o1, "buyer_cancelled");
  check(r1.tax_kept_cents === 9, "a delivery order keeps the tax on the kept fee at the items' rate (9c, not 8c)", JSON.stringify(r1));
  check(r1.refund_cents === 2756, "so the buyer gets back 2756, not 2757", JSON.stringify(r1));
  check(skip || r1.taxed_base_cents === 2170, "the row records the taxed base (items + fee = 2170)", JSON.stringify(r1));
  // A pickup order (no delivery): the same number as before.
  const o2 = await order({ total: 2365, tax: 195, delivery: 0, fee: 100 });
  const r2 = await write(o2, "buyer_cancelled");
  check(r2.tax_kept_cents === 9 && r2.refund_cents === 2256, "a pickup order is unchanged (9c kept, 2256 back)", JSON.stringify(r2));
  // A full refund (the shop's fault) keeps nothing and gives everything back, delivery included.
  const o3 = await order({ total: 2865, tax: 195, delivery: 500, fee: 100 });
  const r3 = await write(o3, "shop_cancelled");
  check(r3.tax_kept_cents === 0 && r3.refund_cents === 2865, "a full refund of a delivery order returns the whole charge", JSON.stringify(r3));
  if (!skip) {
    // The CHECK: a row that names a base must keep exactly the tax on that base.
    const o4 = await order({ total: 2865, tax: 195, delivery: 500, fee: 100 });
    let bad = null;
    try { await q(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents, taxed_base_cents)
      VALUES ('${o4}', 'pi_x4', 'buyer_cancelled', 'keep_card_fee', 2865, 195, 100, 100, 8, 2757, 2170)`); } catch (e) { bad = e.message; }
    check(/shop_refunds_tax_kept/.test(bad ?? ""), "the table refuses the old 8c on a row with a taxed base", bad ?? "inserted");
    let bad2 = null;
    try { await q(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents, taxed_base_cents)
      VALUES ('${o4}', 'pi_x5', 'buyer_cancelled', 'keep_card_fee', 2865, 195, 100, 100, 4, 2761, 5000)`); } catch (e) { bad2 = e.message; }
    check(/shop_refunds_taxed_base/.test(bad2 ?? ""), "the table refuses a base larger than paid less tax", bad2 ?? "inserted");
    // An older row with no base still reads the old formula.
    let ok3 = true;
    try { await q(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents)
      VALUES ('${o4}', 'pi_x6', 'buyer_cancelled', 'keep_card_fee', 2865, 195, 100, 100, 8, 2757)`); } catch (e) { ok3 = e.message; }
    check(ok3 === true, "a row with no base (written before this migration) still satisfies the CHECK", String(ok3));
  }
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
