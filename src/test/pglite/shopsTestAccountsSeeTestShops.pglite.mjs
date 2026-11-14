#!/usr/bin/env node
/**
 * PGlite proof for 20261114233422_shops_test_accounts_see_test_shops.sql: shop_visible_to lets an ENROLLED test
 * account (profiles.is_seed AND public.test_accounts, not a store review account) see a test (is_seed) shop while
 * the launch switch hides seed data, and changes nothing for anyone else.
 *
 *   node src/test/pglite/shopsTestAccountsSeeTestShops.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsTestAccountsSeeTestShops.pglite.mjs # RED: 20261017061155's body
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * REAL bodies (the newest CREATE in supabase/migrations, read verbatim): seed_jobs_hidden_publicly, seed_hidden_for,
 * feature_enabled_for_user, feature_enabled_for, shop_active_strike_count, shop_owner_in_good_standing,
 * shop_state_ok, shop_publicly_visible, and shop_visible_to itself.
 * Stubbed, and said so: tables cut to the columns read; has_role is "a user_roles row" (the real one also scopes to
 * the caller, which this proof does not exercise); app_role is a text domain.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS_NAME = "20261114233422_shops_test_accounts_see_test_shops.sql";
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + THIS_NAME;
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5eed5eed-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in the migrations BEFORE this one, verbatim. */
function newestDef(name) {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < THIS_NAME).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const t = readFileSync(MIG_DIR + files[i], "utf8");
    const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g");
    let s = -1;
    for (const m of t.matchAll(re)) s = m.index;
    if (s < 0) continue;
    const tag = t.slice(s).match(/\n\s*AS\s+(\$[A-Za-z_]*\$)/)[1];
    const open = t.indexOf(tag, s) + tag.length;
    const close = t.indexOf(tag, open);
    return { file: files[i], sql: t.slice(s, close + tag.length) + ";" };
  }
  throw new Error(`no definition of ${name}`);
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE DOMAIN public.app_role AS text;
CREATE TABLE public.platform_settings (feature_flags jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean, ban_status text, auto_suspended_until timestamptz);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.store_review_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
CREATE TABLE public.feature_switch_members (key text, user_id uuid);
CREATE TABLE public.shop_strikes (user_id uuid, removed_at timestamptz, expires_at timestamptz);
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, is_seed boolean NOT NULL DEFAULT false, hidden_at timestamptz);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = _role) $f$;
`);
const used = [];
for (const name of ["seed_jobs_hidden_publicly", "seed_hidden_for", "feature_enabled_for_user", "feature_enabled_for",
  "shop_active_strike_count", "shop_owner_in_good_standing", "shop_state_ok", "shop_publicly_visible", "shop_visible_to"]) {
  const d = newestDef(name);
  used.push(`${name}<-${d.file}`);
  await db.exec(d.sql);
}
console.log(`real bodies: ${used.join(", ")}`);
await db.exec(`REVOKE ALL ON FUNCTION public.shop_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role;`);

if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let i = 1; i <= 3; i++) await db.exec(mig); // replay-safe: applied 3x
  console.log(`applied ${THIS.split("/").pop()} 3x`);
}

// People.
const SELLER = U(1);       // enrolled test account (owns the test shop)
const BUYER = U(2);        // enrolled test account
const REAL = U(3);         // a real member with the shops switch (switch member)
const ADMIN = U(4);        // a real admin (the owner)
const HALF = U(5);         // is_seed but NOT enrolled
const REVIEWER = U(6);     // enrolled test account that is a store review account
const REAL_OWNER = U(7);   // a real member's shop
const NO_SWITCH = U(8);    // enrolled test account, but the switch is set off (tested by flipping audience)
await db.exec(`
INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
INSERT INTO public.feature_switches VALUES ('shops', 'testers');
INSERT INTO public.profiles (user_id, is_seed) VALUES
  ('${SELLER}', true), ('${BUYER}', true), ('${REAL}', false), ('${ADMIN}', false), ('${HALF}', true),
  ('${REVIEWER}', true), ('${REAL_OWNER}', false), ('${NO_SWITCH}', true);
