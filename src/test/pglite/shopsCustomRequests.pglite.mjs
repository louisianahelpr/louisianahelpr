#!/usr/bin/env node
/**
 * PGlite proof for 20261106202917_shops_custom_requests.sql (Shops custom orders slice 1a, Builder 4, 11-06): the
 * shop's setting (off / full payment held / 50% deposit), and the request -> quote -> decline/withdraw steps.
 * No money in this slice.
 *
 *   node src/test/pglite/shopsCustomRequests.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCustomRequests.pglite.mjs  # RED: no custom requests
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsCustomRequests.pglite.mjs
 *
 * Stub schema in the shape of shopsDelivery.pglite.mjs: prod-shaped columns only for what these functions read; the
 * gates the RPCs call (require_feature, bans, strikes, age, visibility, blocks, selling) are stubs driven by tables.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106202917_shops_custom_requests.sql"), "utf8");
// Slice 1b (20261106205852): the price becomes a one-line order. CUSTOM_ORDER_MIGRATION=skip leaves sections 7-9 RED.
const ORDER_MIGRATION = readFileSync(process.env.ORDER_MIGRATION_PATH ?? url("20261106205852_shops_custom_order_accept.sql"), "utf8");

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
const [BUYER, OTHER, OWNER, OWNER2, BANNED, STRUCK, MINOR, BLOCKED, OUTSIDER, SEED, SHOP, SHOP2] =
  [1, 2, 11, 12, 13, 14, 15, 16, 17, 18, 91, 92].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
CREATE TABLE public.struck (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.shop_active_strike_count(p uuid) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT CASE WHEN EXISTS (SELECT 1 FROM public.struck WHERE user_id = p) THEN 3 ELSE 0 END $$;
CREATE TABLE public.minors (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.member_under_18(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.minors WHERE user_id = p) $$;
CREATE TABLE public.blocks (a uuid, b uuid);
CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501'; END IF;
  RETURN auth.uid();
END $$;
CREATE TABLE public.sell_blocked (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.shop_owner_sell_block_reason(p uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT CASE WHEN EXISTS (SELECT 1 FROM public.sell_blocked WHERE user_id = p) THEN 'payouts_not_set_up' END $$;
-- contact_leak_reason's contract: a reason for a phone number, email or link, else NULL.
CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t ~ '\\d{3}[-. ]?\\d{3}[-. ]?\\d{4}' THEN 'A phone number'
              WHEN t ~* '[a-z0-9._-]+@[a-z0-9.-]+\\.[a-z]+' THEN 'An email address' END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, link) VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL, offers_selling boolean NOT NULL DEFAULT true, paused boolean NOT NULL DEFAULT false,
  hidden_at timestamptz, is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz);
-- What slice 1b reads (prod-shaped columns only for what it reads).
SET check_function_bodies = off;
ALTER TABLE public.shops ADD COLUMN daily_order_cap smallint, ADD COLUMN cancel_policy text NOT NULL DEFAULT 'until_24h_before_ready';
CREATE TABLE public.shop_item_subtypes (slug text PRIMARY KEY, kind text NOT NULL, tax_kind text);
INSERT INTO public.shop_item_subtypes VALUES ('cakes', 'home_food', NULL), ('crafts', 'made', NULL), ('lessons', 'service', NULL),
  ('item_repair', 'service', 'item_repair'), ('equipment_rental', 'rental', NULL);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, subtype text, at_buyer boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_hours (shop_id uuid, weekday smallint);
CREATE TABLE public.shop_cottage_confirmations (owner_id uuid, limit_year int);
CREATE FUNCTION public.shop_cottage_year() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 2026 $$;
CREATE TABLE public.cottage_full (owner_id uuid PRIMARY KEY);
CREATE FUNCTION public.shop_cottage_cap_reached(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.cottage_full WHERE owner_id = p) $$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $$;
CREATE FUNCTION public.shop_day_count(p_owner uuid, p_day date, p_statuses text[]) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT count(*)::int FROM public.shop_orders o WHERE o.seller_id = p_owner AND o.ready_date = p_day AND o.status = ANY (p_statuses) $$;
CREATE FUNCTION public.declutter_buyer_fee_cents(p int) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT round(p * 0.05)::int + 70 $$;
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, closed_at timestamptz, ready_date date NOT NULL,
  cancel_policy text, note text, items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0,
  total_cents int NOT NULL, stripe_checkout_session_id text, is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents));
CREATE TABLE public.shop_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.shop_items(id) ON DELETE SET NULL, variant_id uuid, variant_label text, title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental')),
  tax_kind text CHECK (tax_kind IS NULL OR (kind = 'service' AND tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations'))),
  unit_cents int NOT NULL CHECK (unit_cents BETWEEN 100 AND 500000), quantity smallint NOT NULL, line_cents int NOT NULL,
  at_buyer boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.shop_visible_to(p_shop uuid, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop AND (s.hidden_at IS NULL OR s.owner_id = p_uid)) $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
// The seller statements listing needs, as main has them (newest body).
await db.exec(cutFn("20261105235833_shops_every_category_sells.sql", "shop_item_required_statements"));
const NEED = {
  crafts: ["made_by_me", "new_not_used", "not_for_children", "not_skin_product", "not_banned"],
  cakes: ["made_in_my_home_kitchen", "low_risk_no_meat_fish", "label_says_home_kitchen", "kitchen_rules", "no_cbd_or_alcohol", "sales_tax_registered", "not_banned"],
  lessons: ["i_do_this_work", "licensed_if_needed", "not_banned"],
  item_repair: ["i_do_this_work", "licensed_if_needed", "not_banned"],
};
const arr = (xs) => (xs === null ? "NULL" : `ARRAY[${xs.map((x) => `'${x}'`).join(", ")}]::text[]`);
// The tax answer trigger as main has it (the --before state slice 1b restates).
await db.exec(cutFn("20261105235833_shops_every_category_sells.sql", "shop_order_line_snapshot_tax_kind"));
await db.exec(`CREATE TRIGGER shop_order_lines_snapshot_tax_kind BEFORE INSERT ON public.shop_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.shop_order_line_snapshot_tax_kind();`);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
const skipOrder = skip || process.env.CUSTOM_ORDER_MIGRATION === "skip";
if (!skipOrder) for (let i = 0; i < 3; i++) await db.exec(ORDER_MIGRATION);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const member = (uid, sql) => as("authenticated", uid, sql);
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

const everyone = [BUYER, OTHER, OWNER, OWNER2, BANNED, STRUCK, MINOR, BLOCKED, SEED];
await db.exec(`
  INSERT INTO auth.users (id) VALUES ${[...everyone, OUTSIDER].map((u) => `('${u}')`).join(", ")};
  INSERT INTO public.test_accounts (user_id) VALUES ${everyone.map((u) => `('${u}')`).join(", ")};
  INSERT INTO public.profiles (user_id, is_seed) VALUES ${everyone.map((u) => `('${u}', ${u === SEED})`).join(", ")};
  INSERT INTO public.banned VALUES ('${BANNED}');
  INSERT INTO public.struck VALUES ('${STRUCK}');
  INSERT INTO public.minors VALUES ('${MINOR}');
  INSERT INTO public.blocks VALUES ('${BLOCKED}', '${OWNER}');
  INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${OWNER}', 'Bayou Bakes'), ('${SHOP2}', '${OWNER2}', 'Teche Crafts');`);

const today = one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date)::text`));
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const setMode = (uid, mode) => member(uid, `SELECT public.shops_set_custom_orders(${mode === null ? "NULL" : `'${mode}'`}) AS r`);
const send = (uid, shop, text, by = null) => member(uid,
  `SELECT public.shops_send_custom_request('${shop}', ${text === null ? "NULL" : `'${text.replace(/'/g, "''")}'`}, ${by ? `'${by}'` : "NULL"}) AS r`);
const quote = (uid, req, cents, note = null, subtype = "crafts", statements = NEED[subtype] ?? []) => member(uid, skipOrder
  ? `SELECT public.shops_quote_custom_request('${req}', ${cents === null ? "NULL" : cents}, ${note === null ? "NULL" : `'${note}'`}) AS r`
  : `SELECT public.shops_quote_custom_request('${req}', ${cents === null ? "NULL" : cents}, ${note === null ? "NULL" : `'${note}'`}, ${subtype === null ? "NULL" : `'${subtype}'`}, ${arr(statements)}) AS r`);
const decline = (uid, req) => member(uid, `SELECT public.shops_decline_custom_request('${req}') AS r`);
const mine = async (uid) => { const r = one(await member(uid, `SELECT public.shops_my_custom_requests() AS r`)); return Array.isArray(r) ? r : []; };
const reqRow = async (r) => (await svc(`SELECT * FROM public.shop_custom_requests WHERE id = '${r}'`))[0] ?? {};
const notices = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

// --- 1. the shop's setting
ok(one(await svc(`SELECT custom_orders FROM public.shops WHERE id = '${SHOP}'`)) === "off", "custom orders start off for every shop");
ok(refused(await send(BUYER, SHOP, "A wedding cake"), /custom_orders_off/), "a shop with custom orders off takes no request");
ok(one(await setMode(OWNER, "deposit_50")) === "deposit_50", "the owner picks the 50% deposit");
ok(one(await svc(`SELECT custom_orders FROM public.shops WHERE id = '${SHOP}'`)) === "deposit_50", "the shop row holds the choice");
ok(refused(await setMode(OWNER, "half"), /invalid_custom_orders/) && refused(await setMode(OWNER, null), /invalid_custom_orders/),
  "only off, full payment held, or 50% deposit");
ok(refused(await setMode(OUTSIDER, "full_hold"), /feature_disabled/), "an account outside the Shops switch cannot set it");
ok(refused(await setMode(BANNED, "full_hold"), /account_restricted/), "a banned account cannot set it");
ok(refused(await setMode(BUYER, "full_hold"), /shop_not_found/), "an account with no shop cannot set it");
ok(refused(await svc(`UPDATE public.shops SET custom_orders = 'sometimes' WHERE id = '${SHOP}'`), /shops_custom_orders_mode/),
  "the table refuses any other value");
await setMode(OWNER2, "full_hold");

// --- 2. the buyer asks
const r1 = one(await send(BUYER, SHOP, "A three-tier wedding cake, lemon, for 80 people.", plus(30)));
ok(typeof r1 === "string", `a buyer sends a request (${JSON.stringify(r1)})`);
let row = await reqRow(r1);
ok(row.status === "requested" && row.payment_plan === "deposit_50" && row.buyer_id === BUYER && row.is_seed === false,
  `the request is open, carries the shop's plan, and is not seed (${JSON.stringify(row)})`);
ok(await notices(OWNER, "New custom order request") === 1, "the shop is told");
// The plan is frozen: the shop changing its setting does not change what was asked.
await setMode(OWNER, "full_hold");
ok((await reqRow(r1)).payment_plan === "deposit_50", "a later change of the setting leaves a sent request's plan alone");
await setMode(OWNER, "deposit_50");
ok(refused(await send(OWNER, SHOP, "My own cake"), /own_shop/), "an owner cannot ask their own shop");
ok(refused(await send(OUTSIDER, SHOP, "Cake"), /feature_disabled/), "an account outside the Shops switch cannot ask");
ok(refused(await send(BANNED, SHOP, "Cake"), /account_restricted/), "a banned account cannot ask");
ok(refused(await send(STRUCK, SHOP, "Cake"), /shop_strikes_blocked/), "an account with 3 Shops strikes cannot ask");
ok(refused(await send(MINOR, SHOP, "Cake"), /under_18/), "an under-18 account cannot ask");
ok(refused(await send(BLOCKED, SHOP, "Cake"), /shop_not_found/, "PT404"), "a blocked buyer sees the shop as not found");
ok(refused(await send(BUYER, id(999), "Cake"), /shop_not_found/, "PT404"), "an unknown shop is not found");
ok(refused(await send(BUYER, SHOP, "   "), /invalid_description/) && refused(await send(BUYER, SHOP, "x".repeat(1001)), /invalid_description/),
  "the description is 1 to 1,000 characters");
ok(refused(await send(BUYER, SHOP, "Call me at 337-555-1212"), /phone number/, "23514"), "a phone number in the request is refused");
ok(refused(await send(BUYER, SHOP, "Cake", today), /invalid_wanted_date/) && refused(await send(BUYER, SHOP, "Cake", plus(181)), /invalid_wanted_date/),
  "the wanted-by date is tomorrow to 6 months out");
await svc(`UPDATE public.shops SET paused = true WHERE id = '${SHOP}'`);
ok(refused(await send(OTHER, SHOP, "Cake"), /shop_paused/), "a paused shop takes no request");
await svc(`UPDATE public.shops SET paused = false, hidden_at = now() WHERE id = '${SHOP}'`);
ok(refused(await send(OTHER, SHOP, "Cake"), /shop_not_found/, "PT404"), "a hidden shop is not found");
await svc(`UPDATE public.shops SET hidden_at = NULL WHERE id = '${SHOP}'`);
await svc(`INSERT INTO public.sell_blocked VALUES ('${OWNER}')`);
ok(refused(await send(OTHER, SHOP, "Cake"), /custom_orders_off/), "a shop that cannot sell (no payouts) takes no request");
await svc(`DELETE FROM public.sell_blocked`);
// Limits: 3 open per shop, then 10 a day.
await send(BUYER, SHOP, "Cupcakes");
await send(BUYER, SHOP, "Cookies");
ok(refused(await send(BUYER, SHOP, "Pie"), /too_many_custom_requests/, "54000"), "a 4th open request to one shop is refused");
for (let i = 0; i < 7; i++) await send(BUYER, SHOP2, `Gift ${i}`).then(async (r) => { if (i >= 2 && Array.isArray(r)) await decline(BUYER, one(r)); });
const mineNow = await mine(BUYER);
ok(Array.isArray(mineNow) && mineNow.length === 10, `ten requests sent today (${Array.isArray(mineNow) ? mineNow.length : JSON.stringify(mineNow)})`);
ok(refused(await send(BUYER, id(92), "One more"), /too_many_custom_requests/, "54000"), "an 11th request in a day is refused");

// --- 3. the shop answers with a price
ok(refused(await quote(OWNER2, r1, 5000), /request_not_found/, "PT404"), "another shop's owner cannot quote it");
ok(refused(await quote(BUYER, r1, 5000), /request_not_found/, "PT404"), "the buyer cannot quote their own request");
ok(refused(await quote(OWNER, r1, 50), /invalid_price/) && refused(await quote(OWNER, r1, 500001), /invalid_price/) && refused(await quote(OWNER, r1, null), /invalid_price/),
  "a price is $1 to $5,000");
ok(refused(await quote(OWNER, r1, 25000, "email me at a@b.com"), /email/, "23514"), "an email in the quote note is refused");
const q = one(await quote(OWNER, r1, 25000, "Includes delivery stand."));
row = await reqRow(r1);
ok(q?.status === "quoted" && row.status === "quoted" && row.quote_cents === 25000 && row.quote_note === "Includes delivery stand.",
  `the owner quotes $250 with a note (${JSON.stringify(q)})`);
ok(row.expires_at instanceof Date && row.expires_at.getTime() - row.quoted_at.getTime() === 7 * 86400000, "the quote stands 7 days");
ok(await notices(BUYER, "Your custom order has a price") === 1, "the buyer is told the price");
ok(refused(await quote(OWNER, r1, 26000), /request_not_open/), "a request is quoted once");
await db.exec(`INSERT INTO public.blocks VALUES ('${OTHER}', '${OWNER2}')`);

// --- 4. decline, withdraw, expire
const r2 = (await mine(BUYER)).find((x) => x.shop_id === SHOP && x.status === "requested")?.id ?? id(998);
ok(refused(await decline(OWNER2, r2), /request_not_found/, "PT404") && refused(await decline(OTHER, r2), /request_not_found/, "PT404"),
  "only the buyer and the shop's owner can close a request");
ok(one(await decline(OWNER, r2)) === "declined" && (await reqRow(r2)).closed_at instanceof Date, "the shop declines an open request");
ok(await notices(BUYER, "Custom order declined") === 1, "the buyer is told it was declined");
ok(refused(await decline(BUYER, r2), /request_not_open/), "a closed request cannot be closed again");
ok(refused(await quote(OWNER, r2, 1000), /request_not_open/), "a declined request cannot be quoted");
const r3 = (await mine(BUYER)).find((x) => x.shop_id === SHOP && x.status === "requested")?.id ?? id(998);
ok(one(await decline(BUYER, r3)) === "withdrawn" && await notices(OWNER, "Custom order request withdrawn") === 1,
  "the buyer withdraws theirs and the shop is told");
// A quote past 7 days: no longer closable, and listed (and stored) as expired.
await svc(`UPDATE public.shop_custom_requests SET quoted_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = '${r1}'`);
ok(refused(await decline(BUYER, r1), /request_not_open/), "an expired quote cannot be declined");
const listed = (await mine(OWNER)).find((x) => x.id === r1);
ok(listed?.status === "expired" && (await reqRow(r1)).status === "expired", `a quote past its 7 days reads and is stored as expired (${JSON.stringify(listed)})`);
ok(refused(await svc(`UPDATE public.shop_custom_requests SET status = 'requested' WHERE id = '${r1}'`), /quote_shape/),
  "the table refuses a request that is open yet carries a price");

// --- 5. who reads what
const ownerList = await mine(OWNER);
ok(ownerList.length > 0 && ownerList.every((x) => x.shop_id === SHOP && x.role === "shop"), "the owner lists only their own shop's requests");
const buyerList = await mine(BUYER);
ok(buyerList.length > 0 && buyerList.every((x) => x.role === "buyer") && buyerList.some((x) => x.shop_id === SHOP2), "the buyer lists their own, across shops");
ok((await mine(OTHER)).length === 0 && Array.isArray(one(await member(OTHER, `SELECT public.shops_my_custom_requests() AS r`))), "another member lists none");
ok(refused(await member(OUTSIDER, `SELECT public.shops_my_custom_requests()`), /feature_disabled/), "the list is behind the Shops switch");
ok(refused(await member(BUYER, `SELECT * FROM public.shop_custom_requests`), /permission denied/), "members cannot read the table directly");
ok(refused(await member(BUYER, `INSERT INTO public.shop_custom_requests (shop_id, buyer_id, description, payment_plan) VALUES ('${SHOP}', '${BUYER}', 'x', 'full_hold')`), /permission denied/),
  "members cannot write the table directly");
ok(refused(await as("anon", null, `SELECT public.shops_send_custom_request('${SHOP}', 'x', NULL)`), /permission denied/), "anon cannot ask");
ok(refused(await as("anon", null, `SELECT public.shops_my_custom_requests()`), /permission denied/), "anon cannot list");
ok(refused(await member(BUYER, `SELECT public.shop_custom_requests_seed_from_parties()`), /permission denied|trigger/), "members cannot call the seed trigger function");

// --- 7. slice 1b: the price names what is made, and the shop must still take custom orders
await svc(`INSERT INTO public.shop_hours SELECT '${SHOP}', d FROM generate_series(0, 6) d`);
const fresh = async (text) => one(await send(OTHER, SHOP, text));
await svc(`DELETE FROM public.blocks WHERE a = '${OTHER}'`);
await setMode(OWNER, "full_hold");
const c1 = await fresh("A birthday cake");
ok(refused(await quote(OWNER, c1, 4000, null, null), /invalid_subtype/) && refused(await quote(OWNER, c1, 4000, null, "equipment_rental"), /invalid_subtype/),
  "a price names what is made, never a rental");
ok(refused(await quote(OWNER, c1, 4000, null, "cakes"), /cottage_confirmation_required/), "a home-food price needs this year's cottage confirmation");
// Lead decision 11-06: the same seller statements as listing that kind.
ok(refused(await quote(OWNER, c1, 4000, null, "cakes", NEED.crafts), /attestation_incomplete/),
  "a home-food price with the craft statements is refused");
ok(refused(await quote(OWNER, c1, 4000, null, "cakes", NEED.cakes.slice(1)), /attestation_incomplete/),
  "a home-food price missing one cottage-food statement is refused");
ok(refused(await quote(OWNER, c1, 4000, null, "cakes", null), /attestation_incomplete/), "a price with no statements is refused");
ok(refused(await quote(OWNER, c1, 4000, null, "cakes", [...NEED.cakes, "made_up"]), /attestation_incomplete/), "an extra statement is refused");
await svc(`INSERT INTO public.shop_cottage_confirmations VALUES ('${OWNER}', 2026)`);
await svc(`INSERT INTO public.cottage_full VALUES ('${OWNER}')`);
ok(refused(await quote(OWNER, c1, 4000, null, "cakes"), /cottage_cap_reached/), "a home kitchen at its yearly limit cannot price home food");
await svc(`DELETE FROM public.cottage_full`);
await setMode(OWNER, "off");
ok(refused(await quote(OWNER, c1, 4000, null, "cakes"), /custom_orders_off/), "a shop that turned custom orders off cannot send a price");
await setMode(OWNER, "full_hold");
await svc(`UPDATE public.shops SET paused = true WHERE id = '${SHOP}'`);
ok(refused(await quote(OWNER, c1, 4000, null, "cakes"), /custom_orders_off/), "a paused shop cannot send a price");
await svc(`UPDATE public.shops SET paused = false WHERE id = '${SHOP}'`);
ok(one(await quote(OWNER, c1, 4000, null, "cakes"))?.subtype === "cakes" && (await reqRow(c1)).subtype === "cakes", "the price is stored with what is made");
const st = await reqRow(c1);
ok(JSON.stringify(st.statements) === JSON.stringify([...NEED.cakes].sort()) && st.statements_at instanceof Date,
  `the shop's cottage-food statements are stored with the price (${JSON.stringify(st.statements)})`);

// --- 8. the buyer takes the price: one order, one line
const take = (uid, req, day, note = null, shop = SHOP) => member(uid,
  `SELECT public.shops_order_custom_quote('${req}', '${shop}', ${day ? `'${day}'` : "NULL"}, ${note === null ? "NULL" : `'${note}'`}) AS r`);
ok(refused(await take(BUYER, c1, plus(3)), /request_not_found/, "PT404") && refused(await take(OWNER, c1, plus(3)), /request_not_found/, "PT404"),
  "only the buyer who asked can take the price");
ok(refused(await take(OTHER, c1, plus(3), null, SHOP2), /request_not_found/, "PT404"), "the price is taken only for its own shop (the tax address and terms read that shop)");
ok(refused(await take(OTHER, c1, today), /ready_date_too_soon/) && refused(await take(OTHER, c1, plus(91)), /ready_date_too_far/),
  "the ready date is tomorrow to 90 days out");
await svc(`DELETE FROM public.shop_hours WHERE shop_id = '${SHOP}' AND weekday = extract(dow FROM '${plus(4)}'::date)`);
ok(refused(await take(OTHER, c1, plus(4)), /shop_closed_that_day/), "the ready date is a day the shop fills orders");
ok(refused(await take(OTHER, c1, plus(3), "text 337-555-1212"), /phone number/), "a phone number in the note is refused");
const t1 = one(await take(OTHER, c1, plus(3), "No nuts please"));
ok(typeof t1?.order_id === "string" && t1.items_cents === 4000 && t1.premium_cents === 270, `the price becomes an order: $40 + the buyer fee (${JSON.stringify(t1)})`);
const ord = (await svc(`SELECT * FROM public.shop_orders WHERE id = '${t1?.order_id}'`))[0] ?? {};
ok(ord.status === "awaiting_hold" && ord.seller_id === OWNER && ord.total_cents === 4270 && ord.tax_cents === 0 && ord.note === "No nuts please",
  `the order waits for the card hold, total = price + fee, tax set later (${JSON.stringify(ord)})`);
const lines = await svc(`SELECT * FROM public.shop_order_lines WHERE order_id = '${t1?.order_id}'`);
ok(Array.isArray(lines) && lines.length === 1 && lines[0].item_id === null && lines[0].custom_request_id === c1 && lines[0].kind === "home_food"
  && lines[0].unit_cents === 4000 && lines[0].quantity === 1 && lines[0].line_cents === 4000 && /^Custom order: A birthday cake/.test(lines[0].title),
  `one line at the price, of the kind the shop named, tied to the request (${JSON.stringify(lines)})`);
ok((await reqRow(c1)).order_id === t1?.order_id && (await reqRow(c1)).status === "quoted", "the request points at its order and stays open until the hold");
// Asking again before paying replaces the unpaid page.
const t2 = one(await take(OTHER, c1, plus(3)));
ok((await svc(`SELECT status FROM public.shop_orders WHERE id = '${t1?.order_id}'`))[0]?.status === "superseded" && typeof t2?.order_id === "string",
  "taking the price again before paying retires the unpaid order");
// The hold is placed: the request is accepted, and cannot be taken again.
await svc(`UPDATE public.shop_orders SET status = 'held' WHERE id = '${t2?.order_id}'`);
const acc = await reqRow(c1);
ok(acc.status === "accepted" && acc.order_id === t2?.order_id, `the card hold marks the request accepted (${JSON.stringify(acc)})`);
ok(refused(await take(OTHER, c1, plus(3)), /quote_not_open/), "an accepted price cannot be ordered again");
ok(refused(await decline(OWNER, c1), /request_not_open/), "an accepted request cannot be declined");
// A service price keeps its tax answer on the line; a plain one carries none.
const c2 = await fresh("Fix my grandfather clock");
await quote(OWNER, c2, 15000, null, "item_repair");
const t3 = one(await take(OTHER, c2, plus(5)));
ok((await svc(`SELECT kind, tax_kind FROM public.shop_order_lines WHERE order_id = '${t3?.order_id}'`))[0]?.tax_kind === "item_repair",
  "a custom repair line carries the taxed-service answer");
const c3 = await fresh("Guitar lessons");
await quote(OWNER, c3, 6000, null, "lessons");
const t4 = one(await take(OTHER, c3, plus(5)));
const l4 = (await svc(`SELECT kind, tax_kind FROM public.shop_order_lines WHERE order_id = '${t4?.order_id}'`))[0] ?? {};
ok(l4.kind === "service" && l4.tax_kind === null, `an untaxed service line carries no answer (${JSON.stringify(l4)})`);
// Restack on l106 (H8, 20261106164313): the restated trigger keeps the at_buyer line; a custom line has no item, so false.
ok((await svc(`SELECT bool_or(at_buyer) AS a FROM public.shop_order_lines WHERE order_id IN ('${t3?.order_id}', '${t4?.order_id}')`))[0]?.a === false,
  "a custom line is never marked at the buyer's place");
ok(/NEW\.at_buyer := COALESCE\(NEW\.tax_kind = 'fabric_cleaning'/.test((await svc(`SELECT prosrc FROM pg_proc WHERE proname = 'shop_order_line_snapshot_tax_kind'`))[0]?.prosrc ?? ""),
  "the restated tax-kind trigger keeps H8's at_buyer rule");
await svc(`UPDATE public.shop_orders SET status = 'held' WHERE id IN ('${t3?.order_id}', '${t4?.order_id}')`);
// A price whose stored statements do not match its kind is never ordered.
const c8 = await fresh("A doll");
await quote(OWNER, c8, 3000, null, "crafts");
await svc(`UPDATE public.shop_custom_requests SET statements = ARRAY['not_banned'] WHERE id = '${c8}'`);
ok(refused(await take(OTHER, c8, plus(5)), /quote_not_open/), "a price without its full statements cannot be ordered");
await decline(OTHER, c8);
// A price past its 7 days cannot be taken.
const c4 = await fresh("A quilt");
await quote(OWNER, c4, 9000, null, "crafts");
await svc(`UPDATE public.shop_custom_requests SET quoted_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = '${c4}'`);
ok(refused(await take(OTHER, c4, plus(5)), /quote_not_open/), "an expired price cannot be taken");

// --- 9. the deposit plan waits for slice 2, and the buyer's gates hold
await setMode(OWNER, "deposit_50");
const c5 = await fresh("A cake stand");
await quote(OWNER, c5, 5000, null, "crafts");
ok(refused(await take(OTHER, c5, plus(5)), /deposit_not_ready/), "a deposit price is never charged in full before slice 2");
await setMode(OWNER, "full_hold");
const c6 = await fresh("Napkins");
await quote(OWNER, c6, 2000, null, "crafts");
await svc(`INSERT INTO public.banned VALUES ('${OTHER}')`);
ok(refused(await take(OTHER, c6, plus(5)), /account_restricted/), "a banned buyer cannot take a price");
await svc(`DELETE FROM public.banned WHERE user_id = '${OTHER}'`);
await svc(`INSERT INTO public.blocks VALUES ('${OTHER}', '${OWNER}')`);
ok(refused(await take(OTHER, c6, plus(5)), /shop_not_found/, "PT404"), "a blocked pair cannot order");
const before = one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${OTHER}' AND title = 'Custom order declined'`));
ok(one(await decline(OWNER, c6)) === "declined"
  && one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${OTHER}' AND title = 'Custom order declined'`)) === before,
  "a blocked pair closes the request without a notice");
await svc(`DELETE FROM public.blocks WHERE a = '${OTHER}'`);
const c7 = await fresh("Table runner");
await quote(OWNER, c7, 2500, null, "crafts");
await svc(`UPDATE public.shops SET paused = true WHERE id = '${SHOP}'`);
ok(refused(await take(OTHER, c7, plus(5)), /shop_paused/), "a paused shop takes no order on a sent price");
await svc(`UPDATE public.shops SET paused = false WHERE id = '${SHOP}'`);
ok(refused(await as("anon", null, `SELECT public.shops_order_custom_quote('${c6}', '${SHOP}', '${plus(5)}', NULL)`), /permission denied/), "anon cannot order");
ok(refused(await member(OTHER, `SELECT public.shop_orders_custom_request_accepted()`), /permission denied|trigger/), "members cannot call the accept trigger function");

// --- 6. seed data and account deletion
const rs = one(await send(SEED, SHOP, "Test cake"));
ok((await reqRow(rs)).is_seed === true, "a request from a test account is seed data");
await svc(`UPDATE public.shops SET is_seed = true WHERE id = '${SHOP2}'`);
await svc(`DELETE FROM public.blocks WHERE a = '${OTHER}'`);
const rs2 = one(await send(OTHER, SHOP2, "A gift basket"));
ok((await reqRow(rs2)).is_seed === true, "a request to a test shop is seed data");
await svc(`DELETE FROM auth.users WHERE id = '${BUYER}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.shop_custom_requests WHERE buyer_id = '${BUYER}'`)) === 0, "deleting the buyer purges their requests");
await svc(`DELETE FROM public.shops WHERE id = '${SHOP2}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.shop_custom_requests WHERE shop_id = '${SHOP2}'`)) === 0, "deleting the shop purges its requests");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : skipOrder ? " (CUSTOM_ORDER_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
