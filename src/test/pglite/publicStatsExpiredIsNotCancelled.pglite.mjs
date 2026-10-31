#!/usr/bin/env node
/**
 * PGlite proof for 20261031234653_public_stats_expired_is_not_cancelled.sql (owner 10-31 ~18:30:
 * a job that expired with no Helpr is not a cancellation, "people shouldnt see on my profile that
 * the job was cancelled").
 *
 *   node src/test/pglite/publicStatsExpiredIsNotCancelled.pglite.mjs
 *   LH_SKIP=1 node src/test/pglite/publicStatsExpiredIsNotCancelled.pglite.mjs   # must FAIL (old definition)
 *
 * World: the cut-down tables of testDataNeverCounts.pglite.mjs. 20261030015205 (the newest
 * definition before this one) is applied once, then the new migration verbatim 3x (replay).
 * A poster has: one listing auto-expire-jobs closed (cancelled, no Helpr, its fixed reason), one
 * real cancellation (no reason), one cancelled job that HAD a Helpr (still a cancellation even
 * with that reason) and two completed jobs. cancelled_jobs must be 2, posted_jobs_total 5, the rate 40.0.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(DIR + "20261030015205_test_data_never_counts.sql", "utf8");
const SQL = readFileSync(DIR + "20261031234653_public_stats_expired_is_not_cancelled.sql", "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), REAL_H = U(2), TEST_H = U(3), REAL_C = U(4), TEST_C = U(5), REAL_C2 = U(6), REAL_C3 = U(7), POSTER = U(8);
const OPEN_JOB = U(60);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${ADMIN}'::uuid $$;
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
  CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false,
    email text, email_verified boolean DEFAULT true, ban_status text, idv_status text, stripe_account_id text,
    background_check_status text, latitude numeric DEFAULT 30, longitude numeric DEFAULT -90, full_name text, parish text, avatar_url text);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_seed_email(p_email text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = lower(btrim(p_email)) AND p.is_seed IS TRUE) $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, category text DEFAULT 'cleaning', status text,
    is_group_job boolean DEFAULT false, is_seed boolean DEFAULT false, helper_arrived_at timestamptz, date_needed date,
    start_time time, revision_count int);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid, job_latitude numeric DEFAULT 30, job_longitude numeric DEFAULT -90);
  CREATE TABLE public.reviews (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int,
    status text DEFAULT 'published', feedback_visible_at timestamptz DEFAULT now() - interval '1 day', created_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text, handed_over_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.declutter_reviews (id serial, order_id uuid, reviewer_id uuid, reviewee_id uuid, stars int, is_seed boolean DEFAULT false);
  CREATE TABLE public.helper_credentials (user_id uuid, status text);
  CREATE TABLE public.job_views (id serial, job_id uuid, viewer_id uuid);
  CREATE TABLE public.job_match_queue (id serial, job_id uuid, user_id uuid, status text);
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
  CREATE TABLE public.sms_consent (user_id uuid, sms_opt_in boolean, pending_phone text, pending_since timestamptz);
  CREATE TABLE public.sms_messages (id serial, user_id uuid, category text, kind text, status text, reason text, provider_error_code text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.signup_leads (id serial, email text, created_at timestamptz DEFAULT now(), reminder_sent_at timestamptz, completed_at timestamptz);
  CREATE TABLE public.category_suggestions (id uuid DEFAULT gen_random_uuid(), user_id uuid, suggested_in text, suggestion text, normalized text,
    status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), reviewed_at timestamptz, admin_note text);
  CREATE TABLE public.rental_properties (id uuid PRIMARY KEY, owner_id uuid, label text, city text, zip_code text,
    listings_taken_down_reason text, listings_taken_down_at timestamptz);
  CREATE TABLE public.rental_listings (id uuid DEFAULT gen_random_uuid(), property_id uuid, owner_id uuid, kind text, status text, headline text, slug text, published_at timestamptz);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, name text);
  CREATE TABLE public.shop_items (id uuid DEFAULT gen_random_uuid(), shop_id uuid, owner_id uuid, kind text, subtype text, title text, description text,
    price_cents int, submitted_at timestamptz, status text, admin_approved_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.shop_item_private (item_id uuid, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text);
  CREATE TABLE public.shop_item_photos (item_id uuid, storage_path text, position int);
  CREATE TABLE public.admin_audit_log (action text, details jsonb, created_at timestamptz);

  INSERT INTO public.profiles (user_id, is_seed, email) VALUES
    ('${ADMIN}', false, 'admin@x.com'), ('${REAL_H}', false, 'h@x.com'), ('${TEST_H}', true, 'th@x.com'),
    ('${REAL_C}', false, 'c@x.com'), ('${TEST_C}', true, 'tc@x.com'), ('${REAL_C2}', false, 'c2@x.com'),
    ('${REAL_C3}', false, 'c3@x.com'), ('${POSTER}', false, 'p@x.com');
  INSERT INTO public.test_accounts VALUES ('${TEST_H}'), ('${TEST_C}');
`);

await db.exec(`ALTER TABLE public.jobs ADD COLUMN cancellation_reason text;`);
await db.exec(BASE);
if (process.env.LH_SKIP !== "1") for (let i = 0; i < 3; i++) await db.exec(SQL);

const EXPIRED = "Job listing expired — scheduled time passed with no Helpr assigned";
await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, status, cancellation_reason) VALUES
  ('${U(40)}', '${POSTER}', NULL, 'cancelled', '${EXPIRED}'),
  ('${U(41)}', '${POSTER}', NULL, 'cancelled', NULL),
  ('${U(42)}', '${POSTER}', '${REAL_H}', 'cancelled', '${EXPIRED}'),
  ('${U(43)}', '${POSTER}', '${REAL_H}', 'completed', NULL),
  ('${U(44)}', '${POSTER}', '${REAL_H}', 'completed', NULL);`);

const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); };

const r = (await db.query(`SELECT posted_jobs_total, jobs_total, cancelled_jobs, cancellation_rate::text AS rate
  FROM public.get_public_profile_stats(ARRAY['${POSTER}']::uuid[])`)).rows[0];
check("the expired, unfilled listing is not counted as cancelled (2 real cancellations)", r.cancelled_jobs === 2, r);
check("posted total still counts every posted job (5)", r.posted_jobs_total === 5, r);
check("the cancellation rate is 2 of 5 (40.0), not 3 of 5", r.rate === "40.0", r);

// The Helpr side: REAL_H's cancelled job (U42, they were hired) still counts for them.
const h = (await db.query(`SELECT cancelled_jobs FROM public.get_public_profile_stats(ARRAY['${REAL_H}']::uuid[])`)).rows[0];
check("a cancelled job with a Helpr still counts for that Helpr", h.cancelled_jobs === 1, h);

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
