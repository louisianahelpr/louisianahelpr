/**
 * The prod-shaped PGlite world shared by the two proofs of
 * 20261007033530_seed_switch_hides_test_profiles (Q552):
 * seedSwitchHidesProfiles.pglite.mjs (test PROFILES and reviews) and
 * seedSwitchTestAccounts.pglite.mjs (test JOBS for test accounts). Every
 * function the migration restates is loaded from its EFFECTIVE definition
 * before the migration; tables are stubs carrying the columns those bodies
 * read (sql-language bodies are validated at CREATE); helpers as in
 * crewFreeSpotRelisted.pglite.mjs. The migration is applied by the proof.
 */
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
export const THIS = "20261007033530_seed_switch_hides_test_profiles.sql";
export const MIGRATION = readFileSync(DIR + THIS, "utf8");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
/** The newest open_jobs_browse statement before this migration (a DO $view$ block). */
function viewBefore() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    const at = raw.indexOf("DO $view$\nBEGIN\n  IF to_regclass('public.open_jobs_browse') IS NULL THEN");
    if (at >= 0) found = raw.slice(at, raw.indexOf("$view$;", at) + "$view$;".length);
  }
  if (!found) throw new Error("no open_jobs_browse statement before this migration");
  return found.replace("IF to_regclass('public.open_jobs_browse') IS NULL THEN", "IF false THEN");
}
const FNS = [
  "is_server_context", "has_role", "identity_is_verified", "seed_jobs_hidden_publicly", "job_offer_cutoff", "crew_spots_open",
  "get_ranked_open_jobs", "search_profiles_by_name", "get_safe_profiles", "get_public_profile_stats", "get_parish_activity", "get_public_profile_reviews", "get_open_jobs_for_map", "get_public_open_jobs", "apply_to_job", "enforce_application_job_state",
];

export const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, created_at timestamptz DEFAULT now() - interval '30 days');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TYPE public.job_category AS ENUM ('cleaning','moving','yard_work','other');
CREATE TABLE public.platform_settings (id int PRIMARY KEY DEFAULT 1, feature_flags jsonb NOT NULL DEFAULT '{}', updated_at timestamptz DEFAULT now());
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'moving', budget numeric,
  date_needed date, location text DEFAULT '123 Main St, Lafayette', is_urgent boolean DEFAULT false, urgent_fee numeric DEFAULT 0,
  is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false, is_group_job boolean DEFAULT false,
  helpers_needed integer DEFAULT 1, estimated_hours numeric, start_time time, photos text[], special_requirements text,
  status public.job_status NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '3 days',
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text DEFAULT 'fixed', latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text DEFAULT 'Lafayette',
  credential_tier integer DEFAULT 0, require_photo_proof boolean DEFAULT false, recurrence_days integer[], recurrence_weeks integer,
  series_split_ok boolean, is_seed boolean DEFAULT false,
  poster_completed_at timestamptz, helper_completed_at timestamptz, platform_fee_amount numeric, customer_fee_amount numeric,
  revision_count int, helper_arrived_at timestamptz);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, slot_no integer, share_cents integer, helper_arrived_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id), helper_id uuid,
  status text, message text, created_at timestamptz DEFAULT now(), closed_reason text, offer_message text);
CREATE TABLE public.profiles (
  id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, avatar_url text, bio text, location text, skills text,
  hourly_rate numeric, subscription_tier text, subscription_expires_at timestamptz, portfolio_urls text[], created_at timestamptz DEFAULT now(),
  idv_status text, stripe_identity_verified boolean, stripe_account_id text, stripe_payouts_enabled boolean,
  is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text,
  email_verified boolean DEFAULT true, ban_status text, anonymized_at timestamptz, background_check_status text,
  parish text DEFAULT 'Lafayette', latitude numeric, longitude numeric, is_seed boolean DEFAULT false);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_id uuid, reviewee_id uuid, job_id uuid,
  rating int, status text, feedback text, feedback_visible_at timestamptz, response_text text, response_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.helper_credentials (user_id uuid, status text);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.profile_search_rate_log (searcher_id uuid, created_at timestamptz DEFAULT now());
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE FUNCTION public.mask_job_location(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Lafayette area'::text $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.get_user_credential_tier(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.job_payment_is_funded(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('escrow','payout_pending','released') $$;
CREATE FUNCTION public.application_cap(text) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT NULL::integer $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 1::numeric $$;
CREATE FUNCTION public.user_may_see_job_address(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

${FNS.map(fnStmt).join("\n\n")}

${triggerStmt("trg_application_job_state")}

${viewBefore()}
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
`;
