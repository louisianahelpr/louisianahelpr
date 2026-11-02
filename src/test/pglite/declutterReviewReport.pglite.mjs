#!/usr/bin/env node
/**
 * PGlite proof for 20261102040000_declutter_review_report.sql (A3-75, audit 11-01): a member reports a Declutter review
 * they can be shown (never their own), the report keeps "N stars: <comment>", an admin removes it from the reports
 * queue, and a removed review leaves declutter_visible_reviews and the public star rating.
 *
 *   node src/test/pglite/declutterReviewReport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReviewReport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                                     # red on a planted defect
 *
 * World: the cut-down tables of publicStatsExpiredIsNotCancelled.pglite.mjs (so get_public_profile_stats runs for real),
 * with prod-shaped declutter_orders / declutter_reviews, reports, notifications, auth.users. Supabase's DEFAULT
 * PRIVILEGES (EXECUTE on new functions to anon, authenticated, service_role) are emulated FIRST, so a new function that
 * forgets its REVOKE shows anon=X. The prior state is applied in order, unchanged: 20261030015205 (is_test_member and
 * the older stats), 20261031234653 (newest stats), the newest declutter_visible_reviews block of 20261021023530 with
 * its grants, 20261101021934 (question reports) and 20261102015348 (reporter outcome notice). Then the new migration
 * 3x (replay). require_feature / is_caller_banned are stubs; seed_hidden_from_caller is TRUE (prod default).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(DIR + f, "utf8");
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261102040000_declutter_review_report.sql`, "utf8");
const visOld = (() => {
  const s = read("20261021023530_declutter_review_tags.sql");
  const a = s.indexOf("CREATE OR REPLACE FUNCTION public.declutter_visible_reviews");
  const b = s.indexOf("GRANT EXECUTE ON FUNCTION public.declutter_visible_reviews(uuid) TO authenticated, service_role;");
  return s.slice(a, b) + "GRANT EXECUTE ON FUNCTION public.declutter_visible_reviews(uuid) TO authenticated, service_role;";
})();

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), REAL_H = U(2), TEST_H = U(3), REAL_C = U(4), TEST_C = U(5), REAL_C2 = U(6), REAL_C3 = U(7), POSTER = U(8);
const SELLER = U(10), BUYER = U(11), MEMBER = U(12), ADMIN2 = U(13), BUYER2 = U(14);
const O1 = U(20), O2 = U(21), O3 = U(22), O4 = U(23), O5 = U(24);
const R1 = U(30), R2 = U(31), R3A = U(32), R3B = U(33), R4 = U(34), R5 = U(35), R6 = U(36), R7 = U(37);
const O6 = U(25), O7 = U(26);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 IN ('${ADMIN}'::uuid, '${ADMIN2}'::uuid) $$;
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
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
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, handed_over_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.declutter_orders(id), reviewer_id uuid, reviewee_id uuid,
    reviewer_side text NOT NULL, stars smallint NOT NULL, comment text, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), tags text[] NOT NULL DEFAULT '{}',
    CONSTRAINT declutter_reviews_once UNIQUE (order_id, reviewer_side));
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
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz DEFAULT now());

  INSERT INTO public.profiles (user_id, is_seed, email) VALUES
    ('${ADMIN}', false, 'admin@x.com'), ('${REAL_H}', false, 'h@x.com'), ('${TEST_H}', true, 'th@x.com'),
    ('${REAL_C}', false, 'c@x.com'), ('${TEST_C}', true, 'tc@x.com'), ('${REAL_C2}', false, 'c2@x.com'),
    ('${REAL_C3}', false, 'c3@x.com'), ('${POSTER}', false, 'p@x.com');
  INSERT INTO public.test_accounts VALUES ('${TEST_H}'), ('${TEST_C}');
`);

await db.exec(`ALTER TABLE public.jobs ADD COLUMN cancellation_reason text, ADD COLUMN cancelled_by uuid;`);

await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
await db.exec(`
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NULL AND coalesce(nullif(current_setting('test.role', true), ''), '') NOT IN ('anon', 'authenticated') $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p) $$;
  CREATE TABLE public.declutter_items(id uuid primary key, seller_id uuid, status text, title text, seller_hidden boolean not null default false, is_seed boolean not null default false);
  CREATE TABLE public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text);
  CREATE TABLE public.declutter_questions(id uuid primary key, item_id uuid, asker_id uuid, question text, answer text, answered_at timestamptz, removed_at timestamptz);
  CREATE TABLE public.declutter_wanted(id uuid primary key, user_id uuid, what text, public boolean, removed_at timestamptz, is_seed boolean,
    photo_paths text[] NOT NULL DEFAULT '{}', photos_held text[] NOT NULL DEFAULT '{}', photos_cleared text[] NOT NULL DEFAULT '{}');
  CREATE TABLE public.messages(id uuid primary key default gen_random_uuid(), sender_id uuid, receiver_id uuid, content text, attachment_url text);
  CREATE TABLE public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL, reason text NOT NULL,
    description text, status text NOT NULL DEFAULT 'pending', reported_content text, created_at timestamptz DEFAULT now(),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application','declutter_item','declutter_wanted'])));
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), title text NOT NULL,
    message text NOT NULL, type text NOT NULL, link text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb);
  INSERT INTO public.profiles (user_id, is_seed, email) VALUES ('${SELLER}', false, 's@x.com'), ('${BUYER}', false, 'b@x.com'),
    ('${MEMBER}', false, 'm@x.com'), ('${ADMIN2}', false, 'a2@x.com'), ('${BUYER2}', false, 'b2@x.com');
  INSERT INTO auth.users SELECT user_id FROM public.profiles;
`);
await db.exec(read("20261030015205_test_data_never_counts.sql"));
await db.exec(read("20261031234653_public_stats_expired_is_not_cancelled.sql"));
await db.exec(visOld);
await db.exec(read("20261101021934_declutter_question_report.sql"));
await db.exec(`CREATE TRIGGER trg_report_message_party_and_copy BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.report_message_party_and_copy()`);
await db.exec(read("20261102015348_reporter_hears_the_outcome.sql"));
// The world: O1 handed over 20 days ago (its review is public); O2 one day ago with one review (blind); O3 one day ago
// with both reviews (public); O4 a test order's review (hidden from others under the seed switch); O5 ADMIN2 is the
// subject of the review.
await db.exec(`
  INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handed_over_at, is_seed) VALUES
    ('${O1}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '20 days', false),
    ('${O2}', '${BUYER2}', '${SELLER}', 'handed_over', now() - interval '1 day', false),
    ('${O3}', '${MEMBER}', '${SELLER}', 'handed_over', now() - interval '1 day', false),
    ('${O4}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '20 days', true),
    ('${O5}', '${BUYER}', '${ADMIN2}', 'handed_over', now() - interval '20 days', false),
    ('${O6}', '${TEST_C}', '${SELLER}', 'handed_over', now() - interval '20 days', false),
    ('${O7}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '20 days', true);
  INSERT INTO public.declutter_reviews (id, order_id, reviewer_id, reviewee_id, reviewer_side, stars, comment, is_seed) VALUES
    ('${R1}', '${O1}', '${BUYER}', '${SELLER}', 'buyer', 2, 'Rude and late. Text me at 555-0100', false),
    ('${R2}', '${O2}', '${BUYER2}', '${SELLER}', 'buyer', 1, 'Blind one', false),
    ('${R3A}', '${O3}', '${MEMBER}', '${SELLER}', 'buyer', 1, null, false),
    ('${R3B}', '${O3}', '${SELLER}', '${MEMBER}', 'seller', 5, 'Great buyer', false),
    ('${R4}', '${O4}', '${BUYER}', '${SELLER}', 'buyer', 3, 'Test review', true),
    ('${R5}', '${O5}', '${BUYER}', '${ADMIN2}', 'buyer', 4, 'About an admin', false),
    ('${R6}', '${O6}', '${TEST_C}', '${SELLER}', 'buyer', 5, 'From a test account', false),
    ('${R7}', '${O7}', '${BUYER}', '${SELLER}', 'buyer', 5, 'On a test order', false);
`);
const SKIP_NEW = process.env.NEW_MIGRATION === "skip";
if (SKIP_NEW) console.log("NEW_MIGRATION=skip: the prior state only (this run must FAIL)");
if (!SKIP_NEW) for (let i = 0; i < 3; i++) await db.exec(SQL);

const as = async (uid, sql) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false); SELECT set_config('test.role', '${uid ? "authenticated" : "service_role"}', false)`);
  return db.query(sql);
};
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return String(e.message).includes(code) ? "ok" : `wrong: ${e.message}`; } };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };
const report = (uid, id) => as(uid, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES (${uid ? `'${uid}'` : "null"}, 'declutter_review', '${id}', 'Harassment or abuse') RETURNING id, reported_content`);
const reportFails = (uid, id, code) => fails(uid, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ('${uid}', 'declutter_review', '${id}', 'x')`, code);
const visible = async (uid, user) => (await as(uid, `SELECT id::text AS id FROM public.declutter_visible_reviews('${user}')`)).rows.map((r) => r.id);
const stats = async (user) => (await as(MEMBER, `SELECT review_count, avg_rating::text AS avg FROM public.get_public_profile_stats(ARRAY['${user}']::uuid[])`)).rows[0];

let REP1 = null;
await safe("the subject reports a public review; the report copies its stars and words", async () => {
  const r = (await report(SELLER, R1)).rows[0];
  REP1 = r?.id;
  return r?.reported_content === "2 stars: Rude and late. Text me at 555-0100" || r;
});
await safe("any member can report a public review on a profile", async () => (await report(MEMBER, R1)).rows.length === 1);
await safe("a blind review (one side, under 14 days) reads as not found, even to its subject", async () =>
  (await reportFails(SELLER, R2, "report_target_not_found")) === "ok" && (await reportFails(MEMBER, R2, "report_target_not_found")) === "ok");
await safe("the reviewer can't report their own review", () => reportFails(BUYER, R1, "report_own_content"));
await safe("a review with no words copies only its stars, '1 star'", async () => (await report(SELLER, R3A)).rows[0]?.reported_content === "1 star");
await safe("a test review is hidden from other members (not found); its subject can still report it", async () =>
  (await reportFails(MEMBER, R4, "report_target_not_found")) === "ok" && (await report(SELLER, R4)).rows.length === 1);
await safe("an unknown id reads as not found", () => fails(MEMBER, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ('${MEMBER}', 'declutter_review', gen_random_uuid(), 'x')`, "report_target_not_found"));
await safe("a server-side report (no reporter) is taken", async () => (await report(null, R2)).rows.length === 1);
await safe("before removal: the review shows and counts (SELLER: 2 public reviews, avg 1.50)", async () => {
  const v = await visible(MEMBER, SELLER); const s = await stats(SELLER);
  return (v.includes(R1) && s.review_count === 2 && s.avg === "1.50") || { v, s };
});
await safe("the queue's read: a member is refused", () => fails(MEMBER, `SELECT * FROM public.declutter_admin_reported_reviews(ARRAY['${R1}']::uuid[])`, "not_admin"));
await safe("the queue's read flags a test review, a test reviewer and a test order, and nothing else", async () => {
  const rows = (await as(ADMIN, `SELECT review_id::text AS id, is_seed, stars, comment, removed FROM public.declutter_admin_reported_reviews(ARRAY['${R1}', '${R4}', '${R6}', '${R7}']::uuid[])`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  return (rows.length === 4 && by[R1].is_seed === false && by[R4].is_seed === true && by[R6].is_seed === true && by[R7].is_seed === true
    && by[R1].removed === false && by[R1].stars === 2) || rows;
});
await safe("a member can't remove a review", () => fails(MEMBER, `SELECT public.declutter_admin_remove_review('${R1}', 'x', '${REP1}')`, "not_admin"));
await safe("the report must be for this review", () => fails(ADMIN, `SELECT public.declutter_admin_remove_review('${R3A}', 'x', '${REP1}')`, "report_not_for_review"));
await safe("an admin can't remove a review about themselves", () => fails(ADMIN2, `SELECT public.declutter_admin_remove_review('${R5}', 'x', null)`, "own_review"));
await safe("a note over 500 characters is refused", () => fails(ADMIN, `SELECT public.declutter_admin_remove_review('${R1}', repeat('a', 501), null)`, "review_note_too_long"));
await safe("an admin removes it: removed_at set, the report resolved, the step logged with the words", async () => {
  const r = (await as(ADMIN, `SELECT public.declutter_admin_remove_review('${R1}', 'contact details', '${REP1}') AS r`)).rows[0]?.r;
  const row = (await db.query(`SELECT removed_at FROM public.declutter_reviews WHERE id = '${R1}'`)).rows[0];
  const rp = (await db.query(`SELECT status FROM public.reports WHERE id = '${REP1}'`)).rows[0];
  const log = (await db.query(`SELECT details FROM public.admin_audit_log WHERE target_id = '${R1}' AND action = 'declutter_review_removed'`)).rows[0];
  return (r === "removed" && row.removed_at && rp.status === "resolved" && log?.details.note === "contact details" && log.details.stars === 2
    && log.details.comment === "Rude and late. Text me at 555-0100") || { r, row, rp, log };
});
await safe("the reporter is told about 'a review' (outcome notice)", async () => {
  const n = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  return (n?.message ?? "").startsWith("Thanks for your report about a review (case HLP-") || n;
});
await safe("after removal: gone from declutter_visible_reviews for members AND its subject", async () => {
  const a = await visible(MEMBER, SELLER); const b = await visible(SELLER, SELLER);
  return (!a.includes(R1) && !b.includes(R1) && a.includes(R3A)) || { a, b };
});
await safe("after removal: it leaves the public star rating (2 reviews avg 1.50 -> 1 review 1.00)", async () => {
  const s = await stats(SELLER);
  return (s.review_count === 1 && s.avg === "1.00") || s;
});
await safe("a removed review can't be reported again", () => reportFails(MEMBER, R1, "report_target_not_found"));
await safe("removing it twice says not found", () => fails(ADMIN, `SELECT public.declutter_admin_remove_review('${R1}', 'x', null)`, "review_not_found"));
await safe("the queue's read shows it removed", async () => (await as(ADMIN, `SELECT removed FROM public.declutter_admin_reported_reviews(ARRAY['${R1}']::uuid[])`)).rows[0]?.removed === true);
await safe("question reports still work (the B48 branch is intact)", async () => {
  await db.exec(`INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES ('${U(40)}', '${SELLER}', 'live', 'Lamp');
    INSERT INTO public.declutter_questions (id, item_id, asker_id, question, answer) VALUES ('${U(41)}', '${U(40)}', '${BUYER}', 'Q?', 'A.')
    ON CONFLICT DO NOTHING`);
  const r = (await as(MEMBER, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ('${MEMBER}', 'declutter_question', '${U(41)}', 'x') RETURNING reported_content`)).rows[0];
  return r?.reported_content === "Question: Q?\nAnswer: A." || r;
});
await safe("grants (Supabase default anon execute emulated): the new RPCs are not PUBLIC's or anon's", async () => {
  const acls = (await db.query(`SELECT proname, coalesce(proacl::text, '') AS a FROM pg_proc WHERE proname IN ('declutter_admin_remove_review', 'declutter_admin_reported_reviews')`)).rows;
  return (acls.length === 2 && acls.every((r) => r.a.includes("authenticated=X") && r.a.includes("service_role=X") && !/(^|[{,])=X/.test(r.a) && !r.a.includes("anon=X"))) || acls;
});
await safe("grants: the restated declutter_visible_reviews stays closed to anon; the stats keep their grants", async () => {
  const vis = (await db.query(`SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE proname = 'declutter_visible_reviews'`)).rows[0].a;
  const trig = (await db.query(`SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE proname = 'notify_reporter_report_outcome'`)).rows[0].a;
  return (vis.includes("authenticated=X") && !vis.includes("anon=X") && !/(^|[{,])=X/.test(vis) && !trig.includes("anon=X") && !trig.includes("authenticated=X")) || { vis, trig };
});

let red = 0;
for (const [k, v] of Object.entries(results)) { console.log(`${v === "ok" ? "ok  " : "RED "} ${k}${v === "ok" ? "" : `: ${v}`}`); if (v !== "ok") red++; }
console.log(red ? `\n${red} RED` : `\nALL OK ${Object.keys(results).length}`);
process.exit(red ? 1 : 0);
