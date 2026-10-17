#!/usr/bin/env node
/**
 * PGlite proof for 20261017224153_shop_categories_v2 (Shops categories v2.2,
 * final; owner rules 2026-10-17 ~23:25Z to ~23:37Z via the lead: LOCAL
 * businesses people order, book or rent from, not delivery-app food service).
 *
 *   node src/test/pglite/shopCategoriesV2.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopCategoriesV2.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopCategoriesV2.pglite.mjs
 *
 * Setup copied from shopsProfiles.pglite.mjs (prod-shaped stubs, the newest
 * helper definitions read from the migrations, the switches and Declutter's
 * foundation), then shops slice 1 ONCE (as prod has it), shops on removed and
 * kept categories, then this migration 3x (replay-safety).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}20261017224153_shop_categories_v2.sql`,
  "utf8",
);
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017224153")).sort()) {
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
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

await db.exec(SLICE1);
// Shops as rows (the RPC path is slice 1's proof; this one is about the list).
await db.exec(`
  INSERT INTO public.shops (owner_id, name, category, area_label, pin_lat, pin_lng) VALUES
    ('${OWNER}', 'Bayou Brew', 'coffee', 'Broussard', 30.15, -91.96),
    ('${FAN}', 'Sno Shack', 'snowballs', 'Youngsville', 30.10, -92.00),
    ('${MINOR}', 'Cake Lady', 'cakes', 'Scott', 30.24, -92.09),
    ('${STRUCK}', 'Acadiana Realty', 'real_estate', 'Lafayette', 30.22, -92.02),
    ('${ORDINARY}', 'Teche Bakes', 'bakery', 'New Iberia', 30.00, -91.82),
    ('${SEEDY}', 'Party Time', 'party_rentals', 'Carencro', 30.32, -92.05);`);
ok(one(await svc(`SELECT count(*)::int AS n FROM public.shop_categories`)) === 79, "setup: slice 1 seeds 79 categories");

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

ok(one(await svc(`SELECT count(*)::int AS n FROM public.shop_categories`)) === 80, "80 categories after 3 runs");
ok(one(await svc(`SELECT count(*)::int AS n FROM public.shop_categories WHERE slug IN
  ('food_truck','restaurant','coffee','snowballs','farmers_market','driving_school','real_estate','insurance','cakes','gym')`)) === 0,
  "food truck, restaurant, coffee, snowballs, farmers market, driving school, real estate, insurance, gym and cakes are gone");
ok(one(await svc(`SELECT string_agg(label, ',' ORDER BY position) AS l FROM public.shop_categories WHERE group_label = 'Food to order'`))
  === "Bakery and cakes,Catering,Crawfish and seafood,BBQ and smoked meats,Meal prep,Home kitchen", "Food to order, in order");
ok(one(await svc(`SELECT string_agg(label, ',' ORDER BY position) AS l FROM public.shop_categories WHERE group_slug = 'events_party'`))
  === "DJ,Photography,Videography,Venues,Decor,Florist,Party rentals,Bounce houses,Tables, chairs and tents", "Events and party is one group, in order");
ok(one(await svc(`SELECT group_label FROM public.shop_categories WHERE slug = 'equipment_rental'`)) === "Trades", "Equipment rental sits in Trades");
ok(one(await svc(`SELECT count(DISTINCT group_slug)::int AS n FROM public.shop_categories`)) === 13
  && one(await svc(`SELECT count(*)::int AS n FROM (SELECT group_slug FROM public.shop_categories GROUP BY group_slug HAVING count(DISTINCT group_label) > 1) g`)) === 0,
  "13 groups, each with one label");
ok(one(await svc(`SELECT string_agg(name || ':' || category, ',' ORDER BY name) AS l FROM public.shops`))
  === "Acadiana Realty:other,Bayou Brew:other,Cake Lady:bakery,Party Time:party_rentals,Sno Shack:other,Teche Bakes:bakery",
  "shops on removed slugs moved (cakes to bakery, the rest to other); kept ones untouched");
const fk = await svc(`INSERT INTO public.shops (owner_id, name, category, area_label, pin_lat, pin_lng) VALUES ('${ADMIN}', 'New Truck', 'food_truck', 'Lafayette', 30.22, -92.02)`);
ok(!Array.isArray(fk) && /foreign key/i.test(fk.error), "a new shop cannot pick a removed category (foreign key)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
