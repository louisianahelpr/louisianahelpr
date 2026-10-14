#!/usr/bin/env node
/**
 * PGlite proof for 20261014193955_declutter_foundation (Declutter slice 1,
 * docs/specs/declutter-auctions.md).
 *
 *   node src/test/pglite/declutterFoundation.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFoundation.pglite.mjs     # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterFoundation.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL (anon/authenticated
 * EXECUTE on every new function, so a REVOKE that forgets anon is caught),
 * auth.users/auth.uid(), storage.objects (bucket_id, name, owner, owner_id:
 * the live columns, read 2026-10-14), profiles (the gate columns, live types),
 * user_roles/has_role, test_accounts, admin_audit_log, user_blocks. The five helpers
 * the migration calls (is_caller_banned, member_under_18,
 * helper_award_block_reason, contact_leak_reason, are_users_blocked) are NOT re-typed: their
 * NEWEST definitions are read out of supabase/migrations. Then
 * 20261012031120_hidden_feature_switches.sql, then the migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}20261014193955_declutter_foundation.sql`,
  "utf8",
);
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261014193955")).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SELLER = U(1), BUYER = U(2), ORDINARY = U(3), MINOR = U(4), BANNED = U(5), STRUCK = U(6), NOPAYOUT = U(7), ADMIN = U(8);

const db = new PGlite();
await db.exec(SCHEMA);
for (const name of ["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason", "are_users_blocked"]) {
  await db.exec(newestDefinition(name).stmt);
}
// Their live ACLs (only the client-visible ones matter to an invoker).
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;`);
await db.exec(SWITCHES);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 8) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status) VALUES
    ('${SELLER}',   'acct_s', true,  '1990-01-01', 'active'),
    ('${BUYER}',    'acct_b', true,  '1991-01-01', 'active'),
    ('${ORDINARY}', 'acct_o', true,  '1992-01-01', 'active'),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active'),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned'),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active'),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active'),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
  INSERT INTO public.test_accounts (user_id) VALUES ('${SELLER}'), ('${BUYER}'), ('${MINOR}'), ('${BANNED}'), ('${STRUCK}'), ('${NOPAYOUT}');`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

/** Run `sql` as `role` with auth.uid() = uid. Returns rows or { error, code }. */
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
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

const createSql = (title = "Oak rocking chair", floor = 2000, price = 4000) =>
  `SELECT public.declutter_create_item('${title}', 'Solid oak, a little worn.', 'furniture', 4, 'large', ${price}, ${floor},
     'Mid-City, Baton Rouge', '1234 Example St, Baton Rouge, LA 70806', 30.451234, -91.154321) AS id`;

