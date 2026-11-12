#!/usr/bin/env node
/**
 * PGlite proof for 20261112194629_shops_owner_review_notices.sql (Shops audit 11-12 S007, S008, S048).
 *   S007 shops_admin_pending_items says which rows are test (item, shop or owner), so the owner's card drops them.
 *   S008 shops_admin_review_item tells the seller on approve and on reject (with the note and the 30-day line).
 *   S048 shops_report_not_received never alerts an admin about a test order (explicit skip).
 *
 *   node src/test/pglite/shopsOwnerReviewNotices.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsOwnerReviewNotices.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                                     # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; require_feature no-op;
 * is_caller_banned false; is_test_subject reads a test_people table; shop_owner_sell_block_reason NULL;
 * shop_cottage_cap_reached false; contact_leak_reason NULL; shop_order_is_service false; declutter_notify records.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112194629_shops_owner_review_notices.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0e-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), ADMIN = U(2), TESTSELLER = U(3), BUYER = U(4), TESTBUYER = U(5);
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
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE storage.objects (bucket_id text, name text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, name text, is_seed boolean NOT NULL DEFAULT false, hidden_at timestamptz, offers_selling boolean DEFAULT true);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, owner_id uuid, kind text DEFAULT 'craft', subtype text DEFAULT 'x',
  title text, description text DEFAULT 'd', price_cents integer DEFAULT 1000, status text, submitted_at timestamptz DEFAULT now(),
  admin_approved_at timestamptz, live_at timestamptz, updated_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_item_private (item_id uuid, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text,
  review_note text, admin_rejected_at timestamptz, updated_at timestamptz);
CREATE TABLE public.shop_item_photos (item_id uuid, storage_path text, position integer);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, ready_date date, fulfillment text NOT NULL DEFAULT 'pickup', is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, problem_at timestamptz, problem_note text, problem_photo_path text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.test_people (id uuid);
CREATE TABLE public.notices (user_id uuid, ty text, title text, message text, link text);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_people t WHERE t.id = u) $f$;
CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r::text) $f$;
CREATE FUNCTION public.shop_owner_sell_block_reason(uuid) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_cottage_cap_reached(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_order_is_service(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $f$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (u, ty, ti, m, l) $f$;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.test_people VALUES ('${TESTSELLER}'), ('${TESTBUYER}');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);
if (skip) {
  await db.exec(fnFrom("20261030015205_test_data_never_counts.sql", "shops_admin_pending_items"));
  await db.exec(fnFrom("20261104175521_q2390_last_member_not_found_is_404.sql", "shops_admin_review_item"));
  await db.exec(fnFrom("20261112090512_shops_problem_photo.sql", "shops_report_not_received"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const as = async (uid, sql) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec(`RESET ROLE; SET test.uid = '';`); }
};
const S_REAL = U(10), S_TESTSHOP = U(11), S_TESTOWNER = U(12);
await db.exec(`INSERT INTO public.shops (id, name, is_seed) VALUES ('${S_REAL}', 'Real', false), ('${S_TESTSHOP}', 'Seed shop', true), ('${S_TESTOWNER}', 'Test owner', false);`);
const item = async (shop, owner, title, seed = false) =>
  (await q(`INSERT INTO public.shop_items (shop_id, owner_id, title, status, is_seed) VALUES ($1, $2, $3, 'pending_review', $4) RETURNING id, submitted_at::text AS s`, [shop, owner, title, seed]))[0];
const iReal = await item(S_REAL, SELLER, "Fig jam");
const iSeedItem = await item(S_REAL, SELLER, "Seed item", true);
const iSeedShop = await item(S_TESTSHOP, SELLER, "In seed shop");
const iTestOwner = await item(S_TESTOWNER, TESTSELLER, "Test owner item");
for (const i of [iReal, iSeedItem, iSeedShop, iTestOwner]) await q(`INSERT INTO public.shop_item_private (item_id) VALUES ($1)`, [i.id]);

// S007
const pend = await as(ADMIN, `SELECT item_id, is_seed FROM public.shops_admin_pending_items()`);
const flag = (id) => pend.rows?.find((r) => r.item_id === id)?.is_seed;
check(!pend.err && pend.rows.length === 4, "the pending list still returns every item (a test admin's run sees its own)", pend.err ?? String(pend.rows?.length));
check(flag(iReal.id) === false, "a real item is not test");
check(flag(iSeedItem.id) === true, "an is_seed item is test");
check(flag(iSeedShop.id) === true, "an item in an is_seed shop is test");
check(flag(iTestOwner.id) === true, "a test account's item is test");
check(!!(await as(SELLER, `SELECT * FROM public.shops_admin_pending_items()`)).err, "a member still cannot read the queue");

// S008
const review = (id, approve, note, sub) => as(ADMIN, `SELECT public.shops_admin_review_item('${id}', ${approve}, ${note === null ? "NULL" : `'${note}'`}, '${sub}') AS r`);
let r = await review(iReal.id, true, null, iReal.s);
check(r.rows?.[0]?.r === "live", "approve still returns live", r.err ?? "");
let n = await q(`SELECT * FROM public.notices WHERE user_id = $1 ORDER BY title`, [SELLER]);
check(n.length === 1 && n[0].title === "Your item is live" && n[0].message === '"Fig jam" is live on your shop. Buyers can order it now.' && n[0].link === "/shops/mine",
  "approve tells the seller the item is live", JSON.stringify(n));
r = await review(iSeedItem.id, false, "Blurry photo.", iSeedItem.s);
check(r.rows?.[0]?.r === "rejected", "reject still returns rejected", r.err ?? "");
n = await q(`SELECT * FROM public.notices WHERE user_id = $1 AND title = 'Your item wasn''t approved'`, [SELLER]);
check(n.length === 1 && n[0].message === 'We didn\'t approve "Seed item". Why: Blurry photo. For the next 30 days, your new items get a quick check before they show.' && n[0].ty === "warning",
  "reject tells the seller why, with the 30-day line (one period)", JSON.stringify(n));
const count = async () => (await q(`SELECT count(*)::int AS c FROM public.notices`))[0].c;
const before = await count();
r = await review(iSeedShop.id, false, null, iSeedShop.s);
check(!!r.err && (await count()) === before, "a refused review (no note) sends nothing");
r = await review(iSeedShop.id, true, null, "2001-01-01 00:00:00+00");
check(!!r.err && (await count()) === before, "a stale review (item changed) sends nothing");
check(!!(await as(SELLER, `SELECT public.shops_admin_review_item('${iSeedShop.id}', true, NULL, '${iSeedShop.s}')`)).err, "a member still cannot review");

// S048
const order = async (buyer, seller, seed = false) =>
  (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date, is_seed) VALUES ($1, $2, 'accepted', now(), current_date - 1, $3) RETURNING id`, [buyer, seller, seed]))[0].id;
const report = (uid, o) => as(uid, `SELECT public.shops_report_not_received('${o}', 'Box was empty', NULL) AS r`);
const adminAlerts = async () => (await q(`SELECT count(*)::int AS c FROM public.notices WHERE user_id = $1 AND title = 'Shops pickup problem reported'`, [ADMIN]))[0].c;
let a0 = await adminAlerts();
r = await report(BUYER, await order(BUYER, SELLER));
check(!r.err && (await adminAlerts()) === a0 + 1, "a real pickup problem still alerts the admin", r.err ?? "");
a0 = await adminAlerts();
r = await report(BUYER, await order(BUYER, SELLER, true));
check(!r.err && (await adminAlerts()) === a0, "an is_seed order never alerts the admin", r.err ?? "");
r = await report(TESTBUYER, await order(TESTBUYER, SELLER));
check(!r.err && (await adminAlerts()) === a0, "a test buyer's report never alerts the admin", r.err ?? "");
r = await report(BUYER, await order(BUYER, TESTSELLER));
check(!r.err && (await adminAlerts()) === a0, "a test shop's order never alerts the admin", r.err ?? "");
const sellerNote = (await q(`SELECT count(*)::int AS c FROM public.notices WHERE user_id = $1 AND title = 'Pickup problem reported'`, [TESTSELLER]))[0].c;
check(sellerNote === 1, "the shop is still told about a test order's problem");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
