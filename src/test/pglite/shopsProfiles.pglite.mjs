#!/usr/bin/env node
/**
 * PGlite proof for 20261015123029_shops_profiles (Shops slice 1: free shop /
 * business profiles; owner decisions docs/specs/local-shops-prep.md L1-L92).
 *
 *   node src/test/pglite/shopsProfiles.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsProfiles.pglite.mjs     # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsProfiles.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs as in declutterFoundation.pglite.mjs (roles + prod's
 * default function ACL, auth.users/auth.uid(), storage.objects, profiles,
 * user_roles/has_role, test_accounts, admin_audit_log, user_blocks) plus
 * helper_credentials, reviews and platform_settings (the live columns the
 * migration reads). The helpers the migration calls are NOT re-typed: their
 * NEWEST definitions are read out of supabase/migrations (is_caller_banned,
 * member_under_18, helper_award_block_reason, contact_leak_reason,
 * are_users_blocked, identity_is_verified, seed_jobs_hidden_publicly,
 * declutter_area_label_problem), and 20261012031120 (switches) and
 * 20261014193955 (Declutter strikes, L45's shared count) run first.
 * seed_review_hidden is stubbed false (it reads jobs and the per-caller seed
 * rule; this proof does not test review hiding). The migration runs 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}20261015123029_shops_profiles.sql`,
  "utf8",
);
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261015123029")).sort()) {
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
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON storage.objects TO authenticated;
CREATE POLICY "public bucket read (prod: job-photos is public)" ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
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
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT true, background_check_status text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credential_type text NOT NULL, status text NOT NULL DEFAULT 'pending', expiration_date date, license_number text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, status text NOT NULL DEFAULT 'published', feedback_visible_at timestamptz);
-- The one star rating (get_public_profile_stats, newest definition loaded
-- below) reads these: job reviews join their job, Declutter reviews their order.
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text NOT NULL,
  date_needed date, start_time time, helper_arrived_at timestamptz, revision_count integer DEFAULT 0, is_group_job boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, handed_over_at timestamptz);
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reviewer_id uuid,
  reviewee_id uuid, reviewer_side text NOT NULL, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now());
INSERT INTO public.platform_settings (feature_flags) VALUES ('{}'::jsonb);
CREATE FUNCTION public.seed_review_hidden(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), FAN = U(2), ORDINARY = U(3), MINOR = U(4), BANNED = U(5), STRUCK = U(6), NOPAYOUT = U(7), ADMIN = U(8), SEEDY = U(9);

const db = new PGlite();
await db.exec(SCHEMA);
for (const name of ["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason",
  "are_users_blocked", "identity_is_verified", "seed_jobs_hidden_publicly"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.seed_jobs_hidden_publicly() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.seed_jobs_hidden_publicly() TO anon, authenticated, service_role;`);
await db.exec(SWITCHES);
await db.exec(DECLUTTER);
await db.exec(newestDefinition("declutter_area_label_problem").stmt);
await db.exec(newestDefinition("get_public_profile_stats").stmt);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 9) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status, idv_status, is_seed) VALUES
    ('${OWNER}',    'acct_s', true,  '1990-01-01', 'active', 'verified', false),
    ('${FAN}',      'acct_b', true,  '1991-01-01', 'active', NULL, false),
    ('${ORDINARY}', 'acct_o', true,  '1992-01-01', 'active', NULL, false),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active', NULL, false),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned', NULL, false),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active', NULL, false),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active', NULL, false),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active', NULL, false),
    ('${SEEDY}',    'acct_e', true,  '1990-01-01', 'active', NULL, true);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
  INSERT INTO public.test_accounts (user_id) VALUES ('${OWNER}'), ('${FAN}'), ('${MINOR}'), ('${BANNED}'), ('${STRUCK}'), ('${NOPAYOUT}'), ('${ADMIN}'), ('${SEEDY}');
  INSERT INTO public.declutter_strikes (user_id, offender_side, reason, expires_at)
    SELECT '${STRUCK}', 'seller', 'seller_no_show', now() + interval '1 year' FROM generate_series(1, 3);
  INSERT INTO public.helper_credentials (user_id, credential_type, status) VALUES
    ('${OWNER}', 'trade_license', 'verified'), ('${OWNER}', 'insurance', 'pending');
  INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES
    ('00000000-0000-0000-0000-0000000000a1', '${FAN}', '${OWNER}', 'completed'),
    ('00000000-0000-0000-0000-0000000000a2', '${ORDINARY}', '${OWNER}', 'completed'),
    ('00000000-0000-0000-0000-0000000000a3', '${ORDINARY}', '${OWNER}', 'cancelled');
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating, feedback_visible_at) VALUES
    ('00000000-0000-0000-0000-0000000000a1', '${FAN}', '${OWNER}', 5, now() - interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a2', '${ORDINARY}', '${OWNER}', 4, now() - interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a2', '${ORDINARY}', '${OWNER}', 1, now() + interval '5 days'),
    ('00000000-0000-0000-0000-0000000000a3', '${ORDINARY}', '${OWNER}', 1, now() - interval '1 day');
  INSERT INTO public.declutter_orders (id, status, handed_over_at) VALUES
    ('00000000-0000-0000-0000-0000000000b1', 'handed_over', now() - interval '20 days');
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, reviewer_side, stars) VALUES
    ('00000000-0000-0000-0000-0000000000b1', '${FAN}', '${OWNER}', 'buyer', 3);
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES
    ('job-photos', '${OWNER}/shops/logo1.jpg', '${OWNER}', '{"mimetype":"image/jpeg","size":"1000"}'),
    ('job-photos', '${OWNER}/shops/logo2.jpg', '${OWNER}', '{"mimetype":"image/jpeg","size":"1000"}'),
    ('job-photos', '${OWNER}/shops/clip.mp4',  '${OWNER}', '{"mimetype":"video/mp4","size":"1000"}'),
    ('job-photos', '${FAN}/shops/theirs.jpg',  '${FAN}',   '{"mimetype":"image/jpeg","size":"1000"}');`);

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

const saveSql = ({ name = "Bayou Bakes", about = "Kolaches and king cakes.", category = "bakery", area = "Broussard",
  storefront = false, lat = 30.147312, lng = -91.961234, selling = true, quotes = false, sos = "NULL" } = {}) =>
  `SELECT public.shops_save_my_shop('${name}', '${about}', '${category}', ARRAY['Lafayette','St. Martin'], '${area}',
     ${storefront}, ${lat}, ${lng}, ${selling}, ${quotes}, ${sos}) AS id`;

// --- the switch
const sw = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'shops'`);
ok(Array.isArray(sw) && sw[0]?.audience === "off", "switch 'shops' is created OFF");
ok(refused(await as("authenticated", OWNER, saveSql()), /feature_disabled/, "42501"),
  "switch off: even a test account is refused (feature_disabled 42501)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);
await db.exec(skip ? "SELECT 1" : MIGRATION);
const sw2 = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'shops'`);
ok(Array.isArray(sw2) && sw2[0]?.audience === "testers", "a replay keeps the audience an admin chose");
ok(refused(await as("authenticated", ORDINARY, saveSql()), /feature_disabled/, "42501"),
  "testers: an ordinary account is refused at the server (feature_disabled)");
ok(refused(await as("anon", null, saveSql()), /permission denied/), "anon cannot execute shops_save_my_shop");

// --- gates (L3, L45, L82, ban)
ok(refused(await as("authenticated", MINOR, saveSql()), /under_18/, "42501"), "under 18: refused (L82)");
ok(refused(await as("authenticated", BANNED, saveSql()), /account_restricted/, "42501"), "banned: refused");
ok(refused(await as("authenticated", STRUCK, saveSql()), /shop_strikes_blocked/, "42501"),
  "3 active marketplace strikes (shared with Declutter): refused (L45)");
ok(refused(await as("authenticated", NOPAYOUT, saveSql()), /payout_setup_incomplete/, "42501"),
  "no payout setup: refused (L3)");

// --- create, one per member, coarse pin, contact leak
const shopA = one(await as("authenticated", OWNER, saveSql()));
ok(typeof shopA === "string", "an eligible tester opens a shop");
const again = one(await as("authenticated", OWNER, saveSql({ name: "Bayou Bakes and More" })));
ok(typeof again === "string" && again === shopA, "saving again updates the same shop (one per member, L4/L83)");
const n = await svc(`SELECT count(*)::int AS n FROM public.shops WHERE owner_id = '${OWNER}'`);
ok(one(n) === 1, "still exactly one shop row for the member");
const pin = await svc(`SELECT pin_lat::text AS a, pin_lng::text AS b FROM public.shops WHERE id = '${shopA}'`);
ok(Array.isArray(pin) && pin[0]?.a === "30.15000" && pin[0]?.b === "-91.96000",
  "a home maker's pin is rounded to 2 decimals (L50: never their house)");
ok(refused(await svc(`UPDATE public.shops SET pin_lat = 30.14731 WHERE id = '${shopA}'`), /shops_home_pin_is_coarse/),
  "the table refuses a fine pin on a non-storefront shop, whoever writes it");
const store = one(await as("authenticated", OWNER, saveSql({ storefront: true })));
const pin2 = await svc(`SELECT pin_lat::text AS a FROM public.shops WHERE id = '${store}'`);
ok(Array.isArray(pin2) && pin2[0]?.a === "30.14731", "a storefront keeps its exact pin (L50)");
await as("authenticated", OWNER, saveSql());
ok(refused(await as("authenticated", OWNER, saveSql({ about: "Call 225 555 1234" })), /Phone number detected/, "23514"),
  "a phone number in the about is refused (L49, contact-leak filter)");
ok(refused(await as("authenticated", OWNER, saveSql({ name: "bayoubakes@gmail.com" })), /mail/i, "23514"),
  "an email in the name is refused (L49)");
ok(refused(await as("authenticated", OWNER, saveSql({ area: "1234 Example St" })), /area_looks_like_address/, "22023"),
  "a street address as the area is refused");
ok(refused(await as("authenticated", OWNER, saveSql({ category: "nope" })), /invalid_category/, "22023"),
  "a category off the fixed list is refused (L54)");
ok(refused(await as("authenticated", OWNER, saveSql({ selling: false, quotes: false })), /offers_required/, "22023"),
  "a shop offers selling, quotes, or both (L53)");
ok(refused(await as("authenticated", OWNER, saveSql({ lat: 40.7, lng: -74.0 })), /invalid_location/, "22023"),
  "a pin outside Louisiana is refused");
ok(refused(await as("authenticated", OWNER, saveSql({ sos: "'bad number!'" })), /invalid_sos_number/, "22023"),
  "a malformed Secretary of State number is refused");
const cats = await svc(`SELECT count(*)::int AS n FROM public.shop_categories`);
ok(one(cats) === 79, "the owner's starter category list is seeded (79 rows, L54)");

// --- no client role writes a shop table directly
for (const t of ["shops", "shop_photos", "shop_hours", "shop_follows", "shop_categories"]) {
  ok(refused(await as("authenticated", OWNER, `DELETE FROM public.${t}`), /permission denied/),
    `the owner cannot DELETE from ${t} directly (RPCs only)`);
}
ok(refused(await as("authenticated", OWNER, `UPDATE public.shops SET sos_verified_at = now()`), /permission denied/),
  "the owner cannot set their own Registered badge");
ok(refused(await as("anon", null, `SELECT * FROM public.shops`), /permission denied/), "anon cannot read shops");
ok(refused(await as("authenticated", FAN, `SELECT sos_number FROM public.shops`), /permission denied/),
  "no member reads sos_number by REST (column grants)");
ok(refused(await as("authenticated", OWNER, `SELECT hidden_by, hidden_reason, sos_verified_by FROM public.shops`), /permission denied/),
  "not even the owner reads who hid or checked the shop by REST");

// --- reads: switch-gated, hidden, seed
const fanSees = await as("authenticated", FAN, `SELECT id FROM public.shops`);
ok(Array.isArray(fanSees) && fanSees.some((r) => r.id === shopA), "a switched-on member reads the shop");
ok(one(await as("authenticated", ORDINARY, `SELECT public.shop_publicly_visible('${shopA}')`)) === false,
  "the visibility helper answers false to a member without the switch");
const ordSees = await as("authenticated", ORDINARY, `SELECT id FROM public.shops`);
ok(Array.isArray(ordSees) && ordSees.length === 0, "a member without the switch reads no shop by REST");

// --- hours
ok(one(await as("authenticated", OWNER, `SELECT public.shops_set_hours('[{"weekday":1,"opens":"08:00","closes":"17:00"},{"weekday":6,"opens":"09:00","closes":"12:00"}]')`)) === 2,
  "the owner sets two opening times");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_set_hours('[{"weekday":1,"opens":"17:00","closes":"08:00"}]')`), /invalid_hours/, "22023"),
  "closing before opening is refused");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_set_hours('[{"weekday":9,"opens":"08:00","closes":"09:00"}]')`), /invalid_hours/, "22023"),
  "a weekday off 0-6 is refused");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_hours`)) === 2, "a refused change leaves the old hours");
ok(refused(await as("authenticated", FAN, `SELECT public.shops_set_hours('[]')`), /shop_not_found/, "P0002"),
  "a member with no shop cannot set hours");

// --- photos
const logo1 = await as("authenticated", OWNER, `SELECT public.shops_attach_photo('logo', '${OWNER}/shops/logo1.jpg') AS r`);
ok(Array.isArray(logo1) && one(logo1)?.replaced_path === null, "the owner attaches a logo");
const logo2 = await as("authenticated", OWNER, `SELECT public.shops_attach_photo('logo', '${OWNER}/shops/logo2.jpg') AS r`);
ok(Array.isArray(logo2) && one(logo2)?.replaced_path === `${OWNER}/shops/logo1.jpg`, "a new logo replaces the old one and returns its path");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_attach_photo('gallery', '${FAN}/shops/theirs.jpg')`), /photo_not_uploaded/),
  "another member's photo cannot be attached");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_attach_photo('gallery', '${OWNER}/shops/clip.mp4')`), /photo_not_uploaded/),
  "a video cannot be attached (images only: video keeps GPS)");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_attach_photo('gallery', '${OWNER}/shops/missing.jpg')`), /photo_not_uploaded/),
  "a path with no uploaded object is refused");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_attach_photo('gallery', '${OWNER}/shops/logo2.jpg')`), /photo_already_attached/, "22023"),
  "a photo already attached is refused as bad input, not a raw unique error");
const delOld = await as("authenticated", OWNER, `DELETE FROM storage.objects WHERE name = '${OWNER}/shops/logo1.jpg' RETURNING name`);
ok(Array.isArray(delOld) && delOld.length === 1, "the owner deletes the detached old logo object (storage policy)");
const delLive = await as("authenticated", OWNER, `DELETE FROM storage.objects WHERE name = '${OWNER}/shops/logo2.jpg' RETURNING name`);
ok(Array.isArray(delLive) && delLive.length === 0 && Array.isArray(delOld) && delOld.length === 1, "an attached photo object cannot be deleted from under its row");
const delOther = await as("authenticated", FAN, `DELETE FROM storage.objects WHERE name = '${OWNER}/shops/clip.mp4' RETURNING name`);
ok(Array.isArray(delOther) && delOther.length === 0 && Array.isArray(delOld) && delOld.length === 1, "another member cannot delete the owner's shop objects");
await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('job-photos', '${OWNER}/shops/logo1.jpg', '${OWNER}', '{"mimetype":"image/jpeg","size":"1000"}')`);

// --- page, badges, rating, follows
const page = one(await as("authenticated", FAN, `SELECT public.shops_get_shop('${shopA}') AS p`));
ok(page?.badges?.id_checked === true && page?.badges?.licensed === true && page?.badges?.insured === false
   && page?.badges?.registered === false && page?.badges?.permit === false,
  "badges: ID checked + Licensed (verified credential); Insured not (pending); Registered and Permit not");
ok(Number(page?.rating) === 4 && page?.review_count === 3,
  "the one star rating: revealed job reviews on jobs not cancelled plus a public Declutter review (4.0 from 3)");
const profileStats = one(await as("authenticated", FAN, `SELECT row_to_json(s) AS r FROM public.get_public_profile_stats(ARRAY['${OWNER}'::uuid]) s`));
ok(Number(profileStats?.avg_rating) === Number(page?.rating) && profileStats?.review_count === page?.review_count,
  "the shop shows exactly the rating the owner's profile shows (G11)");
ok(page?.mine === false && page?.sos_number === null && page?.hidden_reason === null, "a visitor gets no owner-only fields");
ok(Array.isArray(page?.hours) && page.hours.length === 2, "the page carries the opening hours");
ok(page && !("phone" in page) && !("email" in page) && !("website" in page), "the page has no phone, email or website (L49)");
ok(one(await as("authenticated", FAN, `SELECT public.shops_set_follow('${shopA}', true)`)) === true, "a member follows the shop (L92)");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_set_follow('${shopA}', true)`), /own_shop/), "the owner cannot follow their own shop");
ok(refused(await as("authenticated", BANNED, `SELECT public.shops_set_follow('${shopA}', true)`), /account_restricted/), "a banned member cannot follow");
const page2 = one(await as("authenticated", FAN, `SELECT public.shops_get_shop('${shopA}') AS p`));
ok(page2?.following === true && page2?.follower_count === 1, "follow shows on the page");
ok(refused(await as("authenticated", ORDINARY, `SELECT public.shops_get_shop('${shopA}')`), /feature_disabled/),
  "a member without the switch cannot read a shop page");

// --- browse: nearest first, then rating
await db.exec(`INSERT INTO public.test_accounts (user_id) VALUES ('${ORDINARY}') ON CONFLICT DO NOTHING`);
const shopB = one(await as("authenticated", ORDINARY, saveSql({ name: "Teche Welding", category: "welding", area: "New Iberia", lat: 30.0, lng: -91.82 })));
const shopS = one(await as("authenticated", SEEDY, saveSql({ name: "Seed Shop", category: "bakery", area: "Abbeville", lat: 29.97, lng: -92.13 })));
ok(typeof shopB === "string" && typeof shopS === "string", "two more members open shops");
const near = await as("authenticated", FAN, `SELECT id, miles::text FROM public.shops_browse(30.0, -91.82)`);
ok(Array.isArray(near) && near[0]?.id === shopB && near.length === 3, "browse lists nearest first (L69)");
const bakery = await as("authenticated", FAN, `SELECT id FROM public.shops_browse(30.0, -91.82, 'bakery')`);
ok(Array.isArray(bakery) && bakery.length === 2 && !bakery.some((r) => r.id === shopB), "browse filters by category");
const grp = await as("authenticated", FAN, `SELECT id FROM public.shops_browse(30.0, -91.82, NULL, 'trades')`);
ok(Array.isArray(grp) && grp.length === 1 && grp[0]?.id === shopB, "browse filters by category group");
const coarse = await as("authenticated", FAN, `SELECT pin_lat::text AS a FROM public.shops_browse(NULL, NULL) WHERE id = '${shopA}'`);
ok(Array.isArray(coarse) && coarse[0]?.a === "30.15", "browse never gives more than 2 decimals");
await svc(`UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": true}'`);
const noSeed = await as("authenticated", FAN, `SELECT id FROM public.shops_browse(NULL, NULL)`);
ok(Array.isArray(noSeed) && !noSeed.some((r) => r.id === shopS), "a test account's shop leaves browse while seeds are hidden");
const noSeedRest = await as("authenticated", FAN, `SELECT id FROM public.shops`);
ok(Array.isArray(noSeedRest) && !noSeedRest.some((r) => r.id === shopS), "... and REST agrees");
const ownSeed = one(await as("authenticated", SEEDY, `SELECT public.shops_get_shop('${shopS}') AS p`));
ok(ownSeed?.mine === true, "its owner still sees it");
await svc(`UPDATE public.platform_settings SET feature_flags = '{}'`);

// --- vacation
ok(one(await as("authenticated", OWNER, `SELECT public.shops_set_paused(true)`)) === true, "the owner pauses the shop (L84)");
const paused = await as("authenticated", FAN, `SELECT paused FROM public.shops_browse(NULL, NULL) WHERE id = '${shopA}'`);
ok(Array.isArray(paused) && paused[0]?.paused === true, "a paused shop still shows, marked paused");

// --- admin
ok(refused(await as("authenticated", FAN, `SELECT public.shops_admin_set_hidden('${shopA}', true, 'spam')`), /not_admin/, "42501"),
  "a member cannot hide a shop");
await as("authenticated", OWNER, saveSql({ sos: "'34567890K'" }));
ok(one(await as("authenticated", ADMIN, `SELECT public.shops_admin_check_registration('${shopA}', true)`)) === true,
  "an admin checks the Secretary of State number (L56)");
const reg = one(await as("authenticated", FAN, `SELECT public.shops_get_shop('${shopA}') AS p`));
ok(reg?.badges?.registered === true, "Registered business shows once an admin checked it");
await as("authenticated", OWNER, saveSql({ sos: "'99999999K'" }));
const reg2 = one(await as("authenticated", FAN, `SELECT public.shops_get_shop('${shopA}') AS p`));
ok(reg2?.badges?.registered === false, "a changed number loses the badge until checked again");
ok(one(await as("authenticated", ADMIN, `SELECT public.shops_admin_set_hidden('${shopA}', true, 'Selling banned items')`)) === true,
  "an admin hides a shop (L75)");
ok(refused(await as("authenticated", FAN, `SELECT public.shops_get_shop('${shopA}')`), /shop_not_found/, "P0002"),
  "a hidden shop is gone for members");
ok(one(await as("authenticated", FAN, `SELECT public.shop_publicly_visible('${shopA}')`)) === false,
  "the visibility helper reveals nothing about a hidden shop");
const fanRest = await as("authenticated", FAN, `SELECT id FROM public.shops WHERE id = '${shopA}'`);
ok(Array.isArray(fanRest) && fanRest.length === 0, "... by REST too");
ok(one(await as("authenticated", FAN, `SELECT public.shops_set_follow('${shopA}', false)`)) === false
   && one(await svc(`SELECT count(*)::int FROM public.shop_follows WHERE user_id = '${FAN}' AND shop_id = '${shopA}'`)) === 0,
  "a follower can still unfollow a hidden shop");
ok(refused(await as("authenticated", FAN, `SELECT public.shops_set_follow('${shopA}', true)`), /shop_not_found/, "P0002"),
  "... but cannot follow it again while hidden");
await svc(`INSERT INTO public.shop_follows (user_id, shop_id) VALUES ('${FAN}', '${shopA}')`);
const ownHidden = one(await as("authenticated", OWNER, `SELECT public.shops_get_shop('${shopA}') AS p`));
ok(ownHidden?.hidden === true && ownHidden?.hidden_reason === "Selling banned items", "the owner sees it hidden, with the reason");
const audits = await svc(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE target_type = 'shop'`);
ok(one(audits) === 2, "both admin actions are in admin_audit_log");
ok(refused(await as("authenticated", OWNER, `SELECT public.shops_close_my_shop()`), /shop_hidden/, "42501"),
  "a hidden shop cannot be closed and reopened clean (L75)");
const stillHidden = await svc(`SELECT hidden_at IS NOT NULL AS h FROM public.shops WHERE id = '${shopA}'`);
ok(Array.isArray(stillHidden) && stillHidden[0]?.h === true, "it stays hidden");
const adminShop = one(await as("authenticated", ADMIN, saveSql({ name: "Admin Crafts", category: "crafts_gifts", area: "Lafayette", lat: 30.22, lng: -92.02 })));
ok(typeof adminShop === "string", "an admin may have a shop too (never role-based)");
ok(refused(await as("authenticated", ADMIN, `SELECT public.shops_admin_set_hidden('${adminShop}', true, 'testing self')`), /own_shop/),
  "an admin cannot hide or unhide their own shop");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${ORDINARY}'`);
const banned = await as("authenticated", FAN, `SELECT id FROM public.shops_browse(NULL, NULL)`);
ok(Array.isArray(banned) && !banned.some((r) => r.id === shopB), "a banned owner's shop leaves browse");
const bannedRest = await as("authenticated", FAN, `SELECT id FROM public.shops WHERE id = '${shopB}'`);
ok(Array.isArray(bannedRest) && bannedRest.length === 0, "... and REST");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${ORDINARY}'`);
await svc(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, expires_at)
  SELECT '${ORDINARY}', 'buyer', 'missed_checkout', now() + interval '1 year' FROM generate_series(1, 3)`);
const struck = await as("authenticated", FAN, `SELECT id FROM public.shops_browse(NULL, NULL)`);
ok(Array.isArray(struck) && !struck.some((r) => r.id === shopB), "a 3-strike owner's shop leaves browse (L45: out of both)");
ok(refused(await as("authenticated", FAN, `SELECT public.shop_owner_in_good_standing('${OWNER}')`), /permission denied/),
  "the standing helper is not client-callable");
ok(one(await as("authenticated", FAN, `SELECT public.shop_publicly_visible('${shopB}')`)) === false,
  "the visibility helper answers false for a struck owner's shop");
await svc(`UPDATE public.shops SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = '${shopA}'`);

// --- close
await as("authenticated", OWNER, `SELECT public.shops_attach_photo('cover', '${OWNER}/shops/logo1.jpg')`);
const closed = await as("authenticated", OWNER, `SELECT public.shops_close_my_shop() AS p`);
ok(Array.isArray(closed) && one(closed)?.length === 2, "closing the shop returns its photo paths for removal");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_follows WHERE shop_id = '${shopA}'`)) === 0, "its follows go with it");

// --- structure
const internal = await svc(`SELECT string_agg(p.proname || ':' || r.rolname, ',') AS w
  FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('shops_assert_owner_eligible', 'shop_owner_in_good_standing', 'shop_badges', 'shop_owner_rating', 'shop_visible_to', 'reject_contact_leak_in_shop')
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')`);
ok(Array.isArray(internal) && one(internal) === null && !skip, "the internal helpers are not client-callable");
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS w FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'shop%' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon executes no shop function");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'shop%' AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null && !skip, "no client role can write any shop table (RPCs only)");
const rls = await svc(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace
  AND relname LIKE 'shop%' AND relkind = 'r' AND NOT relrowsecurity`);
const tables = await svc(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'shop%' AND relkind = 'r'`);
ok(one(tables) === 5 && one(rls) === 0, "5 shop tables, every one with RLS on");
const definers = await svc(`SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'shop%' AND p.prosecdef AND NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')`);
ok(one(definers) === 0 && !skip, "every SECURITY DEFINER shop function pins search_path");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
