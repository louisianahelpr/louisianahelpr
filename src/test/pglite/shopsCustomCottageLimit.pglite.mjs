#!/usr/bin/env node
/**
 * PGlite proof for 20261112080238_shops_custom_order_cottage_limit.sql (S033 follow-up): a custom home-food price that
 * would bring the kitchen's year to the $100,000 limit is refused when the shop sends it and when the buyer orders it,
 * counting accepted orders not yet charged; one cent under passes. A non-food custom order is not limited.
 *
 *   node src/test/pglite/shopsCustomCottageLimit.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCustomCottageLimit.pglite.mjs # RED: the newest CREATEs before it
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; require_feature, is_caller_banned,
 * shops_assert_owner_eligible, are_users_blocked, shop_visible_to, shop_owner_sell_block_reason, shop_day_count,
 * shop_active_strike_count, member_under_18, contact_leak_reason, declutter_notify, shop_item_required_statements and
 * declutter_buyer_fee_cents are fixed stubs; shop_cottage_sales_cents from a setting; shop_cottage_cap_reached real.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112080238_shops_custom_order_cottage_limit.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `9b0b9b0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), SHOP = U(3);
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
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, daily_order_cap smallint, hidden_at timestamptz,
  paused boolean DEFAULT false, custom_orders text DEFAULT 'full_hold', offers_selling boolean DEFAULT true, cancel_policy text DEFAULT 'flexible');
CREATE TABLE public.shop_hours (shop_id uuid, weekday smallint);
CREATE TABLE public.shop_item_subtypes (slug text PRIMARY KEY, kind text);
INSERT INTO public.shop_item_subtypes VALUES ('cakes', 'home_food'), ('woodwork', 'made');
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, status text,
  description text DEFAULT 'A cake', quote_cents integer, quote_note text, subtype text, statements text[], statements_at timestamptz,
  quoted_at timestamptz, expires_at timestamptz, updated_at timestamptz, order_id uuid, payment_plan text DEFAULT 'full_hold');
CREATE TABLE public.shop_cottage_confirmations (owner_id uuid, limit_year integer);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text, ready_date date, cancel_policy text, note text, items_cents integer, premium_cents integer, tax_cents integer,
  total_cents integer, payment_plan text, captured_at timestamptz, close_reason text, closed_at timestamptz,
  stripe_checkout_session_id text, is_seed boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.shop_order_lines (order_id uuid, item_id uuid, variant_id uuid, variant_label text, title text, kind text,
  unit_cents integer, quantity integer, line_cents integer, custom_request_id uuid, is_seed boolean);
CREATE TABLE public.shop_cottage_settings (id boolean PRIMARY KEY DEFAULT true, cap_cents bigint);
INSERT INTO public.shop_cottage_settings VALUES (true, 10000000);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE sql AS 'SELECT auth.uid()';
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_visible_to(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.shop_owner_sell_block_reason(uuid) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_active_strike_count(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_item_required_statements(text, text) RETURNS text[] LANGUAGE sql AS $f$ SELECT ARRAY['ok'] $f$;
CREATE FUNCTION public.declutter_buyer_fee_cents(integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS 'SELECT current_date';
CREATE FUNCTION public.shop_cottage_year() RETURNS integer LANGUAGE sql AS 'SELECT 2026';
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.shop_cottage_sales_cents(uuid) RETURNS bigint LANGUAGE sql AS
  $f$ SELECT coalesce(nullif(current_setting('test.sales', true), ''), '0')::bigint $f$;
${fnFrom("20261017061157_shops_items.sql", "shop_cottage_cap_reached")}
INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${SELLER}', 'Kitchen');
INSERT INTO public.shop_hours SELECT '${SHOP}', d FROM generate_series(0, 6) d;
INSERT INTO public.shop_cottage_confirmations VALUES ('${SELLER}', 2026);
`);
if (skip) {
  await db.exec(fnFrom("20261106205852_shops_custom_order_accept.sql", "shops_quote_custom_request"));
  await db.exec(fnFrom("20261106212437_shops_custom_deposit_split.sql", "shops_order_custom_quote"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const as = (u) => db.exec(`SELECT set_config('test.uid', '${u}', false)`);
const sales = (c) => db.exec(`SELECT set_config('test.sales', '${c}', false)`);
const request = async () => (await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, status) VALUES ('${SHOP}', '${BUYER}', 'requested') RETURNING id`))[0].id;
const quote = async (rid, cents, subtype = "cakes") => {
  await as(SELLER);
  try { await q(`SELECT public.shops_quote_custom_request('${rid}', ${cents}, NULL, '${subtype}', ARRAY['ok'])`); return null; } catch (e) { return e.message; }
};
const order = async (rid) => {
  await as(BUYER);
  try { await q(`SELECT public.shops_order_custom_quote('${rid}', '${SHOP}', current_date + 3, NULL)`); return null; } catch (e) { return e.message; }
};
// A price set straight on the row (as if quoted before sales grew), to reach the order step on its own.
const quotedRow = async (cents, subtype = "cakes") => (await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, status, quote_cents, subtype, statements, expires_at)
  VALUES ('${SHOP}', '${BUYER}', 'quoted', ${cents}, '${subtype}', ARRAY['ok'], now() + interval '7 days') RETURNING id`))[0].id;
try {
  // $95,000 so far; a $5,000 price brings the year to exactly $100,000.
  await sales(9500000);
  const e1 = await quote(await request(), 500000);
  check(/cottage_cap_reached/.test(e1 ?? ""), "the shop's $5,000 home-food price that reaches exactly $100,000 is refused", e1 ?? "quoted");
  const e2 = await quote(await request(), 499999);
  check(e2 === null, "one cent under the limit can be quoted", e2 ?? "");
  const e3 = await quote(await request(), 500000, "woodwork");
  check(e3 === null, "a non-food custom price is not limited", e3 ?? "");
  // Sales grew after the price was sent: the buyer's order is refused before any card hold.
  const e4 = await order(await quotedRow(500000));
  check(/cottage_limit_reached/.test(e4 ?? ""), "ordering a home-food price that reaches the limit is refused before the hold", e4 ?? "ordered");
  const e5 = await order(await quotedRow(499999));
  check(e5 === null, "ordering one cent under the limit goes through", e5 ?? "");
  // An accepted, not-yet-charged home-food order counts toward the limit.
  await db.exec(`UPDATE public.shop_orders SET status = 'accepted'`);
  const e6 = await order(await quotedRow(100));
  check(/cottage_limit_reached/.test(e6 ?? ""), "an accepted, not-yet-charged home-food order counts toward the limit", e6 ?? "ordered");
  const e7 = await order(await quotedRow(500000, "woodwork"));
  check(e7 === null, "a non-food custom order is not limited", e7 ?? "");
  if (!skip) {
    const r = await q(`SELECT public.shop_cottage_would_reach(NULL, 1) a, public.shop_cottage_would_reach('${SELLER}', NULL) b`);
    check(r[0].a === true && r[0].b === true, "shop_cottage_would_reach fails safe on a NULL owner or amount");
    await db.exec(`DELETE FROM public.shop_cottage_settings`);
    const r2 = await q(`SELECT public.shop_cottage_would_reach('${SELLER}', 1) a`);
    check(r2[0].a === true, "no limit row fails safe (TRUE)");
  }
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
