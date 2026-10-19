#!/usr/bin/env node
/**
 * PGlite proof for "Sell it for me" (owner order 2026-10-19 ~21Z):
 *   20261019210635_add_declutter_help_job_category  (job_category gains 'declutter_help')
 *   20261019210636_shop_category_declutter_estate_sales  (one Shops category, a plain upsert)
 *
 *   node src/test/pglite/sellItForMe.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sellItForMe.pglite.mjs   # RED
 *
 * Setup copied from shopCategoriesV2.pglite.mjs (prod-shaped stubs, shops
 * slice 1 and v2 as prod has them), then each new migration 3x, each run in
 * its own transaction as db-deploy applies it (replay-safety), then the value
 * is used in a later transaction (ADD VALUE cannot be used in its own).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const V2 = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const ENUM_ADD = readFileSync(`${MIG_DIR}20261019210635_add_declutter_help_job_category.sql`, "utf8");
const SHOP_CAT = readFileSync(`${MIG_DIR}20261019210636_shop_category_declutter_estate_sales.sql`, "utf8");
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
  -- HISTORICAL fixture (L45 shared count as of v2.2); Shops reads its own count since 20261018164444.
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
await db.exec(V2);
// The enum as prod has it before this change (types.ts before 2026-10-19).
await db.exec(`CREATE TYPE public.job_category AS ENUM ('cleaning','yard_work','moving','errands','handyman','painting','delivery',
  'pet_care','assembly','other','storm_prep','events','electrical','plumbing','hvac','roofing','welding','carpentry','auto_repair',
  'appliance_repair','flooring','concrete_masonry','fencing','pressure_washing');
  CREATE TABLE public.sfm_jobs (id serial PRIMARY KEY, category public.job_category NOT NULL);`);
const before = one(await svc(`SELECT count(*)::int AS n FROM public.shop_categories`));
ok(before === 80, `setup: v2 leaves 80 categories (got ${before})`);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) {
    await db.exec(`BEGIN;\n${ENUM_ADD}\nCOMMIT;`);
    await db.exec(`BEGIN;\n${SHOP_CAT}\nCOMMIT;`);
  }
}

ok(one(await svc(`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'job_category' AND e.enumlabel = 'declutter_help'`)) === 1, "job_category has declutter_help exactly once after 3 runs");
ok(one(await svc(`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'job_category'`)) === 25,
  "nothing else changed in the enum (24 + 1)");
const used = await svc(`INSERT INTO public.sfm_jobs (category) VALUES ('declutter_help') RETURNING category::text AS c`);
ok(Array.isArray(used) && used[0]?.c === "declutter_help", "a job can be posted in declutter_help (later transaction)");
ok(one(await svc(`SELECT count(*)::int AS n FROM public.shop_categories`)) === 81, "81 shop categories after 3 runs (one added, none removed)");
ok(one(await svc(`SELECT group_slug || '|' || group_label || '|' || label || '|' || position AS r FROM public.shop_categories WHERE slug = 'declutter_estate_sales'`))
  === "home_services|Home services|Declutter and estate sale services|211", "the category sits in Home services after Window washing");
ok(one(await svc(`SELECT string_agg(label, ',' ORDER BY position) AS l FROM public.shop_categories WHERE group_slug = 'home_services'`))
  === "Cleaning,Lawn and landscaping,Pressure washing,Pest control,Pool,Moving,Junk removal,Organizing,Tree service,Gutters,Window washing,Declutter and estate sale services",
  "Home services, in order");
const made = await svc(`INSERT INTO public.shops (owner_id, name, category, area_label, pin_lat, pin_lng)
  VALUES ('${ADMIN}', 'Bayou Consignment', 'declutter_estate_sales', 'Lafayette', 30.22, -92.02) RETURNING category`);
ok(Array.isArray(made) && made[0]?.category === "declutter_estate_sales", "a shop can pick the new category (foreign key holds)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