// --- the switch
const sw = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter'`);
ok(Array.isArray(sw) && sw[0]?.audience === "off", "switch 'declutter' is created OFF");
ok(refused(await as("authenticated", SELLER, createSql()), /feature_disabled/, "42501"),
  "switch off: even a test account is refused (feature_disabled 42501)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
await db.exec(skip ? "SELECT 1" : MIGRATION); // a replay never resets the audience an admin chose
const sw2 = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter'`);
ok(Array.isArray(sw2) && sw2[0]?.audience === "testers", "a replay keeps the audience an admin chose");
ok(refused(await as("authenticated", ORDINARY, createSql()), /feature_disabled/, "42501"),
  "testers: an ordinary account is refused at the server (feature_disabled)");
ok(refused(await as("anon", null, createSql()), /permission denied/), "anon cannot execute declutter_create_item");

// --- create (draft) and the public/private split
const itemA = one(await as("authenticated", SELLER, createSql()));
ok(typeof itemA === "string", "a tester seller creates a draft");
const cols = await svc(`SELECT string_agg(column_name, ',') AS c FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'declutter_items'`);
const colList = one(cols) ?? "";
ok(colList.includes("price_cents") && !/floor|address|pickup/.test(colList),
  "declutter_items (the buyer-readable row) has no floor or address column");
const rowA = await svc(`SELECT status, sale_mode, area_lat::text, area_lng::text FROM public.declutter_items WHERE id = '${itemA}'`);
ok(Array.isArray(rowA) && rowA[0]?.status === "draft" && rowA[0]?.sale_mode === "offers", "created as an 'offers' draft");
ok(Array.isArray(rowA) && rowA[0]?.area_lat === "30.45" && rowA[0]?.area_lng === "-91.15",
  "public coordinates are coarse (2 decimals) while the private ones are exact");
ok(refused(await as("authenticated", SELLER, createSql("Lamp", 5000, 4000)), /invalid_floor_price/),
  "a floor above the price is refused");
ok(refused(await as("authenticated", SELLER, createSql("Call me at 225 555 1234")), /Phone number detected/, "23514"),
  "a phone number in the title is refused (contact-leak filter)");

// --- privacy: floor + exact address
for (const [who, uid] of [["seller", SELLER], ["tester buyer", BUYER], ["ordinary", ORDINARY]]) {
  ok(refused(await as("authenticated", uid, `SELECT * FROM public.declutter_item_private`), /permission denied/),
    `${who} cannot select declutter_item_private directly`);
}
ok(refused(await as("anon", null, `SELECT * FROM public.declutter_item_private`), /permission denied/), "anon cannot select declutter_item_private");
const priv = await as("authenticated", SELLER, `SELECT * FROM public.declutter_seller_item_private('${itemA}')`);
ok(Array.isArray(priv) && priv[0]?.floor_price_cents === 2000 && /Example St/.test(priv[0]?.pickup_address),
  "the seller reads their own floor + address through declutter_seller_item_private");
ok(refused(await as("authenticated", BUYER, `SELECT * FROM public.declutter_seller_item_private('${itemA}')`), /item_not_found/, "P0002"),
  "a buyer asking for the seller's private half gets item_not_found");
ok(refused(await as("authenticated", BUYER, `SELECT * FROM public.declutter_item_address('${itemA}')`), /item_not_found/, "P0002"),
  "a buyer asking for the exact address gets item_not_found (hook: seller only today)");
const addr = await as("authenticated", SELLER, `SELECT * FROM public.declutter_item_address('${itemA}')`);
ok(Array.isArray(addr) && /Example St/.test(addr[0]?.pickup_address) && !("floor_price_cents" in (addr[0] ?? {})),
  "declutter_item_address gives the seller the address and never the floor");
ok(refused(await as("anon", null, `SELECT * FROM public.declutter_item_address('${itemA}')`), /permission denied/),
  "anon cannot execute declutter_item_address");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_address_access('${itemA}', '${BUYER}')`), /permission denied/),
  "the address hook itself is not client-callable");
ok(one(await svc(`SELECT public.declutter_address_access('${itemA}', NULL)`)) === null,
  "the address hook gives NULL (no access) for a NULL user");

// --- publish gates
const noPayItem = one(await as("authenticated", NOPAYOUT, createSql("Bookshelf")));
ok(typeof noPayItem === "string", "a seller without payout setup may still start a draft");
ok(refused(await as("authenticated", NOPAYOUT, `SELECT public.declutter_publish_item('${noPayItem}')`), /payout_setup_incomplete/, "42501"),
  "publish without payout setup: payout_setup_incomplete (row 23)");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`), /photos_required/),
  "publish with 0 photos: photos_required");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_publish_item('${itemA}')`), /item_not_found/, "P0002"),
  "someone else cannot publish the seller's draft");

const path = (uid, item, n) => `${uid}/declutter/${item}/p${n}.jpg`;
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_add_item_photo('${itemA}', '${path(SELLER, itemA, 0)}')`), /photo_not_uploaded/),
  "a photo row needs the uploaded object");
await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('job-photos', '${path(BUYER, itemA, 9)}', '${BUYER}')`);
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_add_item_photo('${itemA}', '${path(BUYER, itemA, 9)}')`), /photo_not_uploaded/),
  "a photo in someone else's folder is refused");
const upload = async (uid, item, n, mime = "image/jpeg") => {
  await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('job-photos', '${path(uid, item, n)}', '${uid}', '{"mimetype": "${mime}", "size": 120000}')`);
  return as("authenticated", uid, `SELECT public.declutter_add_item_photo('${item}', '${path(uid, item, n)}') AS id`);
};
ok(refused(await upload(SELLER, itemA, 7, "video/quicktime"), /photo_not_uploaded/),
  "a video in the seller's folder is refused (images only: a video keeps its GPS)");
await upload(SELLER, itemA, 0);
await upload(SELLER, itemA, 1);
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`), /photos_required/),
  "publish with 2 photos: photos_required (row 31: at least 3)");
const third = await upload(SELLER, itemA, 2);
ok(typeof one(third) === "string", "the third photo attaches");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`), /attestation_required/),
  "publish without the tax confirmations: attestation_required (row 54)");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_attest_item('${itemA}', true, true, false, true)`), /attestation_incomplete/),
  "three of four confirmations: attestation_incomplete");
