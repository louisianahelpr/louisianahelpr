#!/usr/bin/env node
/**
 * PGlite proof for 20261108195900_shops_deposit_hidden_pickup_private.sql (shops audit 11-08 #1 and #2, Builder 5).
 *
 *   node src/test/pglite/shopsDepositHiddenPickupPrivate.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsDepositHiddenPickupPrivate.pglite.mjs  # RED: the old bodies
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsDepositHiddenPickupPrivate.pglite.mjs
 *
 * The OLD bodies come verbatim from their newest CREATE before this migration (cutFn), so NEW_MIGRATION=skip runs
 * exactly what prod runs today. The gates they call are stubs driven by tables.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261108195900_shops_deposit_hidden_pickup_private.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim (any dollar tag). */
function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, OWNER, OWNER2, STRANGER, SHOP, SHOP2] = [1, 11, 12, 13, 91, 92].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  RETURN auth.uid();
END $$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, link) VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE, custom_orders text NOT NULL DEFAULT 'off'
  CHECK (custom_orders IN ('off', 'full_hold', 'deposit_50')), updated_at timestamptz);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, status text NOT NULL,
  payment_plan text NOT NULL CHECK (payment_plan IN ('full_hold', 'deposit_50')));
CREATE TABLE public.shop_pickup_addresses (shop_id uuid PRIMARY KEY, owner_id uuid, line1 text, line2 text, city text,
  state_code text DEFAULT 'LA', postal_code text);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL, ready_date date NOT NULL, fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz);
CREATE TABLE public.shop_order_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, at_buyer boolean NOT NULL DEFAULT false);
`;

const OLD = [
  cutFn("20261106202917_shops_custom_requests.sql", "shops_set_custom_orders"),
  cutFn("20261018210400_shops_pickup_address.sql", "shops_order_pickup_address"),
].join("\n");

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); }
};

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(OLD);
// Prod-shaped data from before the migration: two shops on half up front, one open and one closed deposit request.
await db.exec(`
INSERT INTO public.test_accounts VALUES ('${OWNER}'), ('${OWNER2}'), ('${BUYER}'), ('${STRANGER}');
INSERT INTO public.shops (id, owner_id, custom_orders) VALUES ('${SHOP}', '${OWNER}', 'deposit_50'), ('${SHOP2}', '${OWNER2}', 'full_hold');
INSERT INTO public.shop_custom_requests (shop_id, status, payment_plan) VALUES
  ('${SHOP}', 'requested', 'deposit_50'), ('${SHOP}', 'quoted', 'deposit_50'), ('${SHOP}', 'declined', 'deposit_50');
INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, city, postal_code) VALUES ('${SHOP}', '${OWNER}', '12 Home St', 'Lafayette', '70506');
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

const as = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: e }; } finally {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const svc = async (sql) => (await db.query(sql)).rows;

// #1
const setDeposit = await as(OWNER2, "SELECT public.shops_set_custom_orders('deposit_50') AS m");
ok(setDeposit.error && /deposit_orders_closed/.test(setDeposit.error.message), "#1a half up front can no longer be picked");
ok((await svc(`SELECT custom_orders FROM public.shops WHERE id = '${SHOP2}'`))[0].custom_orders === "full_hold",
  "#1a a refused pick leaves the shop's choice alone");
const setFull = await as(OWNER2, "SELECT public.shops_set_custom_orders('off') AS m");
ok(setFull.rows?.[0]?.m === "off", "#1a the open choices still save");
ok((await svc(`SELECT custom_orders FROM public.shops WHERE id = '${SHOP}'`))[0].custom_orders === "full_hold",
  "#1b a shop already on half up front is now paid in full");
const notes = await svc(`SELECT user_id, title FROM public.notifications`);
ok(notes.length === 1 && notes[0].user_id === OWNER && /paid in full/.test(notes[0].title),
  "#1b that shop gets exactly one plain note, even after 3 replays");
const plans = await svc(`SELECT status, payment_plan FROM public.shop_custom_requests ORDER BY status`);
ok(plans.find((p) => p.status === "requested").payment_plan === "full_hold" && plans.find((p) => p.status === "quoted").payment_plan === "full_hold",
  "#1c open deposit requests become paid in full, so the buyer can order the price");
ok(plans.find((p) => p.status === "declined").payment_plan === "deposit_50", "#1c a closed request keeps its history");

// #2
const today = "(now() AT TIME ZONE 'America/Chicago')::date";
async function orderOf(over = {}, atBuyer = false) {
  const o = { status: "accepted", fulfillment: "pickup", helpr_unfilled_at: "NULL", ...over };
  const [{ id: oid }] = await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, status, ready_date, fulfillment, helpr_unfilled_at)
    VALUES ('${BUYER}', '${OWNER}', '${SHOP}', '${o.status}', ${today}, '${o.fulfillment}', ${o.helpr_unfilled_at}) RETURNING id`);
  await svc(`INSERT INTO public.shop_order_lines (order_id, at_buyer) VALUES ('${oid}', ${atBuyer})`);
  return oid;
}
const read = async (uid, oid) => (await as(uid, `SELECT line1 FROM public.shops_order_pickup_address('${oid}')`)).rows ?? [];

const pickup = await orderOf();
ok((await read(BUYER, pickup)).length === 1, "#2 a pickup buyer of an accepted order still reads where to pick up");
ok((await read(STRANGER, pickup)).length === 0, "#2 a stranger reads nothing");
const atHome = await orderOf({}, true);
ok((await read(BUYER, atHome)).length === 0, "#2 a buyer of at-home work never reads the shop's address");
ok((await read(OWNER, atHome)).length === 1, "#2 the shop still reads its own address back");
const shopDelivers = await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, status, ready_date, fulfillment)
  VALUES ('${BUYER}', '${OWNER}', '${SHOP}', 'accepted', ${today}, 'shop_delivers') RETURNING id`);
ok((await read(BUYER, shopDelivers[0].id)).length === 0, "#2 a buyer of a shop delivery never reads the shop's address");
const helpr = await orderOf({ fulfillment: "helpr_delivers" });
ok((await read(BUYER, helpr)).length === 0, "#2 a buyer of a Helpr delivery never reads the shop's address");
const unfilled = await orderOf({ fulfillment: "helpr_delivers", helpr_unfilled_at: "now()" });
ok((await read(BUYER, unfilled)).length === 1, "#2 a Helpr delivery that fell back to pickup reads where to pick up");
const held = await orderOf({ status: "held" });
ok((await read(BUYER, held)).length === 0, "#2 a held order still reads nothing");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
