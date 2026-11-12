#!/usr/bin/env node
/**
 * PGlite proof for 20261112075702_shops_cottage_limit_strict.sql (Shops audit 11-12 S033): an order that would bring a
 * home baker's year to EXACTLY the $100,000 limit is refused, at accept and at a preorder's hold; one cent under passes.
 *
 *   node src/test/pglite/shopsCottageLimitStrict.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCottageLimitStrict.pglite.mjs # RED: the old ">" (newest CREATEs)
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; require_feature, is_caller_banned,
 * are_users_blocked, shop_owner_sell_block_reason, shop_day_count, shop_preorder_units, declutter_notify no-ops;
 * shop_cottage_sales_cents from a setting.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261112075702_shops_cottage_limit_strict.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `9b0b9b0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), SHOP = U(3), ITEM = U(4);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, daily_order_cap smallint, hidden_at timestamptz);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, title text, stock_count integer, updated_at timestamptz, preorder_ready_by date,
  preorder_goal_missed_at timestamptz, preorder_goal_by date, preorder_cap integer);
CREATE TABLE public.shop_item_variants (id uuid PRIMARY KEY, stock_count integer, updated_at timestamptz);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz, onboarding_fee_paid boolean,
  onboarding_fee_charged_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid, status text,
  items_cents integer NOT NULL DEFAULT 0, premium_cents integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0,
  delivery_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL DEFAULT 0, gift_cents integer NOT NULL DEFAULT 0,
  setup_fee_cents integer NOT NULL DEFAULT 0, setup_fee_state text, stripe_payment_intent_id text, stripe_checkout_session_id text,
  payment_livemode boolean, captured_at timestamptz, close_reason text, closed_at timestamptz, held_at timestamptz,
  accept_by timestamptz, accepted_at timestamptz, preorder_item_id uuid, ready_date date DEFAULT current_date);
CREATE TABLE public.shop_order_lines (order_id uuid, item_id uuid, variant_id uuid, quantity integer DEFAULT 1, kind text,
  line_cents integer, title text);
CREATE TABLE public.shop_cottage_settings (id boolean PRIMARY KEY DEFAULT true, cap_cents bigint);
INSERT INTO public.shop_cottage_settings VALUES (true, 10000000);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_owner_sell_block_reason(uuid) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_preorder_units(uuid, boolean) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS 'SELECT current_date';
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.shop_cottage_sales_cents(uuid) RETURNS bigint LANGUAGE sql AS
  $f$ SELECT coalesce(nullif(current_setting('test.sales', true), ''), '0')::bigint $f$;
INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${SELLER}', 'Kitchen');
INSERT INTO public.profiles (user_id) VALUES ('${BUYER}'), ('${SELLER}');
INSERT INTO public.shop_items (id, title, preorder_ready_by) VALUES ('${ITEM}', 'Pie', current_date + 10);
`);
if (skip) {
  await db.exec(fnFrom("20261106165310_shops_item_variants.sql", "shops_accept_order"));
  await db.exec(fnFrom("20261112073633_shops_audit_highs.sql", "shop_mark_order_held"));
} else {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const held = async () => {
  const id = (await q(`INSERT INTO public.shop_orders (shop_id, buyer_id, seller_id, status, accept_by) VALUES ('${SHOP}', '${BUYER}', '${SELLER}', 'held', now() + interval '1 hour') RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines (order_id, item_id, kind, line_cents) VALUES ('${id}', '${ITEM}', 'home_food', 2000)`);
  return id;
};
const accept = async (id) => { await db.exec(`SELECT set_config('test.uid', '${SELLER}', false)`); try { await q(`SELECT public.shops_accept_order('${id}')`); return null; } catch (e) { return e.message; } };
let sess = 0;
const preorder = async () => {
  const s = `cs_${++sess}`;
  const id = (await q(`INSERT INTO public.shop_orders (shop_id, buyer_id, seller_id, status, items_cents, stripe_checkout_session_id, preorder_item_id, ready_date)
    VALUES ('${SHOP}', '${BUYER}', '${SELLER}', 'awaiting_hold', 2000, '${s}', '${ITEM}', current_date + 10) RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines (order_id, item_id, kind, line_cents) VALUES ('${id}', '${ITEM}', 'home_food', 2000)`);
  return (await q(`SELECT public.shop_mark_order_held('${s}', 'pi_${sess}', 2000, 0, false) AS r`))[0].r;
};
try {
  // $99,980 so far + this $20 order = exactly $100,000.
  await db.exec(`SELECT set_config('test.sales', '9998000', false)`);
  const e1 = await accept(await held());
  check(/cottage_limit_reached/.test(e1 ?? ""), "S033: an accept that brings home-food sales to EXACTLY $100,000 is refused", e1 ?? "accepted");
  const p1 = await preorder();
  check(p1.result === "cancel_hold", "S033: a preorder hold that reaches exactly $100,000 is refused (no charge)", JSON.stringify(p1));
  await db.exec(`SELECT set_config('test.sales', '9997999', false)`);
  const e2 = await accept(await held());
  check(e2 === null, "S033: one cent under the limit is accepted", e2 ?? "");
  // Charged now (its sale is in shop_cottage_sales_cents, stubbed fixed here), so it no longer counts as accepted-uncharged.
  await db.exec(`UPDATE public.shop_orders SET captured_at = now() WHERE status = 'accepted'`);
  const p2 = await preorder();
  check(p2.result === "held", "S033: a preorder one cent under the limit goes through", JSON.stringify(p2));
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
