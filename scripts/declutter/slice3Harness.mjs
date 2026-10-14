/**
 * Shared prod-shaped setup for the Declutter slice 3 proofs:
 *   src/test/pglite/declutterSlice3.pglite.mjs   (serial rules, PGlite)
 *   scripts/declutter/race-accept.mjs            (real concurrent sessions)
 *
 * setupStatements({ slice3, times }) returns the SQL to run in order:
 * prod-shaped stubs (roles + prod's default function ACL: anon/authenticated
 * EXECUTE on every new function, so a REVOKE that forgets anon is caught;
 * auth.users/auth.uid(); storage.objects; profiles with the gate columns;
 * user_roles/has_role; test_accounts; admin_audit_log; user_blocks;
 * notifications with its live columns, read 2026-10-14), the NEWEST
 * definitions of the helpers the migrations call (read out of
 * supabase/migrations, any dollar tag), the hidden-switch migration,
 * slice 1 and slice 2 once (as prod will hold them), the switch at 'testers',
 * then the slice 3 migration `times` times (0 = the RED baseline).
 */
import { readFileSync, readdirSync } from "node:fs";

const MIG_DIR = new URL("../../supabase/migrations/", import.meta.url).pathname;
const SLICE1_FILE = "20261014193955_declutter_foundation.sql";
const SLICE2_FILE = "20261014200728_declutter_slice2_followups.sql";
export const SLICE3_FILE = "20261014210518_declutter_slice3_offers_checkout.sql";
const LOADED_BY_HAND = [SLICE1_FILE, SLICE2_FILE, SLICE3_FILE].map((f) => f.slice(0, 14));

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
export function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !LOADED_BY_HAND.some((s) => x.startsWith(s))).sort()) {
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

export const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
export const USERS = {
  SELLER: U(1), BUYER: U(2), OUTSIDER: U(3), MINOR: U(4), BANNED: U(5), STRUCK: U(6),
  NOPAYOUT: U(7), ADMIN: U(8), BUYER2: U(9), BUYER3: U(10), SELLER2: U(11), NOCARD: U(12), SELLER3: U(13),
};

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
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
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
-- Live columns of public.notifications (information_schema, prod, 2026-10-14).
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL, type text NOT NULL, read boolean NOT NULL DEFAULT false, link text,
  created_at timestamptz NOT NULL DEFAULT now(), job_id uuid);
`;

const HELPER_ACLS = `
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;`;

const { SELLER, BUYER, OUTSIDER, MINOR, BANNED, STRUCK, NOPAYOUT, ADMIN, BUYER2, BUYER3, SELLER2, NOCARD, SELLER3 } = USERS;
// seed-policy: not prod (throwaway PGlite / embedded Postgres only)
const PEOPLE = `
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 13) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status, is_seed) VALUES
    ('${SELLER}',   'acct_s', true,  '1990-01-01', 'active', false),
    ('${BUYER}',    'acct_b', true,  '1991-01-01', 'active', false),
    ('${OUTSIDER}', 'acct_o', true,  '1992-01-01', 'active', false),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active', false),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned', false),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active', false),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active', false),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active', false),
    ('${BUYER2}',   'acct_2', true,  '1993-01-01', 'active', false),
    ('${BUYER3}',   'acct_3', true,  '1994-01-01', 'active', false),
    ('${SELLER2}',  'acct_4', true,  '1985-01-01', 'active', false),
    ('${NOCARD}',   'acct_5', true,  '1986-01-01', 'active', false),
    ('${SELLER3}',  'acct_6', true,  '1987-01-01', 'active', true);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  -- Testers: everyone but OUTSIDER (the switch is 'testers').
  INSERT INTO public.test_accounts (user_id)
    SELECT id FROM auth.users WHERE id <> '${OUTSIDER}';`;

export function setupStatements({ times = 3, slice3Path } = {}) {
  const read = (f) => readFileSync(`${MIG_DIR}${f}`, "utf8");
  const out = [SCHEMA];
  for (const name of ["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason", "are_users_blocked"]) {
    out.push(newestDefinition(name).stmt);
  }
  out.push(HELPER_ACLS);
  out.push(read("20261012031120_hidden_feature_switches.sql"));
  out.push(PEOPLE);
  out.push(read(SLICE1_FILE));
  out.push(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter';`);
  out.push(read(SLICE2_FILE));
  const slice3 = readFileSync(slice3Path ?? `${MIG_DIR}${SLICE3_FILE}`, "utf8");
  for (let i = 0; i < times; i++) out.push(slice3);
  return out;
}

/** SQL inserting a LIVE offers-mode listing (as publish leaves it), live for `liveHoursAgo` hours. */
// seed-policy: not prod (throwaway PGlite / embedded Postgres only)
export function liveItemSql({ id, seller = SELLER, title = "Oak rocking chair", price = 4000, floor = 2000, liveHoursAgo = 24 }) {
  return `
    INSERT INTO public.declutter_items (id, seller_id, status, title, description, category, condition_stars, delivery_size,
      price_cents, current_price_cents, area_label, area_lat, area_lng, live_at, submitted_at, admin_approved_at)
    VALUES ('${id}', '${seller}', 'live', '${title}', 'Solid.', 'furniture', 4, 'large', ${price}, ${price},
      'Mid-City, Baton Rouge', 30.45, -91.15, now() - interval '${liveHoursAgo} hours', now() - interval '${liveHoursAgo} hours', now());
    INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
    VALUES ('${id}', '${seller}', ${floor}, '1234 Example St, Baton Rouge, LA 70806', 30.451234, -91.154321);`;
}

/** Saved cards (row 36) for everyone who may offer, except NOCARD and OUTSIDER. */
export const CARDS_SQL = `
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, brand, last4)
  SELECT u, 'cus_' || substr(md5(u::text), 1, 10), 'pm_' || substr(md5(u::text), 1, 10), 'visa', '4242'
    FROM unnest(ARRAY['${BUYER}', '${BUYER2}', '${BUYER3}', '${MINOR}', '${STRUCK}', '${BANNED}', '${SELLER}', '${SELLER2}']::uuid[]) u;`;
