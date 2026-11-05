#!/usr/bin/env node
/**
 * PGlite proof for 20261105173912_shops_items_live_at_once (Shops H3, audit
 * ~/.lh-shots/audit-1105-shops.md; owner answer 2, 2026-11-05): a shop item
 * goes live at once when the automatic checks pass, and a live item's price,
 * description and stock edits stay live.
 *
 *   node src/test/pglite/shopsItemsLiveAtOnce.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsItemsLiveAtOnce.pglite.mjs   # RED: the H3 steps fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsItemsLiveAtOnce.pglite.mjs
 *
 * Setup is shopsItems.pglite.mjs's (prod-shaped stubs, the newest helpers,
 * the switches, Declutter's foundation, shops slice 1 and slice 2 once); then
 * this migration 3x (replay-safe). Slice 2's own behaviour stays proved there.
 */

import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261105173912_shops_items_live_at_once.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157")).sort()) {
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
-- prod's shape (pg_policies, 2026-10-17): RLS on, an admin-only INSERT and an
-- admin-only SELECT, no UPDATE or DELETE policy, every table privilege granted
-- to authenticated. So a member's UPDATE or DELETE reaches no row (the hold).
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can insert audit log" ON public.admin_audit_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view audit log" ON public.admin_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT ALL ON public.admin_audit_log TO authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  under_13_blocked_at timestamptz, /* prod 20261022002144: is_caller_banned() reads it */ stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT true, background_check_status text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credential_type text NOT NULL, status text NOT NULL DEFAULT 'pending', expiration_date date, license_number text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, status text NOT NULL DEFAULT 'published', feedback_visible_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text NOT NULL,
  date_needed date, start_time time, helper_arrived_at timestamptz, revision_count integer DEFAULT 0, is_group_job boolean DEFAULT false,
  is_seed boolean DEFAULT false, cancelled_by uuid, cancellation_reason text); -- read by get_public_profile_stats (newest: 20261030015205, 20261031234653)
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, handed_over_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false); -- read by get_public_profile_stats (newest)
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reviewer_id uuid,
  reviewee_id uuid, reviewer_side text NOT NULL, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  removed_at timestamptz); -- prod 20261102040000: get_public_profile_stats (newest) skips removed reviews
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
await db.exec(newestDefinition("is_test_member").stmt); // 20261030015205: get_public_profile_stats (newest) calls it
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
await db.exec(SLICE2);
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
/**
 * An admin's decision on the submission they saw (lh-authz-rls re-review N1):
 * the item's submitted_at, read as text so no precision is lost, or `seenAt`
 * (an SQL literal: a quoted timestamp or NULL).
 */
async function decide(uid, item, approve, note, seenAt) {
  const at = seenAt ?? (await svc(`SELECT quote_nullable(submitted_at::text) AS q FROM public.shop_items WHERE id = '${item}'`))?.[0]?.q ?? "NULL";
  return member(uid, `SELECT public.shops_admin_review_item('${item}', ${approve}, ${note}, ${at})`);
}
const recordAi = async (item, kind, subtype, title, description, flag) =>
  svc(`SELECT public.shops_record_item_ai_check('${item}', '${OWNER}', ARRAY[${await photoIds(item)}]::uuid[], '${kind}', '${subtype}', '${title}', '${description}', ${flag ? `'${flag}'` : "NULL"})`);


// --- set up: a brand-new shop with order days, no approved items
const shopA = one(await saveShop(OWNER, "Bayou Bakes", 30.15, -91.96));
if (typeof shopA !== "string") throw new Error(`setup: slice 1 did not open the shop: ${JSON.stringify(shopA)}`);
await member(OWNER, `SELECT public.shops_set_hours('[{"weekday":1,"opens":"08:00","closes":"17:00"}]')`);
const mk = async (title, description = "Soy wax.", subtype = "candles") => {
  const id = one(await member(OWNER, createSql({ kind: "made", subtype, title, description })));
  await readyToPublish(OWNER, id, STATEMENTS.made);
  return id;
};
const status = async (id) => one(await svc(`SELECT status FROM public.shop_items WHERE id = '${id}'`));
const edit = (id, subtype, title, description, price, lead, stock) =>
  member(OWNER, `SELECT public.shops_update_item('${id}', 'made', '${subtype}', '${title}', '${description}', ${price}, ${lead}, ${stock})`);

// 1. go live at once (no first-3 hold)
ok(one(await svc(`SELECT count(*)::int FROM public.shop_items WHERE shop_id = '${shopA}' AND admin_approved_at IS NOT NULL`)) === 0,
  "setup: the shop has no admin-approved item");
const a1 = await mk("Cypress candle");
await recordAi(a1, "made", "candles", "Cypress candle", "Soy wax.", null);
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${a1}')`)) === "live" && (await status(a1)) === "live",
  "a new shop's FIRST clean, AI-checked item goes live at once (no first-3 admin hold)");
ok((await rows(FAN, `SELECT id FROM public.shop_items WHERE id = '${a1}'`))?.length === 1, "and a shopper sees it");

// 2. an AI check that never answered fails open to the word check
const a2 = await mk("Fig candle");
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${a2}')`)) === "live",
  "an item the AI check never answered for goes live when the word check passes (fails open, as Declutter)");

// 3. failed automatic checks still go to an admin
const a3 = await mk("Duck decoy", "Hand carved.", "crafts");
await recordAi(a3, "made", "crafts", "Duck decoy", "Hand carved.", "Looks like a weapon");
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${a3}')`)) === "pending_review", "an AI flag still waits for an admin");
const a4 = await mk("Rum cake candle", "Smells like rum.");
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${a4}')`)) === "pending_review", "a word-check hit (alcohol) still waits for an admin");

