#!/usr/bin/env node
/**
 * PGlite proof for 20261030015205_test_data_never_counts.sql (owner rule via lead 2026-10-29,
 * builder 62: test data never counts in any number).
 *
 *   node src/test/pglite/testDataNeverCounts.pglite.mjs
 *   LH_MUTANT=1 node src/test/pglite/testDataNeverCounts.pglite.mjs   # must FAIL (vacuity)
 *
 * The whole migration file, verbatim, applied 3x (replay). Tables are cut down to the columns the
 * restated functions read; auth.uid(), has_role(), require_feature() and is_caller_banned() are
 * stubs driven by session settings. For every restated function: one REAL record and one TEST
 * record (a test job, a test account's row, or a test account as the subject), and the total must
 * count the real one only, for any caller, including the test member themself. Lists keep the
 * test rows. The helper has no client grant.
 *
 * LH_MUTANT=1 rewrites the fix away (is_test_member always false, every `is_seed IS NOT TRUE`
 * true) before applying, so each check is shown able to fail.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
let SQL = readFileSync(DIR + "20261030015205_test_data_never_counts.sql", "utf8");
if (process.env.LH_MUTANT === "1") {
  SQL = SQL.replace(/SELECT p_user_id IS NOT NULL AND \(/, "SELECT false AND (")
    .replace(/(\w+\.)?is_seed IS NOT TRUE/g, "true")
    .replace(/NOT public\.is_seed_email\(l\.email\)/g, "true");
}

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

// Completed jobs. Real Helpr: 6 real jobs for 3 real customers (one repeat), on time; plus 3 test
// jobs and 3 jobs for a test customer (both must vanish). Test Helpr: 6 real-shaped jobs.
let n = 10;
const job = (cust, helper, { seed = false, status = "completed" } = {}) => {
  const id = U(n++);
  return `('${id}', '${cust}', '${helper}', 'cleaning', '${status}', false, ${seed}, now() - interval '3 days', (now() - interval '3 days')::date, NULL, 0)`;
};
const rows = [
  job(REAL_C, REAL_H), job(REAL_C, REAL_H), job(REAL_C2, REAL_H), job(REAL_C3, REAL_H), job(REAL_C2, REAL_H), job(REAL_C3, REAL_H),
  job(REAL_C, REAL_H, { seed: true }), job(REAL_C2, REAL_H, { seed: true }), job(REAL_C3, REAL_H, { seed: true }),
  job(TEST_C, REAL_H), job(TEST_C, REAL_H), job(TEST_C, REAL_H),
  job(REAL_C, TEST_H), job(REAL_C2, TEST_H), job(REAL_C3, TEST_H), job(REAL_C, TEST_H), job(REAL_C2, TEST_H), job(REAL_C3, TEST_H),
];
await db.exec(`INSERT INTO public.jobs VALUES ${rows.join(",")};
  INSERT INTO public.jobs (id, customer_id, status, category) VALUES ('${OPEN_JOB}', '${POSTER}', 'open', 'cleaning');
  INSERT INTO public.applications (job_id, helper_id) VALUES ('${OPEN_JOB}', '${REAL_H}'), ('${OPEN_JOB}', '${TEST_H}');
  -- a real review on a real job, a review on a test job, a review from a test customer
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES
    ('${U(10)}', '${REAL_C}', '${REAL_H}', 5), ('${U(16)}', '${REAL_C}', '${REAL_H}', 1), ('${U(19)}', '${TEST_C}', '${REAL_H}', 1);
  INSERT INTO public.declutter_orders VALUES ('${U(70)}', 'handed_over', now() - interval '30 days', false), ('${U(71)}', 'handed_over', now() - interval '30 days', true);
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, stars, is_seed) VALUES
    ('${U(70)}', '${REAL_C}', '${REAL_H}', 5, false), ('${U(71)}', '${TEST_C}', '${REAL_H}', 1, true);
  INSERT INTO public.job_views (job_id, viewer_id) VALUES ('${OPEN_JOB}', '${REAL_H}'), ('${OPEN_JOB}', '${TEST_H}'), ('${OPEN_JOB}', '${TEST_C}');
  INSERT INTO public.job_match_queue (job_id, user_id, status) VALUES ('${OPEN_JOB}', '${REAL_H}', 'sent'), ('${OPEN_JOB}', '${TEST_H}', 'sent');
  INSERT INTO public.sms_consent VALUES ('${REAL_H}', true, NULL, NULL), ('${TEST_H}', true, '+1', now()), ('${REAL_C}', false, '+1', now());
  INSERT INTO public.sms_messages (user_id, status) VALUES ('${REAL_H}', 'sent'), ('${TEST_H}', 'sent'), ('${TEST_H}', 'failed'), ('${TEST_H}', 'pending');
  INSERT INTO public.signup_leads (email) VALUES ('new@x.com'), ('TH@x.com');
  INSERT INTO public.category_suggestions (user_id, suggested_in, suggestion, normalized) VALUES
    ('${REAL_H}', 'jobs', 'Gutters', 'gutters'), ('${TEST_H}', 'jobs', 'gutters', 'gutters'), ('${TEST_C}', 'jobs', 'Gutters!', 'gutters');
  INSERT INTO public.rental_properties (id, owner_id, label) VALUES ('${U(80)}', '${REAL_C}', 'Real'), ('${U(81)}', '${TEST_C}', 'Test');
  UPDATE public.rental_properties SET listings_taken_down_at = now();
  INSERT INTO public.rental_listings (property_id, owner_id, status, headline, slug, published_at) VALUES
    ('${U(80)}', '${REAL_C}', 'live', 'Real flat', 'real', now()), ('${U(81)}', '${TEST_C}', 'live', 'Test flat', 'test', now());
  INSERT INTO public.shops VALUES ('${U(90)}', 'Shop');
  INSERT INTO public.shop_items (shop_id, owner_id, status, admin_approved_at, is_seed, title) VALUES
    ('${U(90)}', '${REAL_C}', 'approved', now(), false, 'a'), ('${U(90)}', '${REAL_C}', 'approved', now(), true, 'b'),
    ('${U(90)}', '${REAL_C}', 'pending_review', NULL, false, 'c'), ('${U(90)}', '${REAL_C}', 'pending_review', NULL, true, 'd');
`);

for (let i = 0; i < 3; i++) await db.exec(SQL);

const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); };
const as = async (uid) => db.exec(`SET test.uid = '${uid ?? ""}'`);
const one = async (sql) => (await db.query(sql)).rows;

for (const caller of [null, REAL_C, TEST_H, ADMIN]) {
  await as(caller);
  const who = caller === TEST_H ? "the test Helpr" : caller === ADMIN ? "an admin" : caller ? "a member" : "anon";
  const cc = await one(`SELECT user_id::text, completed_jobs::int AS n FROM public.get_helper_completed_counts(ARRAY['${REAL_H}','${TEST_H}']::uuid[]) ORDER BY 1`);
  check(`completed counts (${who}): the real Helpr has 6 real jobs, the test Helpr has none`,
        cc.length === 1 && cc[0].user_id === REAL_H && cc[0].n === 6, cc);
  const st = await one(`SELECT user_id::text, review_count, completed_jobs_total, completed_jobs_as_helper, jobs_total, on_time_sample, repeat_client_sample
                          FROM public.get_public_profile_stats(ARRAY['${REAL_H}','${TEST_H}']::uuid[]) ORDER BY 1`);
  const r = st.find((x) => x.user_id === REAL_H), t = st.find((x) => x.user_id === TEST_H);
  check(`profile stats (${who}): real Helpr counts 6 real jobs, 2 real reviews, 3 real clients`,
        r && r.completed_jobs_total === 6 && r.completed_jobs_as_helper === 6 && r.jobs_total === 6
          && r.on_time_sample === 6 && r.repeat_client_sample === 3 && r.review_count === 2, r);
  if (t) check(`profile stats (${who}): the test Helpr's own totals are all zero`,
               t.completed_jobs_total === 0 && t.review_count === 0 && t.on_time_sample === 0 && t.repeat_client_sample === 0, t);
}

await as(REAL_C);
const ot = await one(`SELECT user_id::text, on_time_percent::int AS p FROM public.get_helper_on_time_percents(ARRAY['${REAL_H}','${TEST_H}']::uuid[])`);
check("on-time %: only the real Helpr (6 real samples), not the test Helpr", ot.length === 1 && ot[0].user_id === REAL_H, ot);
const rh = await one(`SELECT user_id::text, repeat_hire_percent::int AS p FROM public.get_helper_repeat_hire_percents(ARRAY['${REAL_H}','${TEST_H}']::uuid[])`);
check("repeat hire %: real Helpr 100% over 3 real clients (the test Helpr has no row)",
      rh.length === 1 && rh[0].user_id === REAL_H && rh[0].p === 100, rh);
const urh = await one(`SELECT public.get_user_repeat_hire_percent('${REAL_H}')::int AS p, public.get_user_repeat_hire_percent('${TEST_H}') AS t`);
check("single repeat hire %: real Helpr 100 (3 of 3 real clients), test Helpr NULL", urh[0].p === 100 && urh[0].t === null, urh);

await as(POSTER);
const vc = await one(`SELECT view_count::int AS n FROM public.get_job_view_counts(ARRAY['${OPEN_JOB}']::uuid[])`);
check("job views: 1 real viewer, the 2 test viewers do not count", vc.length === 1 && vc[0].n === 1, vc);
const reach = await one(`SELECT public.get_job_match_reach('${OPEN_JOB}') AS n`);
check("job reach: 1 real Helpr reached, the test Helpr does not count", reach[0].n === 1, reach);
const cat = await one(`SELECT helper_id::text, category_completed::int AS n FROM public.get_applicant_category_counts('${OPEN_JOB}') ORDER BY 1`);
check("applicant category counts: real applicant 6, test applicant absent",
      cat.length === 1 && cat[0].helper_id === REAL_H && cat[0].n === 6, cat);
const nb = await one(`SELECT public.get_neighbor_hire_count('${REAL_H}', '${OPEN_JOB}') AS n, public.get_neighbor_hire_count('${TEST_H}', '${OPEN_JOB}') AS t`);
check("neighbour hires: real Helpr 3 real neighbours (not the test customer), test Helpr 0", nb[0].n === 3 && nb[0].t === 0, nb);

await as(ADMIN);
const tiers = await one(`SELECT user_id::text, completed_jobs, total_reviews FROM public.get_helper_tiers(25) ORDER BY 1`);
check("admin tiers: the test Helpr is not on the board; the real Helpr has 6 real jobs and 1 real review",
      tiers.length === 1 && tiers[0].user_id === REAL_H && tiers[0].completed_jobs === 6 && tiers[0].total_reviews === 1, tiers);
const sms = (await one(`SELECT public.admin_sms_status() AS s`))[0].s;
check("admin SMS totals: opted_in 1, pending 1 (real only), waiting 0, sent 1, failed 0; recent list keeps all 4",
      sms.opted_in === 1 && sms.pending === 1 && sms.waiting === 0 && sms.sent_24h === 1 && sms.failed_24h === 0 && sms.recent.length === 4, sms);
const leads = await one(`SELECT email, total_count::int AS n FROM public.admin_list_signup_leads()`);
check("signup leads: the list keeps both, the total is 1", leads.length === 2 && leads.every((l) => l.n === 1), leads);
const sug = await one(`SELECT same_count::int AS n FROM public.admin_list_category_suggestions('pending')`);
check("category suggestions: list keeps 3 rows, 'asked by' counts 1 real member", sug.length === 3 && sug.every((s) => s.n === 1), sug);
const rent = (await one(`SELECT public.rentals_admin_listings(NULL, 0, 0) AS r`))[0].r;
check("rentals admin: totals 1 and 1, lists keep both rows, no helper column leaks",
      rent.open_total === 1 && rent.taken_down_total === 1 && rent.open.length === 2 && rent.taken_down.length === 2
        && !("is_test" in rent.open[0]), rent);
const shop = await one(`SELECT title, approved_items FROM public.shops_admin_pending_items() ORDER BY title`);
check("shop pending: list keeps both pending items, approved count is 1 (the test item does not count)",
      shop.length === 2 && shop.every((s) => s.approved_items === 1), shop);

const acl = await one(`SELECT has_function_privilege('authenticated', 'public.is_test_member(uuid)', 'EXECUTE') AS a,
                              has_function_privilege('anon', 'public.is_test_member(uuid)', 'EXECUTE') AS b`);
check("is_test_member: no EXECUTE for authenticated or anon", acl[0].a === false && acl[0].b === false, acl);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed${process.env.LH_MUTANT === "1" ? " (MUTANT run: failures expected)" : ""}`);
process.exit(failed ? 1 : 0);