INSERT INTO public.test_accounts VALUES ('${SELLER}'), ('${BUYER}'), ('${REVIEWER}'), ('${NO_SWITCH}');
INSERT INTO public.store_review_accounts VALUES ('${REVIEWER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.feature_switch_members VALUES ('shops', '${REAL}'), ('shops', '${HALF}');
INSERT INTO public.shops (id, owner_id, is_seed) VALUES ('${U(101)}', '${SELLER}', true), ('${U(102)}', '${REAL_OWNER}', false);
`);
const TEST_SHOP = U(101);
const REAL_SHOP = U(102);

async function sees(shop, viewer) {
  // As the viewer (auth.uid() = viewer), the way the definer RPCs call it: shop_visible_to(p_shop_id, v_uid).
  await db.exec(viewer ? `SELECT set_config('request.jwt.claim.sub', '${viewer}', false)` : `SELECT set_config('request.jwt.claim.sub', '', false)`);
  const r = await db.query(`SELECT public.shop_visible_to($1::uuid, $2::uuid) AS v`, [shop, viewer]);
  return r.rows[0].v;
}

// The fix.
check(await sees(TEST_SHOP, BUYER) === true, "an enrolled test buyer sees the test shop while seed data is hidden (RED before)");
// Unchanged for everyone else.
check(await sees(TEST_SHOP, SELLER) === true, "the owner sees their own test shop");
check(await sees(TEST_SHOP, REAL) === false, "a real member with the switch does NOT see the test shop");
check(await sees(TEST_SHOP, ADMIN) === false, "a real admin (the owner) does NOT see the test shop");
check(await sees(TEST_SHOP, HALF) === false, "an is_seed account with no enrolment does NOT see the test shop");
check(await sees(TEST_SHOP, REVIEWER) === false, "a store review account (enrolled) does NOT see the test shop");
check(await sees(TEST_SHOP, null) === false, "a NULL viewer does NOT see the test shop");
check(await sees(REAL_SHOP, REAL) === true, "a real member still sees a real shop");
check(await sees(REAL_SHOP, BUYER) === true, "a test buyer still sees a real shop");
check(await sees(U(999), BUYER) === false, "no such shop -> false");

// Every other part of the public rule still holds for the test viewer.
await db.exec(`UPDATE public.shops SET hidden_at = now() WHERE id = '${TEST_SHOP}'`);
check(await sees(TEST_SHOP, BUYER) === false, "Q1957: an admin-hidden test shop is hidden from the test buyer");
await db.exec(`UPDATE public.shops SET hidden_at = NULL WHERE id = '${TEST_SHOP}'`);
check(await sees(TEST_SHOP, BUYER) === true, "Q1957: unhidden, the test buyer sees it again");
await db.exec(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${SELLER}'`);
check(await sees(TEST_SHOP, BUYER) === false, "a banned owner's test shop is hidden from the test buyer");
await db.exec(`UPDATE public.profiles SET ban_status = NULL WHERE user_id = '${SELLER}'`);
await db.exec(`INSERT INTO public.shop_strikes SELECT '${SELLER}', NULL, now() + interval '30 days' FROM generate_series(1, 3)`);
check(await sees(TEST_SHOP, BUYER) === false, "an owner with 3 Shops strikes: hidden from the test buyer");
await db.exec(`DELETE FROM public.shop_strikes`);
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'shops'`);
check(await sees(TEST_SHOP, NO_SWITCH) === false, "the shops switch off: the test buyer sees nothing");
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);

// Launch switch off: everyone who could see seed rows before still can (no change).
await db.exec(`UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": false}'`);
check(await sees(TEST_SHOP, REAL) === true, "launch switch off: a real member with the switch sees the test shop, as before");
check(await sees(TEST_SHOP, BUYER) === true, "launch switch off: the test buyer sees it");
await db.exec(`UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": true}'`);

// Grants unchanged: service_role only.
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.shop_visible_to(uuid,uuid)', 'EXECUTE') a,
  has_function_privilege('anon', 'public.shop_visible_to(uuid,uuid)', 'EXECUTE') n,
  has_function_privilege('service_role', 'public.shop_visible_to(uuid,uuid)', 'EXECUTE') s`)).rows[0];
check(acl.a === false && acl.n === false && acl.s === true, "shop_visible_to stays service_role only", JSON.stringify(acl));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
