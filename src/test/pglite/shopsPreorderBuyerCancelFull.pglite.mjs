#!/usr/bin/env node
/**
 * PGlite proof for 20261112220952_shops_preorder_buyer_cancel_full_refund.sql (Shops audit 2, S2-019): a buyer who
 * cancels a paid preorder before it is marked ready gets every cent back (order + the setup fee its charge carried),
 * and the shop carries Stripe's card fee as seller fee debt. Other buyer cancels (buyer_cancelled) still keep the fee.
 *
 *   node src/test/pglite/shopsPreorderBuyerCancelFull.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPreorderBuyerCancelFull.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * Real: shop_refunds (its CREATE TABLE with every CHECK, plus 20261112082518 whole), shop_refund_fee_policy,
 * shop_refund_amounts, shop_write_refund, shop_refund_tax_kept, declutter_card_fee_left/estimate, shops_cancel_preorder.
 * Stubbed, and said so: auth.uid() from a setting; shop_orders / shop_items / shop_handovers cut to the columns read;
 * shop_lock_open_charged_order returns the row; declutter_notify records nothing; no balance, two charges or delivery.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112220952_shops_preorder_buyer_cancel_full_refund.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `3c0b3c0c-0000-0000-0001-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), ITEM = U(3);
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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('t.uid', true), '')::uuid $$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text,
  captured_at timestamptz DEFAULT now(), stripe_payment_intent_id text, total_cents integer, tax_cents integer DEFAULT 0,
  card_fee_cents integer, balance_cents integer DEFAULT 0, deposit_cents integer DEFAULT 0, balance_card_fee_cents integer,
  delivery_cents integer DEFAULT 0, setup_fee_cents integer NOT NULL DEFAULT 0, setup_fee_state text,
  preorder_item_id uuid, ready_date date, preorder_moved_at timestamptz, close_reason text, closed_at timestamptz);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, preorder_goal_missed_at timestamptz);
CREATE TABLE public.shop_handovers (order_id uuid, ready_at timestamptz);
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
CREATE FUNCTION public.shop_lock_open_charged_order(p uuid, b boolean) RETURNS public.shop_orders LANGUAGE sql
  AS 'SELECT * FROM public.shop_orders WHERE id = p';
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT';
${table}
INSERT INTO public.profiles VALUES ('${BUYER}', true, now());
INSERT INTO public.shop_items VALUES ('${ITEM}', NULL);
`);
// The state before this migration: the preorders reason list, then S035 (20261112082518) whole.
await db.exec(`ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_reason_check;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_reason_check CHECK (reason IN (
  'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault', 'problem_no_fault',
  'problem_our_mistake', 'unpaid_close_tax', 'preorder_goal_missed', 'preorder_shop_late', 'preorder_date_moved'));`);
await db.exec(readFileSync(MIG_DIR + "20261112082518_shops_setup_fee_refund.sql", "utf8"));
await db.exec(fnFrom("20261108184654_shops_preorders.sql", "shops_cancel_preorder"));
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
let n = 0;
const order = async (over = "") => (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, stripe_payment_intent_id,
  total_cents, tax_cents, card_fee_cents, setup_fee_cents, setup_fee_state, preorder_item_id, ready_date)
  VALUES ('${BUYER}', '${SELLER}', 'accepted', 'pi_${++n}', 5000, 400, 175, 200, 'claimed', '${ITEM}', current_date + 20) RETURNING id`))[0].id;
const cancel = async (id) => { await db.exec(`SELECT set_config('t.uid', '${BUYER}', false)`); try { return (await q(`SELECT public.shops_cancel_preorder('${id}') AS r`))[0].r; } catch (e) { return { error: e.message }; } };
try {
  const o1 = await order();
  const r1 = await cancel(o1);
  const row = (await q(`SELECT * FROM public.shop_refunds WHERE order_id = '${o1}'`))[0] ?? {};
  check(r1.refund_cents === 5200, "S2-019: the buyer's own preorder cancel refunds every cent (order + setup fee)", JSON.stringify(r1));
  check(row.reason === "preorder_buyer_cancelled" && row.fee_policy === "full_shop_pays_fee" && row.kept_cents === 0 && row.tax_kept_cents === 0,
    "S2-019: filed as preorder_buyer_cancelled, full_shop_pays_fee, nothing kept", JSON.stringify(row));
  const debt = (await q(`SELECT * FROM public.declutter_seller_fee_debts WHERE shop_refund_id = '${row.id}'`))[0];
  check(debt?.seller_id === SELLER && debt?.amount_cents === 175, "S2-019: the shop carries the card fee as seller fee debt", JSON.stringify(debt ?? null));
  const st = (await q(`SELECT status, close_reason FROM public.shop_orders WHERE id = '${o1}'`))[0];
  check(st.status === "refunded" && st.close_reason === "preorder_cancelled", "S2-019: the order closes as preorder_cancelled", JSON.stringify(st));
  // A preorder already marked ready can't be cancelled (unchanged).
  const o2 = await order();
  await db.exec(`INSERT INTO public.shop_handovers VALUES ('${o2}', now())`);
  const r2 = await cancel(o2);
  check(/preorder_ready/.test(r2.error ?? ""), "unchanged: a preorder marked ready can't be cancelled", JSON.stringify(r2));
  // The ordinary buyer cancel of a normal order still keeps the card fee (buyer_cancelled unchanged).
  const pol = (await q(`SELECT public.shop_refund_fee_policy('buyer_cancelled') AS p`))[0].p;
  check(pol === "keep_card_fee", "unchanged: buyer_cancelled keeps the card fee", pol);
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