ok(Array.isArray(await as("authenticated", SELLER, `SELECT public.declutter_attest_item('${itemA}', true, true, true, true)`)),
  "all four confirmations are stored");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`), /pickup_windows_required/),
  "publish without pickup times: pickup_windows_required (row 52)");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_set_pickup_windows('[{"weekday":1,"starts":"18:00","ends":"17:00"}]')`), /invalid_pickup_windows/),
  "a pickup time that ends before it starts is refused");
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_set_pickup_windows('[{"weekday":1,"starts":"17:00","ends":"19:00"},{"weekday":6,"starts":"09:00","ends":"12:00"}]')`)) === 2,
  "two pickup times saved");
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`)) === "pending_review",
  "a new seller's listing goes to pending_review (row 33)");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemA}')`), /item_not_a_draft/),
  "a published item cannot be published again");

// The 12-photo cap.
const itemB = one(await as("authenticated", SELLER, createSql("Box of books")));
for (let n = 0; n < 12; n++) await upload(SELLER, itemB, n);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_item_photos WHERE item_id = '${itemB}'`)) === 12, "12 photos attach");
ok(refused(await upload(SELLER, itemB, 12), /too_many_photos/), "the 13th photo is refused (row 31: up to 12)");

// Row 33: after 3 admin-approved listings, a listing goes live at once.
await svc(`UPDATE public.declutter_items SET admin_approved_at = now() WHERE seller_id = '${SELLER}'`);
await svc(`INSERT INTO public.declutter_items (seller_id, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, status, admin_approved_at)
           VALUES ('${SELLER}', 'Old approved one', 'misc', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15, 'completed', now())`);
const itemC = one(await as("authenticated", SELLER, createSql("Floor lamp", 1500, 3000)));
for (let n = 0; n < 3; n++) await upload(SELLER, itemC, n);
await as("authenticated", SELLER, `SELECT public.declutter_attest_item('${itemC}', true, true, true, true)`);
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemC}')`)) === "live",
  "a seller with 3 admin-approved listings goes live at once");

// Bidding is not available (row 55).
const itemD = one(await as("authenticated", SELLER, createSql("Desk")));
for (let n = 0; n < 3; n++) await upload(SELLER, itemD, n);
await as("authenticated", SELLER, `SELECT public.declutter_attest_item('${itemD}', true, true, true, true)`);
await svc(`UPDATE public.declutter_items SET sale_mode = 'auction' WHERE id = '${itemD}'`);
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${itemD}')`), /sale_mode_unavailable/),
  "an 'auction' item cannot be published (row 55: offers only)");

// --- member gates
ok(refused(await as("authenticated", MINOR, createSql()), /under_18/, "42501"), "an under-18 member cannot sell (row 53)");
ok(refused(await as("authenticated", BANNED, createSql()), /account_restricted/, "42501"), "a banned member is refused");
await svc(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason) VALUES
             ('${STRUCK}', 'buyer', 'missed_checkout'), ('${STRUCK}', 'buyer', 'not_picked_up'), ('${STRUCK}', 'seller', 'seller_no_show')`);
ok(refused(await as("authenticated", STRUCK, createSql()), /declutter_strikes_blocked/, "42501"),
  "3 active strikes (buyer + seller in ONE count) block selling (rows 16/17)");
ok(refused(await as("authenticated", STRUCK, `SELECT public.declutter_set_watch('${itemC}', true)`), /declutter_strikes_blocked/),
  "3 active strikes block the buyer side too");
await svc(`UPDATE public.declutter_strikes SET given_at = now() - interval '13 months', expires_at = now() + interval '5 years'
            WHERE user_id = '${STRUCK}' AND reason = 'missed_checkout'`);
const exp = await svc(`SELECT (expires_at = given_at + interval '1 year') AS ok FROM public.declutter_strikes WHERE user_id = '${STRUCK}' AND reason = 'missed_checkout'`);
ok(Array.isArray(exp) && exp[0]?.ok === true, "expires_at is always given_at + 1 year, whatever the writer sent");
ok(one(await svc(`SELECT public.declutter_active_strike_count('${STRUCK}')`)) === 2, "a strike given 13 months ago no longer counts");
ok(typeof one(await as("authenticated", STRUCK, createSql("Mirror"))) === "string", "with 2 active strikes the member may sell again");
ok(refused(await as("authenticated", STRUCK, `SELECT public.declutter_active_strike_count('${STRUCK}')`), /permission denied/),
  "the strike counter is not client-callable");

// --- reads: live items, RLS
const buyerSees = await as("authenticated", BUYER, `SELECT id, status FROM public.declutter_items`);
ok(Array.isArray(buyerSees) && buyerSees.some((r) => r.id === itemC) && !buyerSees.some((r) => r.id === itemA || r.id === itemB),
  "a tester buyer reads live items only (not drafts, not pending_review)");
const buyerJson = await as("authenticated", BUYER, `SELECT to_jsonb(i) AS j FROM public.declutter_items i WHERE id = '${itemC}'`);
ok(Array.isArray(buyerJson) && buyerJson.length === 1 && !/floor|address|1234 Example|30\.4512/.test(JSON.stringify(buyerJson[0].j)),
  "the whole live row a buyer reads holds neither the floor nor the address");
ok(Array.isArray(await as("authenticated", ORDINARY, `SELECT 1 FROM public.declutter_items`)) &&
   (await as("authenticated", ORDINARY, `SELECT 1 FROM public.declutter_items`)).length === 0,
  "an ordinary account (switch not on for it) reads no listing");
ok(refused(await as("anon", null, `SELECT 1 FROM public.declutter_items`), /permission denied/), "anon reads no listing (no grant)");
const buyerPhotos = await as("authenticated", BUYER, `SELECT item_id FROM public.declutter_item_photos`);
ok(Array.isArray(buyerPhotos) && buyerPhotos.length === 3 && buyerPhotos.every((r) => r.item_id === itemC),
  "a buyer reads the photos of live items only");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok(Array.isArray(await as("authenticated", BUYER, `SELECT 1 FROM public.declutter_items`)) &&
   (await as("authenticated", BUYER, `SELECT 1 FROM public.declutter_items`)).length === 0,
  "switch off: a tester buyer reads no listing either");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);

// --- watchlist + Q&A
ok(one(await as("authenticated", BUYER, `SELECT public.declutter_set_watch('${itemC}', true)`)) === "watching", "a buyer watches a live item");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_set_watch('${itemC}', true)`), /own_item/), "a seller cannot watch their own item");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_set_watch('${itemA}', true)`), /item_not_found/), "a pending_review item cannot be watched");
ok(refused(await as("authenticated", ORDINARY, `SELECT public.declutter_set_watch('${itemC}', true)`), /feature_disabled/), "an ordinary account cannot watch");
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${NOPAYOUT}')`);
ok(refused(await as("authenticated", NOPAYOUT, `SELECT public.declutter_ask_question('${itemC}', 'Still there?')`), /item_not_found/, "P0002"),
  "a member the seller blocked cannot ask on the seller's item");
