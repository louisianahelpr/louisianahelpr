#!/usr/bin/env node
/**
 * PGlite proof for 20261105163501_declutter_item_views (owner request 11-05: "add a way for me to see how many people
 * saw each item"; Builder 2, 2026-11-05).
 *
 *   node src/test/pglite/declutterItemViews.pglite.mjs            # migration applied 3x; every check must PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterItemViews.pglite.mjs   # RED: the migration absent, checks FAIL
 *
 * Stubs (not under test): auth.uid() from request.jwt.claim.sub; has_role reads public.user_roles;
 * feature_enabled_for(key) is true unless the caller is in public.switch_off; declutter_items carries only the
 * columns the functions read. is_test_member and declutter_open_to_guests are their NEWEST definitions from
 * supabase/migrations (newestDefinition, any dollar tag).
 *
 *   V1  a member's view counts once, however often they open the item
 *   V2  two guest devices count two; the same device again does not add
 *   V3  the seller's own view, an admin's, a test account's (test_accounts) and a seed profile's never count
 *   V4  a draft, a test listing (is_seed) and a hidden seller's listing never count
 *   V5  a member Declutter is off for, and a guest while Declutter is not open to guests, never count
 *   V6  the seller reads their own counts; another member reads none of them
 *   V7  a viewer who became a test account after viewing drops out of the count
 *   V8  anon and authenticated hold no grant on the table; anon cannot call the count; no PUBLIC EXECUTE
 *   V9  a guest call with no device id records nothing and raises nothing
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { newestDefinition } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = "20261105163501_declutter_item_views.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), BUYER2 = U(3), ADMIN = U(4), TESTER = U(5), SEEDY = U(6), OFF = U(7), LATER_TEST = U(8);
const LIVE = U(101), SEED_ITEM = U(102), DRAFT = U(103), HIDDEN = U(104), OTHER_LIVE = U(105);
const DEV1 = U(201), DEV2 = U(202);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
-- prod's default ACL: every new function is EXECUTE for anon and authenticated, so a REVOKE that forgets one shows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
CREATE TABLE public.switch_off (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.switch_off WHERE user_id = auth.uid()) $$;
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid NOT NULL, status text NOT NULL,
  is_seed boolean NOT NULL DEFAULT false, seller_hidden boolean NOT NULL DEFAULT false
);
`);
await db.exec(newestDefinition("is_test_member").stmt);
await db.exec(newestDefinition("declutter_open_to_guests").stmt);
await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${SELLER}','${BUYER}','${BUYER2}','${ADMIN}','${TESTER}','${SEEDY}','${OFF}','${LATER_TEST}']::uuid[]);
INSERT INTO public.profiles (user_id, is_seed) SELECT id, id = '${SEEDY}' FROM auth.users;
INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.switch_off VALUES ('${OFF}');
INSERT INTO public.feature_switches VALUES ('declutter', 'everyone');
INSERT INTO public.declutter_items (id, seller_id, status, is_seed, seller_hidden) VALUES
  ('${LIVE}', '${SELLER}', 'live', false, false),
  ('${SEED_ITEM}', '${SELLER}', 'live', true, false),
  ('${DRAFT}', '${SELLER}', 'draft', false, false),
  ('${HIDDEN}', '${SELLER}', 'reserved', false, true),
  ('${OTHER_LIVE}', '${BUYER2}', 'live', false, false);
`);
if (!skip) {
  const sql = readFileSync(MIG_DIR + FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const view = (uid, item, dev = null) =>
  as(uid ? "authenticated" : "anon", uid, `SELECT public.declutter_record_item_view('${item}'::uuid, ${dev ? `'${dev}'::uuid` : "NULL"})`);
const counts = async (uid) => {
  const r = await as("authenticated", uid, `SELECT item_id, views FROM public.declutter_my_item_view_counts()`);
  return Array.isArray(r) ? new Map(r.map((x) => [x.item_id, x.views])) : r;
};
const rows = async (item) => {
  try { return Number((await db.query(`SELECT count(*)::int AS n FROM public.declutter_item_views WHERE item_id = '${item}'`)).rows[0].n); }
  catch { return -1; }
};

// V1
await view(BUYER, LIVE); await view(BUYER, LIVE); await view(BUYER, LIVE, DEV1);
ok((await rows(LIVE)) === 1, "V1 a member's repeated views of one item count once");
// V2
await view(null, LIVE, DEV1); await view(null, LIVE, DEV2); await view(null, LIVE, DEV1);
ok((await rows(LIVE)) === 3, "V2 two guest devices add two; the same device again adds nothing");
// V3
await view(SELLER, LIVE); await view(ADMIN, LIVE); await view(TESTER, LIVE); await view(SEEDY, LIVE);
ok((await rows(LIVE)) === 3, "V3 the seller, an admin, a test account and a seed profile never count");
// V4
for (const it of [SEED_ITEM, DRAFT, HIDDEN]) { await view(BUYER, it); await view(null, it, DEV1); }
ok((await rows(SEED_ITEM)) === 0 && (await rows(DRAFT)) === 0 && (await rows(HIDDEN)) === 0,
  "V4 a test listing, a draft and a hidden seller's listing never count");
// V5
await view(OFF, LIVE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
await view(null, LIVE, U(203));
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'declutter'`);
ok((await rows(LIVE)) === 3, "V5 a member Declutter is off for, and a guest while it is closed to guests, never count");
// V6
const mine = await counts(SELLER);
ok(mine instanceof Map && mine.get(LIVE) === 3 && !mine.has(OTHER_LIVE), `V6 the seller reads 3 views on their item (${JSON.stringify(mine instanceof Map ? [...mine] : mine)})`);
await view(BUYER, OTHER_LIVE);
const theirs = await counts(BUYER);
ok(theirs instanceof Map && theirs.size === 0, "V6 another member reads none of the seller's counts");
// V7
await view(LATER_TEST, LIVE);
const before = (await counts(SELLER)).get?.(LIVE);
await db.exec(`INSERT INTO public.test_accounts VALUES ('${LATER_TEST}')`);
const after = (await counts(SELLER)).get?.(LIVE);
ok(before === 4 && after === 3, `V7 a viewer who became a test account drops out (${before} -> ${after})`);
// V8
const anonTable = await as("anon", null, `SELECT count(*) FROM public.declutter_item_views`);
const authTable = await as("authenticated", BUYER, `SELECT count(*) FROM public.declutter_item_views`);
const authWrite = await as("authenticated", BUYER, `INSERT INTO public.declutter_item_views (item_id, viewer_id) VALUES ('${LIVE}', '${BUYER2}')`);
ok(!Array.isArray(anonTable) && !Array.isArray(authTable) && !Array.isArray(authWrite), "V8 anon and authenticated can neither read nor write the table");
const anonCount = await as("anon", null, `SELECT * FROM public.declutter_my_item_view_counts()`);
ok(!Array.isArray(anonCount) && /permission denied/.test(anonCount.error), "V8 anon cannot call the count");
const acl = await db.query(`SELECT proname, proacl::text AS a FROM pg_proc WHERE proname IN ('declutter_record_item_view', 'declutter_my_item_view_counts')`);
ok(acl.rows.length === 2 && acl.rows.every((r) => !/(^|[{,])=X/.test(r.a)), `V8 no PUBLIC EXECUTE (${acl.rows.map((r) => `${r.proname}:${r.a}`).join(" ")})`);
// V9
const noDevice = await view(null, OTHER_LIVE, null);
ok(Array.isArray(noDevice) && (await rows(OTHER_LIVE)) === 1, "V9 a guest call without a device id records nothing and raises nothing");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
