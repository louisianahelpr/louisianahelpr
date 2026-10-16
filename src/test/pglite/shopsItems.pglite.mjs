#!/usr/bin/env node
/**
 * PGlite proof for 20261016212915_shops_items (Shops slice 2: items; owner
 * decisions docs/specs/local-shops-prep.md L5-L22, L45, L51, L52, L75, L82,
 * and the lane's dated D1-D6 defaults there), on top of slice 1
 * (20261015123029_shops_profiles, applied once, as prod will have it).
 *
 *   node src/test/pglite/shopsItems.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsItems.pglite.mjs     # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsItems.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs exactly as shopsProfiles.pglite.mjs (roles + prod's
 * default function ACL, so a REVOKE that forgets anon is caught; auth.users /
 * auth.uid(); storage.objects with RLS; profiles; user_roles/has_role;
 * test_accounts; admin_audit_log; helper_credentials; reviews). The helpers
 * the migrations call are NOT re-typed: their NEWEST definitions are read out
 * of supabase/migrations (excluding the two shops files). Then the switches
 * (20261012031120), Declutter's foundation (20261014193955: the shared
 * strike count, L45), shops slice 1 once, and this migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261016212915_shops_items.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261015123029_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261015123029") && !x.startsWith("20261016212915")).sort()) {
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
const OWNER = U(1), FAN = U(2), ORDINARY = U(3), MINOR = U(4), BANNED = U(5), STRUCK = U(6), NOPAYOUT = U(7), ADMIN = U(8), SEEDY = U(9), ADMIN2 = U(10);

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
await db.exec(SLICE1);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 10) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status, is_seed) VALUES
    ('${OWNER}',    'acct_s', true,  '1990-01-01', 'active', false),
    ('${FAN}',      'acct_b', true,  '1991-01-01', 'active', false),
    ('${ORDINARY}', 'acct_o', true,  '1992-01-01', 'active', false),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active', false),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned', false),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active', false),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active', false),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active', false),
    ('${SEEDY}',    'acct_e', true,  '1990-01-01', 'active', true),
    ('${ADMIN2}',   'acct_c', true,  '1981-01-01', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${OWNER}'), ('${FAN}'), ('${MINOR}'), ('${BANNED}'), ('${STRUCK}'), ('${NOPAYOUT}'), ('${ADMIN}'), ('${SEEDY}'), ('${ADMIN2}');
  INSERT INTO public.declutter_strikes (user_id, offender_side, reason, expires_at)
    SELECT '${STRUCK}', 'seller', 'seller_no_show', now() + interval '1 year' FROM generate_series(1, 3);
  UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops';`);

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
const member = (uid, sql) => as("authenticated", uid, sql);
const rows = async (uid, sql) => {
  const r = await member(uid, sql);
  return Array.isArray(r) ? r : null;
};

const saveShop = (uid, name, lat, lng) =>
  member(uid, `SELECT public.shops_save_my_shop('${name}', 'About us.', 'bakery', ARRAY['Lafayette'], 'Broussard',
     false, ${lat}, ${lng}, true, false, NULL) AS id`);
const createSql = ({ kind = "home_food", subtype = "baked_goods", title = "Kolache dozen", description = "Fruit kolaches.",
  price = 1800, lead = 2, stock = "NULL" } = {}) =>
  `SELECT public.shops_create_item('${kind}', '${subtype}', '${title}', '${description}', ${price}, ${lead}, ${stock}) AS id`;
const STATEMENTS = {
  home_food: ["made_in_my_home_kitchen", "low_risk_no_meat_fish", "label_says_home_kitchen", "kitchen_rules", "no_cbd_or_alcohol", "sales_tax_registered", "not_banned"],
  made: ["made_by_me", "new_not_used", "not_for_children", "not_skin_product", "not_banned"],
  eggs: ["own_hens", "kept_cold", "no_cracked_dirty", "not_banned"],
};
const arr = (xs) => `ARRAY[${xs.map((x) => `'${x}'`).join(", ")}]::text[]`;
let nPhoto = 0;
async function upload(uid, item, mime = "image/jpeg") {
  const p = `${uid}/shop-items/${item}/p${++nPhoto}.jpg`;
  await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('job-photos', '${p}', '${uid}', '{"mimetype":"${mime}","size":"1000"}')`);
  return p;
}
async function addPhotos(uid, item, n) {
  for (let i = 0; i < n; i++) {
    const p = await upload(uid, item);
    await member(uid, `SELECT public.shops_add_item_photo('${item}', '${p}')`);
  }
}
async function readyToPublish(uid, item, statements) {
  await addPhotos(uid, item, 3);
  return member(uid, `SELECT public.shops_attest_item('${item}', ${arr(statements)})`);
}
const photoIds = async (item) => {
  const r = await svc(`SELECT id FROM public.shop_item_photos WHERE item_id = '${item}'`);
  return Array.isArray(r) ? r.map((x) => `'${x.id}'`).join(",") : "";
};
const recordAi = async (item, kind, subtype, title, description, flag) =>
  svc(`SELECT public.shops_record_item_ai_check('${item}', '${OWNER}', ARRAY[${await photoIds(item)}]::uuid[], '${kind}', '${subtype}', '${title}', '${description}', ${flag ? `'${flag}'` : "NULL"})`);

// --- set up: OWNER has a shop (no opening hours yet)
const shopA = one(await saveShop(OWNER, "Bayou Bakes", 30.15, -91.96));
if (typeof shopA !== "string") throw new Error(`setup: slice 1 did not open the shop: ${JSON.stringify(shopA)}`);

// --- the switch and the gates
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'shops'`);
ok(refused(await member(OWNER, createSql()), /feature_disabled/, "42501"), "switch off: even the owner is refused (feature_disabled)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);
ok(refused(await member(ORDINARY, createSql()), /feature_disabled/, "42501"), "testers: an ordinary account is refused at the server");
ok(refused(await as("anon", null, createSql()), /permission denied/), "anon cannot execute shops_create_item");
ok(refused(await member(MINOR, createSql()), /under_18/, "42501"), "under 18: refused (L82)");
ok(refused(await member(BANNED, createSql()), /account_restricted/, "42501"), "banned: refused");
ok(refused(await member(STRUCK, createSql()), /shop_strikes_blocked/, "42501"), "3 shared marketplace strikes: refused (L45)");
ok(refused(await member(NOPAYOUT, createSql()), /payout_setup_incomplete/, "42501"), "no payout setup: refused (L3)");
ok(refused(await member(FAN, createSql()), /shop_not_found/, "P0002"), "a member with no shop cannot list an item");

// --- what may be listed (L5, L9-L16)
ok(refused(await member(OWNER, createSql({ kind: "rental", subtype: "crafts" })), /rental_not_available/, "22023"),
  "rental is reserved, refused until the rentals slice (S5)");
ok(refused(await member(OWNER, createSql({ kind: "made", subtype: "eggs" })), /invalid_subtype/, "22023"),
  "a type from another kind is refused");
for (const [kind, bad] of [["made", "soap"], ["farm", "plants"], ["made", "toys"], ["home_food", "plate_lunch"], ["home_food", "gumbo"]]) {
  ok(refused(await member(OWNER, createSql({ kind, subtype: bad })), /invalid_subtype/, "22023"), `'${bad}' is not on the list (L6, L11, L12, L14)`);
}
const subs = await svc(`SELECT kind, count(*)::int AS n FROM public.shop_item_subtypes GROUP BY kind ORDER BY kind`);
ok(Array.isArray(subs) && JSON.stringify(subs) === JSON.stringify([{ kind: "farm", n: 2 }, { kind: "home_food", n: 9 }, { kind: "made", n: 6 }]),
  "the list: 9 low-risk home foods (R.S. 40:4.9 E), eggs + produce, 6 made types; nothing for rental");
ok(refused(await member(OWNER, createSql({ price: 99 })), /invalid_price/, "22023"), "a price under $1 is refused");
ok(refused(await member(OWNER, createSql({ price: 100001 })), /invalid_price/, "22023"), "a price over $1,000 is refused (D3)");
ok(refused(await member(OWNER, createSql({ lead: 61 })), /invalid_lead_time/, "22023"), "a lead time over 60 days is refused");
ok(refused(await member(OWNER, createSql({ stock: -1 })), /invalid_stock/, "22023"), "a negative stock count is refused");
ok(refused(await member(OWNER, createSql({ title: "ab" })), /invalid_title/, "22023"), "a 2-character title is refused");
ok(refused(await member(OWNER, createSql({ description: "Text me at 337 555 1234" })), /Phone number detected/, "23514"),
  "a phone number in the description is refused (L49)");

// --- create
const itemA = one(await member(OWNER, createSql()));
ok(typeof itemA === "string", "the owner creates a home-food draft");
ok(one(await svc(`SELECT is_seed FROM public.shop_items WHERE id = '${itemA}'`)) === false, "a real member's item is not seed");
ok(refused(await svc(`UPDATE public.shop_items SET subtype = 'eggs' WHERE id = '${itemA}'`), /invalid_subtype/),
  "the table refuses a kind/type mismatch whoever writes it");
for (const t of ["shop_items", "shop_item_private", "shop_item_photos", "shop_item_attestations", "shop_item_subtypes",
  "shop_cottage_settings", "shop_cottage_confirmations", "shop_cottage_sales"]) {
  ok(refused(await member(OWNER, `DELETE FROM public.${t}`), /permission denied/), `the owner cannot DELETE from ${t} directly`);
}
ok(refused(await member(OWNER, `UPDATE public.shop_items SET admin_approved_at = now()`), /permission denied/),
  "the owner cannot approve their own item by REST");
ok(refused(await member(OWNER, `SELECT * FROM public.shop_item_private`), /permission denied/), "no member reads shop_item_private");
ok(refused(await member(OWNER, `INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents) VALUES ('${OWNER}', gen_random_uuid(), 0)`), /permission denied/),
  "no member writes the home-food sales count");
ok((await rows(FAN, `SELECT id FROM public.shop_items`))?.length === 0, "a draft is invisible to other members by REST");
const fanList0 = one(await member(FAN, `SELECT public.shops_shop_items('${shopA}') AS r`));
ok(Array.isArray(fanList0) && fanList0.length === 0, "... and on the shop page");
const ownList0 = one(await member(OWNER, `SELECT public.shops_shop_items('${shopA}') AS r`));
ok(Array.isArray(ownList0) && ownList0.length === 1 && ownList0[0].status === "draft" && ownList0[0].home_kitchen === true,
  "the owner sees the draft, marked home-kitchen (L7 notice)");

// --- publish preconditions, in order
ok(refused(await member(OWNER, `SELECT public.shops_publish_item('${itemA}')`), /order_days_required/, "22023"),
  "publish needs the shop's order days first (L21)");
await member(OWNER, `SELECT public.shops_set_hours('[{"weekday":1,"opens":"08:00","closes":"17:00"}]')`);
await addPhotos(OWNER, itemA, 2);
ok(refused(await member(OWNER, `SELECT public.shops_publish_item('${itemA}')`), /photos_required/, "22023"), "publish needs 3 photos");
const theirs = await upload(FAN, itemA);
ok(refused(await member(OWNER, `SELECT public.shops_add_item_photo('${itemA}', '${theirs}')`), /photo_not_uploaded/), "another member's object cannot be attached");
const clip = await upload(OWNER, itemA, "video/mp4");
ok(refused(await member(OWNER, `SELECT public.shops_add_item_photo('${itemA}', '${clip}')`), /photo_not_uploaded/), "a video cannot be attached (GPS)");
const wrongItem = `${OWNER}/shop-items/${shopA}/x.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('job-photos', '${wrongItem}', '${OWNER}', '{"mimetype":"image/jpeg","size":"1000"}')`);
ok(refused(await member(OWNER, `SELECT public.shops_add_item_photo('${itemA}', '${wrongItem}')`), /photo_not_uploaded/), "a photo in another item's folder is refused");
await addPhotos(OWNER, itemA, 1);
ok(refused(await member(OWNER, `SELECT public.shops_publish_item('${itemA}')`), /attestation_required/, "22023"), "publish needs the confirmations");
ok(refused(await member(OWNER, `SELECT public.shops_attest_item('${itemA}', ${arr(STATEMENTS.home_food.slice(1))})`), /attestation_incomplete/, "22023"),
  "one confirmation missing is refused");
ok(refused(await member(OWNER, `SELECT public.shops_attest_item('${itemA}', ${arr(STATEMENTS.home_food.filter((s) => s !== "label_says_home_kitchen"))})`), /attestation_incomplete/),
  "home food without 'my package label says it' is refused (L7)");
ok(refused(await member(OWNER, `SELECT public.shops_attest_item('${itemA}', ${arr([...STATEMENTS.home_food, "own_hens"])})`), /attestation_incomplete/),
  "a confirmation from another kind is refused");
ok(Array.isArray(await member(OWNER, `SELECT public.shops_attest_item('${itemA}', ${arr(STATEMENTS.home_food)})`)), "the full set is recorded");
ok(refused(await member(OWNER, `SELECT public.shops_publish_item('${itemA}')`), /cottage_confirmation_required/, "22023"),
  "home food needs this year's under-the-limit confirmation (L8)");
ok(one(await member(OWNER, `SELECT public.shops_confirm_cottage_year()`)) >= 2026, "the baker confirms the year");
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${itemA}')`)) === "pending_review", "a new shop's first item waits for an admin (L52)");
ok((await rows(FAN, `SELECT id FROM public.shop_items`))?.length === 0, "a pending item is invisible to others");

// --- admin review
ok(refused(await member(FAN, `SELECT * FROM public.shops_admin_pending_items()`), /not_admin/, "42501"), "a member cannot read the review queue");
ok(refused(await member(FAN, `SELECT public.shops_admin_review_item('${itemA}', true, NULL)`), /not_admin/, "42501"), "a member cannot approve");
const queue = await member(ADMIN, `SELECT item_id, approved_items, shop_name FROM public.shops_admin_pending_items()`);
ok(Array.isArray(queue) && queue.length === 1 && queue[0].item_id === itemA && queue[0].approved_items === 0 && queue[0].shop_name === "Bayou Bakes",
  "the admin queue lists it with the shop's approved count");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_review_item('${itemA}', false, ' ')`), /review_note_required/, "22023"), "a rejection needs a reason");
ok(one(await member(ADMIN, `SELECT public.shops_admin_review_item('${itemA}', true, NULL)`)) === "live", "an admin approves: live");
ok((await rows(FAN, `SELECT id FROM public.shop_items`))?.length === 1, "a switched-on member reads the live item by REST");
ok((await rows(FAN, `SELECT id FROM public.shop_item_photos WHERE item_id = '${itemA}'`))?.length === 3, "... and its photos");
ok((await rows(ORDINARY, `SELECT id FROM public.shop_items`))?.length === 0, "a member without the switch reads no item by REST");
const fanList = one(await member(FAN, `SELECT public.shops_shop_items('${shopA}') AS r`));
ok(Array.isArray(fanList) && fanList.length === 1 && fanList[0].home_kitchen === true && fanList[0].photos.length === 3,
  "the shop page lists it with the home-kitchen notice and photos");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE target_type = 'shop_item' AND action = 'shop_item_approved'`)) === 1,
  "the approval is in admin_audit_log");
const rev = await member(OWNER, `SELECT * FROM public.shops_my_item_review('${itemA}')`);
ok(Array.isArray(rev) && rev[0]?.attested === true && rev[0]?.ai_checked === false, "the owner reads their own review state");
ok(refused(await member(FAN, `SELECT * FROM public.shops_my_item_review('${itemA}')`), /item_not_found/, "P0002"), "nobody else reads it");

// --- stock and lead time keep it up; an edit takes it down
ok(one(await member(OWNER, `SELECT public.shops_set_item_stock('${itemA}', 6, 0)`)) === 6, "ready now: 6 in stock (L20)");
ok(one(await svc(`SELECT status FROM public.shop_items WHERE id = '${itemA}'`)) === "live", "a stock change keeps the item live");
ok(refused(await member(FAN, `SELECT public.shops_set_item_stock('${itemA}', 1, 0)`), /item_not_found/, "P0002"), "another member cannot change the stock");
ok(one(await member(OWNER, `SELECT public.shops_update_item('${itemA}', 'home_food', 'baked_goods', 'Kolache half dozen', 'Fruit kolaches.', 1000, 2, NULL)`)) === "draft",
  "editing a live item puts it back to draft");
ok((await rows(FAN, `SELECT id FROM public.shop_items`))?.length === 0, "an edited item leaves the shop page until republished");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_attestations WHERE item_id = '${itemA}'`)) === 0,
  "changing what the item is asks for the confirmations again");

// --- after 3 approved items: the AI check and the word check decide
async function approvedItem(title) {
  const id = one(await member(OWNER, createSql({ kind: "made", subtype: "candles", title, description: "Soy wax." })));
  await readyToPublish(OWNER, id, STATEMENTS.made);
  await member(OWNER, `SELECT public.shops_publish_item('${id}')`);
  await member(ADMIN, `SELECT public.shops_admin_review_item('${id}', true, NULL)`);
  return id;
}
const b1 = await approvedItem("Fig candle");
const b2 = await approvedItem("Pecan candle");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_items WHERE shop_id = '${shopA}' AND admin_approved_at IS NOT NULL`)) === 3,
  "three of the shop's items are admin-approved");
const c1 = one(await member(OWNER, createSql({ kind: "made", subtype: "candles", title: "Cypress candle", description: "Soy wax." })));
await readyToPublish(OWNER, c1, STATEMENTS.made);
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${c1}')`)) === "pending_review", "after 3 approvals, an item the AI never checked still waits");
await member(OWNER, `SELECT public.shops_update_item('${c1}', 'made', 'candles', 'Cypress candle', 'Soy wax.', 1800, 2, NULL)`);
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_attestations WHERE item_id = '${c1}'`)) === 1,
  "a price-only edit keeps the confirmations");
ok(refused(await recordAi(c1, "made", "candles", "Other title", "Soy wax.", null), /ai_check_stale/),
  "an AI verdict on words the item no longer has is refused as stale");
ok(refused(await member(OWNER, `SELECT public.shops_record_item_ai_check('${c1}', '${OWNER}', ARRAY[]::uuid[], 'made', 'candles', 'Cypress candle', 'Soy wax.', NULL)`), /permission denied/),
  "a member cannot record their own AI verdict");
ok(Array.isArray(await recordAi(c1, "made", "candles", "Cypress candle", "Soy wax.", null)), "the edge function (service role) records a clean verdict");
await addPhotos(OWNER, c1, 1);
ok(one(await svc(`SELECT ai_checked_at IS NULL FROM public.shop_item_private WHERE item_id = '${c1}'`)) === true, "adding a photo voids the AI check");
await recordAi(c1, "made", "candles", "Cypress candle", "Soy wax.", null);
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${c1}')`)) === "live", "an established shop's AI-checked clean item goes live");
const c2 = one(await member(OWNER, createSql({ kind: "made", subtype: "candles", title: "Rum cake candle", description: "Smells like rum." })));
await readyToPublish(OWNER, c2, STATEMENTS.made);
await recordAi(c2, "made", "candles", "Rum cake candle", "Smells like rum.", null);
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${c2}')`)) === "pending_review", "the word check sends an alcohol word to an admin (L13)");
const tf = await member(ADMIN, `SELECT text_flag_reason FROM public.shops_admin_pending_items() WHERE item_id = '${c2}'`);
ok(Array.isArray(tf) && /alcohol/.test(tf[0]?.text_flag_reason ?? ""), "the admin sees why");
const c3 = one(await member(OWNER, createSql({ kind: "made", subtype: "crafts", title: "Duck decoy", description: "Hand carved." })));
await readyToPublish(OWNER, c3, STATEMENTS.made);
await recordAi(c3, "made", "crafts", "Duck decoy", "Hand carved.", "Looks like a weapon");
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${c3}')`)) === "pending_review", "an AI flag sends it to an admin (L52)");
const flagged = await member(OWNER, `SELECT ai_flagged FROM public.shops_my_item_review('${c3}')`);
ok(Array.isArray(flagged) && flagged[0]?.ai_flagged === true, "the owner sees it was flagged, not the reason");
ok(one(await member(ADMIN, `SELECT public.shops_admin_review_item('${c3}', false, 'Not a decoy we can list')`)) === "rejected", "an admin rejects with a reason");
const rejNote = await member(OWNER, `SELECT review_note FROM public.shops_my_item_review('${c3}')`);
ok(Array.isArray(rejNote) && rejNote[0]?.review_note === "Not a decoy we can list", "the owner reads the reason");

// --- the word check itself (L5, L11-L16)
for (const [kind, words, re] of [["home_food", "Boudin balls", /meat or fish/], ["home_food", "Crawfish bread", /meat or fish/],
  ["made", "Gently used rocking chair", /used/], ["made", "Baby blanket", /children/], ["made", "Goat milk soap", /skin/],
  ["farm", "Tomato seedlings", /plants/], ["made", "CBD candle", /CBD/], ["home_food", "Pepper jelly", null]]) {
  const r = one(await svc(`SELECT public.shop_item_text_flag('${kind}', '${words}', '')`));
  ok(re ? re.test(r ?? "") : r === null && !skip, `word check: '${words}' -> ${re ? "flagged" : "clean"}`);
}

// --- the home-food yearly limit (L8)
const status0 = one(await member(OWNER, `SELECT public.shops_my_cottage_status() AS s`));
ok(Number(status0?.cap_cents) === 3000000 && Number(status0?.sales_cents) === 0 && status0?.warn === false && status0?.reached === false && status0?.confirmed === true,
  "the limit is $30,000 (D2), nothing counted, confirmed this year");
await svc(`INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents) VALUES ('${OWNER}', gen_random_uuid(), 2400000)`);
const status1 = one(await member(OWNER, `SELECT public.shops_my_cottage_status() AS s`));
ok(status1?.warn === true && status1?.reached === false, "at 80% the baker is warned");
await svc(`INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, sold_at) VALUES ('${OWNER}', gen_random_uuid(), 900000, now() - interval '400 days')`);
ok(one(await member(OWNER, `SELECT public.shops_my_cottage_status() AS s`))?.reached === false, "last year's sales do not count");
const d1 = one(await member(OWNER, createSql({ title: "Praline box", description: "Pecan pralines.", subtype: "candy" })));
await readyToPublish(OWNER, d1, STATEMENTS.home_food);
await svc(`INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents) VALUES ('${OWNER}', gen_random_uuid(), 600000)`);
ok(one(await member(OWNER, `SELECT public.shops_my_cottage_status() AS s`))?.reached === true, "at the limit: reached");
ok(refused(await member(OWNER, `SELECT public.shops_publish_item('${d1}')`), /cottage_cap_reached/, "42501"), "no new home-food listing at the limit (L8)");
await member(OWNER, `SELECT public.shops_attest_item('${itemA}', ${arr(STATEMENTS.home_food)})`);
await svc(`UPDATE public.shop_items SET status = 'pending_review' WHERE id = '${itemA}'`);
ok(refused(await member(ADMIN, `SELECT public.shops_admin_review_item('${itemA}', true, NULL)`), /owner_not_eligible/, "22023"),
  "an admin cannot approve home food for a baker at the limit");
ok(one(await svc(`SELECT public.shop_cottage_cap_reached(NULL)`)) === true, "the limit check fails safe on a NULL owner");
ok(refused(await member(OWNER, `SELECT public.shop_cottage_cap_reached('${OWNER}')`), /permission denied/), "the limit check is not client-callable");
await svc(`DELETE FROM public.shop_cottage_sales`);

// --- eggs (L9), seed, admin's own item, daily limit, hidden shop (L75)
const egg = one(await member(OWNER, createSql({ kind: "farm", subtype: "eggs", title: "Dozen brown eggs", description: "From my hens." })));
ok(refused(await member(OWNER, `SELECT public.shops_attest_item('${egg}', ${arr(STATEMENTS.eggs.filter((s) => s !== "own_hens"))})`), /attestation_incomplete/),
  "eggs need 'from my own hens' (L9)");
ok(Array.isArray(await member(OWNER, `SELECT public.shops_attest_item('${egg}', ${arr(STATEMENTS.eggs)})`)), "eggs with the four confirmations");
const seedShop = one(await saveShop(SEEDY, "Seed Shop", 29.97, -92.13));
const seedItem = one(await member(SEEDY, createSql({ kind: "made", subtype: "art", title: "Seed art", description: "Test." })));
ok(typeof seedShop === "string" && one(await svc(`SELECT is_seed FROM public.shop_items WHERE id = '${seedItem}'`)) === true,
  "a test account's item is seed data from birth");
const adminShop = one(await saveShop(ADMIN, "Admin Crafts", 30.22, -92.02));
await member(ADMIN, `SELECT public.shops_set_hours('[{"weekday":2,"opens":"08:00","closes":"17:00"}]')`);
const adminItem = one(await member(ADMIN, createSql({ kind: "made", subtype: "art", title: "Bayou print", description: "Ink." })));
await readyToPublish(ADMIN, adminItem, STATEMENTS.made);
await member(ADMIN, `SELECT public.shops_publish_item('${adminItem}')`);
ok(typeof adminShop === "string" && refused(await member(ADMIN, `SELECT public.shops_admin_review_item('${adminItem}', true, NULL)`), /own_item/, "42501"),
  "an admin cannot approve their own item");
ok(one(await member(ADMIN2, `SELECT public.shops_admin_review_item('${adminItem}', true, NULL)`)) === "live", "another admin can");
ok(refused(await member(OWNER, `SELECT public.shops_set_daily_order_cap(0)`), /invalid_daily_cap/, "22023"), "a daily limit of 0 is refused");
ok(one(await member(OWNER, `SELECT public.shops_set_daily_order_cap(12)`)) === 12, "the shop sets 12 orders a day (L22)");
ok(one(await member(FAN, `SELECT daily_order_cap FROM public.shops WHERE id = '${shopA}'`)) === 12, "members can read the daily limit");
await member(ADMIN, `SELECT public.shops_admin_set_hidden('${shopA}', true, 'Selling banned items')`);
ok((await rows(FAN, `SELECT id FROM public.shop_items WHERE shop_id = '${shopA}'`))?.length === 0, "a hidden shop's items are gone for members (L75)");
ok(refused(await member(FAN, `SELECT public.shops_shop_items('${shopA}')`), /shop_not_found/, "P0002"), "... and its page");
ok(refused(await member(OWNER, createSql({ kind: "made", subtype: "art", title: "New art", description: "Ink." })), /shop_hidden/, "42501"),
  "a hidden shop lists nothing new");
ok(refused(await member(OWNER, `SELECT public.shops_set_item_stock('${b1}', 1, 1)`), /shop_hidden/, "42501"), "... and changes nothing");
const wd = one(await member(OWNER, `SELECT public.shops_withdraw_item('${b1}') AS p`));
ok(Array.isArray(wd) && wd.length === 3 && one(await svc(`SELECT status FROM public.shop_items WHERE id = '${b1}'`)) === "withdrawn",
  "the owner of a hidden shop can still take an item down; its photo paths come back");
await member(ADMIN, `SELECT public.shops_admin_set_hidden('${shopA}', false, NULL)`);
ok(refused(await member(OWNER, `SELECT public.shops_update_item('${b1}', 'made', 'candles', 'Fig candle', 'Soy wax.', 1800, 2, NULL)`), /item_not_editable/),
  "a withdrawn item cannot be edited back");
const dr = one(await member(OWNER, `SELECT public.shops_withdraw_item('${d1}') AS p`));
ok(Array.isArray(dr) && dr.length === 3 && one(await svc(`SELECT count(*)::int FROM public.shop_items WHERE id = '${d1}'`)) === 0,
  "withdrawing a draft deletes it and returns its photo paths");
ok(refused(await member(BANNED, `SELECT public.shops_withdraw_item('${b2}')`), /account_restricted/), "a banned member cannot call withdraw");
ok(refused(await member(FAN, `SELECT public.shops_withdraw_item('${b2}')`), /item_not_found/, "P0002"), "nobody withdraws another member's item");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${OWNER}'`);
ok((await rows(FAN, `SELECT id FROM public.shop_items WHERE shop_id = '${shopA}'`))?.length === 0, "a banned owner's items leave the page (L45)");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${OWNER}'`);
ok((await rows(FAN, `SELECT id FROM public.shop_items WHERE shop_id = '${shopA}'`))?.length > 0, "... and come back with the account");

// --- storage: the item photo folder
const loose = Array.isArray(wd) ? wd[0] : "none";
const delLoose = await member(OWNER, `DELETE FROM storage.objects WHERE name = '${loose}' RETURNING name`);
ok(Array.isArray(delLoose) && delLoose.length === 1, "the owner deletes a detached item photo object");
const attached = one(await svc(`SELECT storage_path FROM public.shop_item_photos WHERE item_id = '${b2}' LIMIT 1`));
const delAttached = await member(OWNER, `DELETE FROM storage.objects WHERE name = '${attached}' RETURNING name`);
ok(typeof attached === "string" && Array.isArray(delAttached) && delAttached.length === 0 && delLoose.length === 1,
  "an attached item photo cannot be deleted (neither the item policy nor slice 1's shop policy lets it)");
const delOther = await member(FAN, `DELETE FROM storage.objects WHERE name = '${Array.isArray(wd) ? wd[1] : "none"}' RETURNING name`);
ok(Array.isArray(delOther) && delOther.length === 0 && delLoose.length === 1, "another member cannot delete the owner's item photos");

// --- too many items (D6)
await svc(`INSERT INTO public.shop_items (shop_id, owner_id, kind, subtype, title, price_cents)
  SELECT '${shopA}', '${OWNER}', 'made', 'art', 'Filler ' || g, 500 FROM generate_series(1, 100) g`);
ok(refused(await member(OWNER, createSql({ kind: "made", subtype: "art", title: "One more", description: "Ink." })), /too_many_items/, "22023"),
  "a shop keeps at most 100 items");
await svc(`DELETE FROM public.shop_items WHERE title LIKE 'Filler %'`);

// --- close the shop: item photo paths come back too
const n2 = one(await svc(`SELECT count(*)::int FROM public.shop_item_photos WHERE owner_id = '${OWNER}'`));
const closed = one(await member(OWNER, `SELECT public.shops_close_my_shop() AS p`));
ok(Array.isArray(closed) && n2 > 0 && closed.length === n2, "closing the shop returns every item photo path for removal");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_items WHERE owner_id = '${OWNER}'`)) === 0 && n2 > 0, "its items go with it");

// --- structure
const internal = await svc(`SELECT string_agg(p.proname || ':' || r.rolname, ',') AS w
  FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('shop_item_required_statements', 'shop_item_text_flag', 'shop_cottage_year', 'shop_cottage_sales_cents',
                      'shop_cottage_cap_reached', 'shops_lock_own_item', 'shops_check_item_fields', 'shops_record_item_ai_check',
                      'shop_rows_seed_from_owner', 'shop_items_kind_matches_subtype', 'reject_contact_leak_in_shop_item',
                      'shop_item_photos_void_ai_check')
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
const tables = await svc(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT relrowsecurity)::int AS open FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'shop%' AND relkind = 'r'`);
ok(Array.isArray(tables) && tables[0]?.n === 13 && tables[0]?.open === 0, "13 shop tables (5 + 8 new), every one with RLS on");
const definers = await svc(`SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'shop%' AND p.prosecdef AND NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')`);
ok(one(definers) === 0 && !skip, "every SECURITY DEFINER shop function pins search_path");
const nofeature = await svc(`SELECT string_agg(p.proname, ',') AS w FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'shops\\_%'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.prosrc NOT LIKE '%PERFORM public.require_feature(''shops'');%'`);
ok(Array.isArray(nofeature) && one(nofeature) === null && !skip, "every client-callable shops_* function runs require_feature('shops')");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