ok(refused(await as("authenticated", NOPAYOUT, `SELECT public.declutter_set_watch('${itemC}', true)`), /item_not_found/, "P0002"),
  "a member the seller blocked cannot watch the seller's item");
await svc(`DELETE FROM public.user_blocks`);
ok(refused(await as("authenticated", MINOR, `SELECT public.declutter_answer_question(gen_random_uuid(), 'Yes')`), /under_18/),
  "answering (a seller's act) is refused for an under-18 member");
const q = one(await as("authenticated", BUYER, `SELECT public.declutter_ask_question('${itemC}', 'Does the switch work?')`));
ok(typeof q === "string", "a buyer asks a public question");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_ask_question('${itemC}', 'text me at 225-555-1234')`), /Phone number detected/, "23514"),
  "a phone number in a question is refused (row 35)");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_answer_question('${q}', 'Yes, venmo me')`), /Off-platform payment/, "23514"),
  "an off-platform payment answer is refused");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_answer_question('${q}', 'Yes')`), /question_not_found/), "only the seller answers");
ok(Array.isArray(await as("authenticated", SELLER, `SELECT public.declutter_answer_question('${q}', 'Yes, works fine.')`)), "the seller answers");
const asStr = await as("authenticated", NOPAYOUT, `SELECT answer FROM public.declutter_questions WHERE id = '${q}'`);
ok(Array.isArray(asStr) && asStr[0]?.answer === "Yes, works fine.", "another tester reads the public Q&A");

// --- grants
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'declutter%' OR p.proname = 'reject_contact_leak_in_declutter')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon can EXECUTE no Declutter function");
const authInternal = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('declutter_active_strike_count', 'declutter_address_access', 'declutter_assert_member', 'declutter_strike_expiry', 'reject_contact_leak_in_declutter')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
ok(Array.isArray(authInternal) && one(authInternal) === null && !skip, "authenticated can EXECUTE none of the internal helpers");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'declutter%' AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null && !skip, "no client role can write any Declutter table (RPCs only)");
const hidden = await svc(`SELECT string_agg(c.relname || ':' || r.rolname, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('declutter_item_private', 'declutter_seller_flags')
    AND has_table_privilege(r.rolname, c.oid, 'SELECT')`);
ok(Array.isArray(hidden) && one(hidden) === null && !skip, "no client role may SELECT declutter_item_private or declutter_seller_flags");
const rls = await svc(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace
  AND relname LIKE 'declutter%' AND relkind = 'r' AND NOT relrowsecurity`);
const tables = await svc(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'declutter%' AND relkind = 'r'`);
ok(one(tables) === 9 && one(rls) === 0, "9 Declutter tables, every one with RLS on");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
