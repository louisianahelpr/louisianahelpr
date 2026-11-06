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
CREATE FUNCTION public.shop_visible_to(p_shop uuid, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop AND (s.hidden_at IS NULL OR s.owner_id = p_uid)) $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

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
const quote = (uid, req, cents, note = null) => member(uid,
  `SELECT public.shops_quote_custom_request('${req}', ${cents === null ? "NULL" : cents}, ${note === null ? "NULL" : `'${note}'`}) AS r`);
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

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
