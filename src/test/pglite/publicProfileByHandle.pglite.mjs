#!/usr/bin/env node
/**
 * PGlite proof for 20261101041833_public_profile_by_handle (LEAD-PROFILE-LINK step 2, owner 2026-10-31 ~10:50 PM,
 * OWNER-DECISIONS "Shareable profile link": guests see the full profile; never addresses, exact locations, contact
 * info, private/test data, expired or cancelled jobs).
 *
 *   npx tsx src/test/pglite/publicProfileByHandle.pglite.mjs [--replay] [--before]
 *
 * Prod-shaped stand-ins for the tables and helpers the function reads. mask_job_location is the REAL newest
 * definition, read from its migration. --before leaves the migration out and every check must FAIL (count
 * asserted); without it the migration is applied (3x with --replay).
 *
 *   P1  anon gets the page: public name "Eli B.", photo, member since, handle, stats from get_public_profile_stats
 *   P2  no contact, address, coordinate, storage path or user id anywhere in the answer
 *   P3  listings: live items only (not sold, reserved, hidden or test), card fields, cover photo id
 *   P4  jobs: own open jobs with the town only; never cancelled, expired (cutoff or expires_at), unfunded,
 *       credential-gated, series visits or test jobs
 *   P5  Helpr work: jobs done (no test jobs), categories, public reviews with the reviewer as "First L."
 *   P6  Wanted: public open posts only (not private, closed, expired, removed or test); no area point
 *   P7  no page for a test member (is_seed / test_accounts), banned, unverified, deleted or unknown handle
 *   P8  anon and a member get the same answer; anon holds EXECUTE
 *   P9  Declutter not open to everyone: no listings and no Wanted; declutter_wanted testers-only: no Wanted
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261101041833_public_profile_by_handle.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

// The newest real mask_job_location (any dollar-quote tag).
const maskFile = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS)
  .filter((f) => /FUNCTION public\.mask_job_location\(/.test(readFileSync(DIR + f, "utf8"))).sort().at(-1);
const maskSql = (() => {
  const t = readFileSync(DIR + maskFile, "utf8");
  const start = t.indexOf("CREATE OR REPLACE FUNCTION public.mask_job_location(");
  const tag = t.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = t.indexOf(tag, start) + tag.length;
  return t.slice(start, t.indexOf(tag, bodyStart) + tag.length) + ";";
})();

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ELI = U(1), SEED = U(2), TESTACC = U(3), BANNED = U(4), UNVER = U(5), GONE = U(6), BUYER = U(7), REVIEWER = U(8), TESTREV = U(9);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL, full_name text,
  avatar_url text, created_at timestamptz NOT NULL DEFAULT '2025-03-01T12:00:00Z', handle text, email_verified boolean NOT NULL DEFAULT true,
  ban_status text, is_seed boolean NOT NULL DEFAULT false, anonymized_at timestamptz, email text, phone text, location text, bio text);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, title text,
  current_price_cents int, area_label text, area_lat numeric, area_lng numeric, live_at timestamptz, created_at timestamptz DEFAULT now(),
  seller_hidden boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false, description text, pickup_address text);
CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, position int, storage_path text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text, title text,
  category text, location text, budget numeric, date_needed date, start_time time, parent_job_id uuid, is_seed boolean NOT NULL DEFAULT false,
  payment_status text, credential_tier int DEFAULT 0, expires_at timestamptz, offered_to_helper_id uuid, direct_offer_status text,
  latitude numeric, longitude numeric);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewee_id uuid, reviewer_id uuid, rating int, feedback text,
  created_at timestamptz DEFAULT now(), job_category text);
CREATE TABLE public.declutter_wanted (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, what text, category text,
  max_price_cents int, area_lat numeric, area_lng numeric, status text, public boolean, removed_at timestamptz,
  expires_at timestamptz, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.member_flags (user_id uuid, flag text);

CREATE FUNCTION public.is_test_member(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.is_seed IS TRUE)
    OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)) $$;
CREATE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor') RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(btrim(p_full_name), '') = '' THEN p_fallback
    WHEN array_length(regexp_split_to_array(btrim(p_full_name), '\\s+'), 1) > 1
      THEN (regexp_split_to_array(btrim(p_full_name), '\\s+'))[1] || ' ' || left((regexp_split_to_array(btrim(p_full_name), '\\s+'))[array_length(regexp_split_to_array(btrim(p_full_name), '\\s+'), 1)], 1) || '.'
    ELSE btrim(p_full_name) END $$;
CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'declutter' AND s.audience = 'everyone') $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT (d + coalesce(t, '08:00'::time))::timestamptz $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.member_flags f WHERE f.user_id = u AND f.flag = 'out') $$;
CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.member_flags f WHERE f.user_id = u AND f.flag = 'minor') $$;
CREATE FUNCTION public.declutter_seller_hidden(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.member_flags f WHERE f.user_id = u AND f.flag = 'hidden') $$;
CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.user_id, 2, 4.50, 0, NULL::numeric, 2, 2, 3, 5, 0, 0, 2, 100, 0, NULL::numeric, 0, NULL::numeric, true, true, false, false
    FROM public.profiles p WHERE p.user_id = ANY(p_user_ids) $$;
CREATE FUNCTION public.get_public_profile_reviews(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, rating integer, feedback text, created_at timestamp with time zone, reviewer_name text, job_category text, response_text text, response_at timestamp with time zone, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id, r.rating, r.feedback, r.created_at, (SELECT rp.full_name FROM public.profiles rp WHERE rp.user_id = r.reviewer_id),
         r.job_category, NULL::text, NULL::timestamptz, count(*) OVER ()
    FROM public.reviews r WHERE r.reviewee_id = p_user_id ORDER BY r.created_at DESC LIMIT p_limit OFFSET p_offset $$;
${maskSql}

INSERT INTO public.feature_switches VALUES ('declutter', 'everyone'), ('declutter_wanted', 'everyone');
INSERT INTO public.profiles (user_id, full_name, avatar_url, handle, email, phone, location, bio) VALUES
  ('${ELI}', 'Eli Broussard', 'https://cdn.example/avatars/eli.jpg', 'eli-b', 'eli@example.com', '2255550199', '123 Main St, Baton Rouge, LA 70801', 'Call me at 2255550199'),
  ('${BUYER}', 'Bea Landry', NULL, 'bea-l', 'bea@example.com', NULL, NULL, NULL),
  ('${REVIEWER}', 'Rita Thibodeaux', NULL, NULL, 'rita@example.com', NULL, NULL, NULL),
  ('${TESTREV}', 'Tess Tester', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.profiles (user_id, full_name, handle, is_seed) VALUES ('${SEED}', 'Seed Person', 'seed-p', true);
INSERT INTO public.profiles (user_id, full_name, handle) VALUES ('${TESTACC}', 'Test Account', 'test-a');
INSERT INTO public.test_accounts VALUES ('${TESTACC}'), ('${TESTREV}');
INSERT INTO public.profiles (user_id, full_name, handle, ban_status) VALUES ('${BANNED}', 'Ban Ned', 'ban-n', 'permanently_banned');
INSERT INTO public.profiles (user_id, full_name, handle, email_verified) VALUES ('${UNVER}', 'Un Ver', 'un-v', false);
INSERT INTO public.profiles (user_id, full_name, handle, anonymized_at) VALUES ('${GONE}', 'Gone Away', 'gone-a', now());

INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents, area_label, area_lat, area_lng, live_at, seller_hidden, is_seed, description, pickup_address) VALUES
  ('${U(101)}', '${ELI}', 'live', 'Oak dresser', 12000, 'Mid City', 30.45, -91.15, now() - interval '1 day', false, false, 'Ring 2255550199', '123 Main St'),
  ('${U(102)}', '${ELI}', 'sold', 'Sold lamp', 1500, 'Mid City', 30.45, -91.15, now() - interval '9 day', false, false, NULL, NULL),
  ('${U(103)}', '${ELI}', 'reserved', 'Reserved rug', 3000, 'Mid City', 30.45, -91.15, now() - interval '2 day', false, false, NULL, NULL),
  ('${U(104)}', '${ELI}', 'live', 'Hidden chair', 2000, 'Mid City', 30.45, -91.15, now(), true, false, NULL, NULL),
  ('${U(105)}', '${ELI}', 'live', 'Seed table', 2000, 'Mid City', 30.45, -91.15, now(), false, true, NULL, NULL);
INSERT INTO public.declutter_item_photos (id, item_id, position, storage_path) VALUES
  ('${U(201)}', '${U(101)}', 0, '${ELI}/items/oak.jpg'), ('${U(202)}', '${U(101)}', 1, '${ELI}/items/oak2.jpg');

INSERT INTO public.jobs (id, customer_id, status, title, category, location, budget, date_needed, start_time, payment_status, is_seed, expires_at, credential_tier, parent_job_id, latitude, longitude) VALUES
  ('${U(301)}', '${ELI}', 'open', 'Mow my yard', 'lawn_care', '123 Main St, Baton Rouge, LA 70801', 80, current_date + 3, '09:00', 'escrow', false, NULL, 0, NULL, 30.4512, -91.1871),
  ('${U(302)}', '${ELI}', 'cancelled', 'Cancelled job', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', false, NULL, 0, NULL, NULL, NULL),
  ('${U(303)}', '${ELI}', 'open', 'Past cutoff job', 'cleaning', 'Baton Rouge, LA', 50, current_date - 2, '09:00', 'escrow', false, NULL, 0, NULL, NULL, NULL),
  ('${U(304)}', '${ELI}', 'open', 'Expired job', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', false, now() - interval '1 hour', 0, NULL, NULL, NULL),
  ('${U(305)}', '${ELI}', 'open', 'Seed job', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', true, NULL, 0, NULL, NULL, NULL),
  ('${U(306)}', '${ELI}', 'open', 'Unfunded job', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'pending', false, NULL, 0, NULL, NULL, NULL),
  ('${U(307)}', '${ELI}', 'open', 'Licensed job', 'electrical', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', false, NULL, 2, NULL, NULL, NULL),
  ('${U(308)}', '${ELI}', 'open', 'Series visit', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', false, NULL, 0, '${U(301)}', NULL, NULL),
  ('${U(309)}', '${ELI}', 'expired', 'Status expired', 'cleaning', 'Baton Rouge, LA', 50, current_date + 3, '09:00', 'escrow', false, NULL, 0, NULL, NULL, NULL);
INSERT INTO public.jobs (customer_id, helper_id, status, title, category, location, budget, date_needed, payment_status, is_seed) VALUES
  ('${BUYER}', '${ELI}', 'completed', 'Moved a couch', 'moving', 'Baton Rouge, LA', 60, current_date - 20, 'released', false),
  ('${BUYER}', '${ELI}', 'completed', 'Cleaned gutters', 'yard_work', 'Baton Rouge, LA', 90, current_date - 10, 'released', false),
  ('${BUYER}', '${ELI}', 'completed', 'Seed completed', 'seed_category', 'Baton Rouge, LA', 90, current_date - 10, 'released', true),
  ('${TESTREV}', '${ELI}', 'completed', 'Test poster job', 'test_category', 'Baton Rouge, LA', 90, current_date - 10, 'released', false),
  ('${BUYER}', '${ELI}', 'cancelled', 'Cancelled as Helpr', 'cancel_category', 'Baton Rouge, LA', 90, current_date - 10, 'released', false);
INSERT INTO public.reviews (reviewee_id, reviewer_id, rating, feedback, job_category) VALUES
  ('${ELI}', '${REVIEWER}', 5, 'Great work', 'moving');

INSERT INTO public.declutter_wanted (id, user_id, what, category, max_price_cents, area_lat, area_lng, status, public, removed_at, expires_at, is_seed) VALUES
  ('${U(401)}', '${ELI}', 'crib', 'baby', 8000, 30.45, -91.15, 'open', true, NULL, now() + interval '10 day', false),
  ('${U(402)}', '${ELI}', 'private bike', 'sports', 8000, 30.45, -91.15, 'open', false, NULL, now() + interval '10 day', false),
  ('${U(403)}', '${ELI}', 'closed piano', 'music', 8000, 30.45, -91.15, 'closed', true, NULL, now() + interval '10 day', false),
  ('${U(404)}', '${ELI}', 'expired desk', 'office', 8000, 30.45, -91.15, 'open', true, NULL, now() - interval '1 day', false),
  ('${U(405)}', '${ELI}', 'removed sofa', 'furniture', 8000, 30.45, -91.15, 'open', true, now(), now() + interval '10 day', false),
  ('${U(406)}', '${ELI}', 'seed grill', 'outdoor', 8000, 30.45, -91.15, 'open', true, NULL, now() + interval '10 day', true);
`);

if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (every check must FAIL)`);
}

const as = (uid, role) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const page = async (handle, { uid = null, role = "anon" } = {}) => {
  await as(uid, role);
  try {
    return { v: (await db.query(`SELECT public.public_profile_by_handle($1) AS v`, [handle])).rows[0]?.v };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
};

const a = await page("Eli-B ");
const p = a.v ?? null;
const json = JSON.stringify(p ?? {});
check("P1 anon gets the page: public name, photo, member since, handle, stats",
  !!p && p.name === "Eli B." && p.photo_url === "https://cdn.example/avatars/eli.jpg" && /^2025-03-01/.test(p.member_since ?? "")
    && p.handle === "eli-b" && p.stats?.review_count === 2 && p.stats?.completed_jobs_as_helper === 2 && p.stats?.is_id_verified === true
    && !("has_stripe_account" in (p.stats ?? { has_stripe_account: 1 })),
  a.error ?? json.slice(0, 200));

const leaks = ["eli@example.com", "2255550199", "123 Main", "70801", "30.45", "-91.15", "30.4512", "items/oak", ELI, "Broussard", "Call me", "Ring", "pickup", "storage_path", "latitude", "area_lat"]
  .filter((s) => json.includes(s));
check("P2 no contact, address, coordinate, storage path or user id anywhere", !!p && leaks.length === 0, leaks.join(", "));

const titles = (p?.listings ?? []).map((l) => l.title);
const l0 = p?.listings?.[0] ?? {};
check("P3 listings: live only (not sold, reserved, hidden or test), card fields + cover photo id",
  JSON.stringify(titles) === JSON.stringify(["Oak dresser"]) && l0.price_cents === 12000 && l0.area_label === "Mid City" && l0.photo_id === U(201)
    && Object.keys(l0).sort().join() === "area_label,id,live_at,photo_id,price_cents,title",
  JSON.stringify(p?.listings));

const jobs = p?.jobs ?? [];
const j0 = jobs[0] ?? {};
check("P4 jobs: own open job with the town only; no cancelled, expired, unfunded, credential, series or test job",
  jobs.length === 1 && j0.title === "Mow my yard" && j0.town === "Baton Rouge, LA" && j0.budget === 80 && j0.category === "lawn_care"
    && Object.keys(j0).sort().join() === "budget,category,date_needed,id,title,town",
  JSON.stringify(jobs));

const h = p?.helpr ?? {};
check("P5 Helpr work: jobs done without test jobs, their categories, reviews with the reviewer as First L.",
  h.jobs_done === 2 && JSON.stringify([...(h.categories ?? [])].sort()) === JSON.stringify(["moving", "yard_work"])
    && h.reviews?.length === 1 && h.reviews[0].reviewer_name === "Rita T." && h.reviews[0].rating === 5 && !json.includes("Thibodeaux"),
  JSON.stringify(h));

const w = p?.wanted ?? [];
check("P6 Wanted: public open posts only; no area point",
  w.length === 1 && w[0].what === "crib" && w[0].max_price_cents === 8000 && Object.keys(w[0]).sort().join() === "category,created_at,id,max_price_cents,what",
  JSON.stringify(w));

const hidden = [];
for (const hd of ["seed-p", "test-a", "ban-n", "un-v", "gone-a", "nobody-here", "", "x".repeat(40)]) {
  const r = await page(hd);
  if (r.error || r.v !== null) hidden.push(`${hd}: ${r.error ?? JSON.stringify(r.v)?.slice(0, 40)}`);
}
check("P7 no page for a test member, test account, banned, unverified, deleted or unknown handle", !BEFORE && hidden.length === 0, hidden.join("; "));

const m = await page("eli-b", { uid: BUYER, role: "authenticated" });
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.public_profile_by_handle(text)', 'EXECUTE') AS v`).catch(() => ({ rows: [{ v: false }] }))).rows[0]?.v;
check("P8 anon holds EXECUTE; a member gets the same answer as a guest", acl === true && !!m.v && JSON.stringify(m.v) === json, m.error ?? "");

await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_wanted'`);
const t1 = await page("eli-b");
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
const t2 = await page("eli-b");
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone'`);
await db.exec(`INSERT INTO public.member_flags VALUES ('${ELI}', 'minor')`);
const t3 = await page("eli-b");
await db.exec(`DELETE FROM public.member_flags`);
check("P9 Declutter / Wanted not open to everyone (or a poster rule) hides them; jobs stay",
  t1.v?.wanted?.length === 0 && t1.v?.listings?.length === 1 && t2.v?.listings?.length === 0 && t2.v?.wanted?.length === 0
    && t2.v?.jobs?.length === 1 && t3.v?.wanted?.length === 0,
  JSON.stringify([t1.error, t2.error, t3.error]));

if (BEFORE) {
  console.log(`--before: ${failures}/${checks} FAIL (expected ${checks})`);
  process.exit(failures === checks ? 0 : 1);
}
console.log(failures === 0 ? `ALL ${checks} PASS` : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