// 4. live edits stay live
const liveAt = one(await svc(`SELECT live_at::text FROM public.shop_items WHERE id = '${a1}'`));
ok(one(await edit(a1, "candles", "Cypress candle", "Soy wax.", 2400, 3, 5)) === "live"
   && (await status(a1)) === "live"
   && one(await svc(`SELECT price_cents FROM public.shop_items WHERE id = '${a1}'`)) === 2400
   && one(await svc(`SELECT stock_count FROM public.shop_items WHERE id = '${a1}'`)) === 5
   && one(await svc(`SELECT live_at::text FROM public.shop_items WHERE id = '${a1}'`)) === liveAt,
  "a price and stock edit on a live item stays live (live_at kept)");
ok(one(await svc(`SELECT ai_checked_at IS NOT NULL FROM public.shop_item_private WHERE item_id = '${a1}'`)) === true,
  "a price-only edit keeps the AI verdict");
ok(one(await edit(a1, "candles", "Cypress candle", "Soy wax, cotton wick.", 2400, 3, 5)) === "live" && (await status(a1)) === "live",
  "a clean description edit on a live item stays live");
ok(one(await svc(`SELECT ai_checked_at IS NULL FROM public.shop_item_private WHERE item_id = '${a1}'`)) === true,
  "new words clear the old AI verdict");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_attestations WHERE item_id = '${a1}'`)) === 1,
  "same kind and type: the confirmations still cover it");
ok(one(await edit(a1, "candles", "Cypress candle", "Smells like bourbon.", 2400, 3, 5)) === "pending_review"
   && (await status(a1)) === "pending_review"
   && /alcohol/.test(one(await svc(`SELECT text_flag_reason FROM public.shop_item_private WHERE item_id = '${a1}'`)) ?? ""),
  "a live edit that trips the word check goes to an admin, with the reason");
ok((await rows(FAN, `SELECT id FROM public.shop_items WHERE id = '${a1}'`))?.length === 0, "and shoppers stop seeing it");
const q = await member(ADMIN, `SELECT item_id FROM public.shops_admin_pending_items() WHERE item_id = '${a1}'`);
ok(Array.isArray(q) && q.length === 1, "the admin queue lists the flagged edit");

// 5. a new kind or type still makes it a draft (the confirmations were for the old type)
const a5 = await mk("Pecan candle");
await member(OWNER, `SELECT public.shops_publish_item('${a5}')`);
ok((await status(a5)) === "live" && one(await edit(a5, "crafts", "Pecan candle", "Soy wax.", 1800, 2, "NULL")) === "draft"
   && (await status(a5)) === "draft"
   && one(await svc(`SELECT count(*)::int FROM public.shop_item_attestations WHERE item_id = '${a5}'`)) === 0,
  "changing a live item's type takes it down to a draft and drops the confirmations");

// 6. the 30-day hold after a rejection stays
const at = one(await svc(`SELECT quote_nullable(submitted_at::text) AS q FROM public.shop_items WHERE id = '${a3}'`));
ok(one(await member(ADMIN, `SELECT public.shops_admin_review_item('${a3}', false, 'Not a decoy we can list', ${at})`)) === "rejected",
  "setup: an admin rejects the flagged item");
const a6 = await mk("Bay candle");
await recordAi(a6, "made", "candles", "Bay candle", "Soy wax.", null);
ok(one(await member(OWNER, `SELECT public.shops_publish_item('${a6}')`)) === "pending_review",
  "within 30 days of a rejection, even a clean item waits for an admin");
const a7 = await mk("Oak candle");
await svc(`UPDATE public.admin_audit_log SET created_at = now() - interval '31 days' WHERE action = 'shop_item_rejected'`);
const a7pub = one(await member(OWNER, `SELECT public.shops_publish_item('${a7}')`));
await svc(`UPDATE public.admin_audit_log SET created_at = now() WHERE action = 'shop_item_rejected'`);
ok(a7pub === "live" && one(await edit(a7, "candles", "Oak candle", "Soy wax, oak scent.", 1800, 2, "NULL")) === "pending_review",
  "within 30 days of a rejection, a live item's new words wait for an admin");
ok(one(await edit(a2, "candles", "Fig candle", "Soy wax.", 1900, 2, "NULL")) === "live",
  "within 30 days of a rejection, a price-only edit still stays live");

// 7. the gates are unchanged
ok(refused(await member(ORDINARY, `SELECT public.shops_publish_item('${a2}')`), /feature_disabled/, "42501"),
  "testers only: an ordinary account is refused at the server (publish)");
ok(refused(await member(ORDINARY, `SELECT public.shops_update_item('${a2}', 'made', 'candles', 'Fig', 'x', 100, 1, NULL)`), /feature_disabled/, "42501"),
  "testers only: an ordinary account is refused at the server (edit)");
ok(refused(await member(FAN, `SELECT public.shops_update_item('${a2}', 'made', 'candles', 'Fig', 'x', 100, 1, NULL)`), /shop_not_found|item_not_found|not_your/),
  "another member cannot edit the owner's item");
ok(refused(await as("anon", null, `SELECT public.shops_publish_item('${a2}')`), /permission denied/), "anon cannot publish");
const acl = await svc(`SELECT string_agg(p.proname, ',') AS w FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('shops_publish_item', 'shops_update_item') AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(acl) && one(acl) === null, "neither function is executable by anon");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
