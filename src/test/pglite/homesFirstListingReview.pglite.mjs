#!/usr/bin/env node
/**
 * PGlite proof for 20261019185022_rentals_first_listing_review (owner answers
 * 2026-10-19: an admin approves a lister's FIRST Homes listing, rent or sale,
 * before it goes live; later listings go live right away).
 *
 *   node src/test/pglite/homesFirstListingReview.pglite.mjs
 *   FIRST_REVIEW_MIGRATION=skip node src/test/pglite/homesFirstListingReview.pglite.mjs   # RED: a first listing goes live unreviewed
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesFirstListingReview.pglite.mjs
 *
 * The prod-shaped stubs and chain of homesListingPhotos.pglite.mjs (through the
 * private listing photos 20261019071203), then this migration 3x.
 */
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019185022";
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_first_listing_review.sql`, "utf8");
const IDENTITY = readFileSync(`${MIG_DIR}20261019061019_rentals_listing_identity_helper.sql`, "utf8");
const EXPORT_FILE = "20261019043100_export_my_data_rental_listings.sql";
const EXPORT = readFileSync(`${MIG_DIR}${EXPORT_FILE}`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const BASE = ["20261017205605_rentals_maintenance_requests.sql", "20261017220911_rentals_link_one_live_job.sql",
  "20261017221621_rentals_visit_time.sql", "20261017223352_rentals_ownership_review_alert.sql"]
  .map((f) => readFileSync(`${MIG_DIR}${f}`, "utf8")).join("\n");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement before this migration, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < SELF).sort()) {
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
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT DELETE, INSERT ON storage.objects TO authenticated;
-- job-photos is a PUBLIC bucket on prod ("Public read job-photos"): without a SELECT policy every DELETE here would see nothing.
CREATE POLICY "Public read job-photos" ON storage.objects FOR SELECT USING (bucket_id = 'job-photos');
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT SELECT ON storage.objects TO authenticated;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  idv_status text, date_of_birth date, ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  license_url text, insurance_url text, stripe_identity_verified boolean);
CREATE TABLE public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), onboarding_fee_cents integer NOT NULL DEFAULT 200);
INSERT INTO public.platform_settings DEFAULT VALUES;
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, document_url text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, status text NOT NULL DEFAULT 'open',
  payment_status text, stripe_session_id text, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text, message text,
  type text, link text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text, channel text,
  status text, subject text, job_id uuid, error_message text);
-- poster_cancel_job: the real one (12 KB, fees/strike ladder) is out of scope here; a stub that cancels the
-- caller's own job is enough to prove rentals_cancel_request_job's own gates.
CREATE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.jobs SET status = 'cancelled' WHERE id = p_job_id AND customer_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.notification_crosses_seed_boundary(p_recipient uuid, p_job_id uuid, p_link text, p_actor uuid DEFAULT NULL)
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const LANDLORD = U(1), TENANT = U(2), STRANGER = U(3), MINOR = U(4), BANNED = U(5), NOIDV = U(6), ADMIN = U(7), ORDINARY = U(8), TENANT2 = U(9);

const db = new PGlite();
await db.exec(SCHEMA);
// Q807 gate: the migration calls attach_unconfirmed_email_gate() (newest definitions, read by name).
for (const name of ["ops_alert_normalise", "is_caller_banned", "member_under_18", "contact_leak_reason",
  "session_email_unconfirmed", "refuse_unconfirmed_email_write", "attach_unconfirmed_email_gate"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;`);
await db.exec(SWITCHES);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 9) g;
  INSERT INTO public.profiles (user_id, idv_status, date_of_birth, ban_status) VALUES
    ('${LANDLORD}', 'verified', '1980-01-01', 'active'),
    ('${TENANT}',   'verified', '1990-01-01', 'active'),
    ('${STRANGER}', 'verified', '1991-01-01', 'active'),
    ('${MINOR}',    'verified', (now() - interval '15 years')::date, 'active'),
    ('${BANNED}',   'verified', '1990-01-01', 'banned'),
    ('${NOIDV}',    NULL,       '1990-01-01', 'active'),
    ('${ADMIN}',    'verified', '1975-01-01', 'active'),
    ('${ORDINARY}', 'verified', '1985-01-01', 'active'),
    ('${TENANT2}',  NULL,       NULL,         'active');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${LANDLORD}'), ('${TENANT}'), ('${STRANGER}'), ('${MINOR}'),
    ('${BANNED}'), ('${NOIDV}'), ('${TENANT2}');`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

function definitionIn(file, name) {
  const sql = readFileSync(`${MIG_DIR}${file}`, "utf8");
  const m = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "i").exec(sql);
  const t = /\bAS\s+(\$\w*\$)/g;
  t.lastIndex = m.index;
  const a = t.exec(sql);
  return `${sql.slice(m.index, sql.indexOf(a[1], a.index + a[0].length) + a[1].length)};`;
}

const skip = process.env.FIRST_REVIEW_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(LISTINGS);
await db.exec(newestDefinition("identity_is_verified").stmt);
await db.exec(definitionIn("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"));
await db.exec(IDENTITY);
await db.exec(SALE);
await db.exec(LINK);
await db.exec(PHOTOS);

async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${role}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);
  }
}
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const rows = (r) => (Array.isArray(r) ? r : []);
const empty = (r) => Array.isArray(r) && r.length === 0;

if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

// --- setup: two verified listers, each with an approved property; 5 private photos per listing
const newProp = async (uid, label) => {
  const p = one(await as("authenticated", uid, `SELECT public.rentals_create_property('${label}', '1 ${label} St', 'Lafayette', '70501') AS id`));
  await as("authenticated", uid, `SELECT public.rentals_submit_ownership_proof('${p}', '${uid}/rentals/${p}/deed.pdf')`);
  await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${p}', true, 'ok')`);
  return p;
};
const prop = await newProp(LANDLORD, "Oak");
const unitA = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Main') AS id`));
const unitB = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit B') AS id`));
const R = (h) => JSON.stringify({ headline: h, rent_cents: 120000, beds: 2, baths: 1, available_on: "2026-11-01" });
const newRent = async (uid, unit, h) => one(await as("authenticated", uid, `SELECT public.rentals_save_listing(NULL, '${unit}', '${R(h)}'::jsonb) AS id`));
const P = (uid, id, i) => `${uid}/rental-listings/${id}/p${i}.jpg`;
const photo = async (uid, id, i) => {
  await as("authenticated", uid, `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('listing-photos', '${P(uid, id, i)}', '${uid}', '${uid}', '{"mimetype":"image/jpeg","size":1000}')`);
  return one(await as("authenticated", uid, `SELECT public.rentals_add_listing_photo('${id}', '${P(uid, id, i)}') AS id`));
};
const five = async (uid, id) => { for (let i = 0; i < 5; i++) await photo(uid, id, i); };
const publish = (uid, id) => as("authenticated", uid, `SELECT public.rentals_set_listing_status('${id}', 'live')`);
const L = async (id) => rows(await svc(`SELECT status, first_review, first_review_submitted_at::text AS sub, first_review_note FROM public.rental_listings WHERE id = '${id}'`))[0] ?? {};
const adminAlerts = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = 'First Homes listing waits for review'`));
const told = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));
const review = (uid, id, approve, note, sub) => as("authenticated", uid,
  `SELECT public.rentals_admin_review_first_listing('${id}', ${approve}, ${note === null ? "NULL" : `'${note}'`}, ${sub === null ? "NULL" : `'${sub}'::timestamptz`})`);

const first = await newRent(LANDLORD, unitA, "Bright 2 bed near downtown");
await five(LANDLORD, first);
const slug = one(await svc(`SELECT slug FROM public.rental_listings WHERE id = '${first}'`));

// --- 1. a first listing goes to review, not live
ok(Array.isArray(await publish(LANDLORD, first)), "an untrusted lister's Publish succeeds (no error)");
let s = await L(first);
ok(s.status === "draft" && s.first_review === "pending_review" && s.sub, "first listing: still a draft, first_review = pending_review, review clock set");
ok((await adminAlerts()) === 1, "every admin is paged once");
ok(refused(await publish(LANDLORD, first), /listing_in_review/), "pressing Publish again while it waits says it is in review");
ok((await adminAlerts()) === 1, "and pages nobody again");

// --- 2. never visible while it waits: Browse, the page, the public link, a member photo ref
await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'rentals'`);
await svc(`DELETE FROM public.test_accounts WHERE user_id IN ('${LANDLORD}', '${TENANT}')`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "Browse (rent) does not show a waiting first listing");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${first}')`)) || refused(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${first}')`), /not_found|listing/),
  "the in-app page does not open it for anyone else");
ok(empty(await as("anon", null, `SELECT * FROM public.rentals_public_listing('${slug}')`)) || refused(await as("anon", null, `SELECT * FROM public.rentals_public_listing('${slug}')`), /not_found|listing/),
  "the public link (by slug) shows nothing");
ok(one(await as("authenticated", TENANT, `SELECT public.rentals_listing_visible('${first}')`)) !== true, "rentals_listing_visible is not true");
ok(one(await svc(`SELECT public.rentals_public_listing_visible('${first}')`)) !== true, "rentals_public_listing_visible is not true");
const photoId = one(await svc(`SELECT id FROM public.rental_listing_photos WHERE listing_id = '${first}' ORDER BY position LIMIT 1`));
const mRef = one(await svc(`SELECT public.rentals_photo_ref('${photoId}', 'm')`));
const pRef = one(await svc(`SELECT public.rentals_photo_ref('${photoId}', 'p')`));
ok(one(await svc(`SELECT public.rentals_listing_photo_object('${mRef}')`)) === null && one(await svc(`SELECT public.rentals_listing_photo_object('${pRef}')`)) === null,
  "the photo proxy serves no member or public ref of it");

// --- 3. the backstop: nothing writes it live behind the review
ok(refused(await svc(`UPDATE public.rental_listings SET status = 'live', published_at = now(), expires_at = now() + interval '30 days' WHERE id = '${first}'`), /listing_needs_review/),
  "a direct write to live (any writer, even the server) is refused for an untrusted lister");

// --- 4. the queue: admins only, with what they need
const q = one(await as("authenticated", ADMIN, `SELECT public.rentals_admin_first_listings()`));
ok(Array.isArray(q) && q.length === 1 && q[0].id === first && q[0].photo_refs?.length === 5 && q[0].street_address === "1 Oak St"
  && q[0].first_review_submitted_at && q[0].owner_id_verified === true && q[0].ownership_status === "approved",
  "the admin queue lists it with photos, the street, ID and ownership state and its review time");
ok(q?.[0]?.photo_refs?.every((r) => r.split(".")[1] === "o") && one(await svc(`SELECT public.rentals_listing_photo_object('${q?.[0]?.photo_refs?.[0]}')`)) === P(LANDLORD, first, 0),
  "the queue's photo refs resolve for the admin while it waits");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_admin_first_listings()`), /not_authorized/), "the lister cannot read the queue");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_admin_first_listings()`), /not_authorized/), "a member cannot read the queue");
ok(refused(await as("anon", null, `SELECT public.rentals_admin_first_listings()`), /permission denied/), "anon cannot call it");

// --- 5. the admin decides about what they saw
const sub1 = (await L(first)).sub;
await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing('${first}', NULL, '${R("Bright 2 bed near downtown, new paint")}'::jsonb)`);
const sub2 = (await L(first)).sub;
ok(sub2 && sub2 !== sub1 && (await L(first)).first_review === "pending_review", "an edit while it waits keeps it waiting and moves the review clock");
ok(refused(await review(ADMIN, first, true, null, sub1), /review_changed/), "approving the older content is refused (review_changed)");
await photo(LANDLORD, first, 5);
const sub3 = (await L(first)).sub;
ok(sub3 !== sub2, "a photo added while it waits moves the review clock too");
ok(refused(await review(ADMIN, first, true, null, sub2), /review_changed/), "so the admin must look again after a new photo");
ok(refused(await review(LANDLORD, first, true, null, sub3), /not_authorized/), "the lister cannot approve their own listing");
ok(refused(await review(TENANT, first, true, null, sub3), /not_authorized/), "a member cannot approve");
ok(refused(await review(ADMIN, first, false, "no", sub3), /reason_required/), "a rejection needs a reason");
ok(Array.isArray(await review(ADMIN, first, false, "Photo 3 shows a different house.", sub3)), "the admin rejects with a reason");
s = await L(first);
ok(s.status === "draft" && s.first_review === "rejected" && s.first_review_note === "Photo 3 shows a different house.", "rejected: stays a draft, the reason is kept for the lister");
ok((await told(LANDLORD, "Your listing needs a change")) === 1, "the lister is told, with the reason");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'first_listing_rejected' AND target_id = '${first}'`)) === 1, "the rejection is in the admin audit log");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "a rejected first listing is not in Browse");
ok(empty(JSON.parse(JSON.stringify(one(await as("authenticated", ADMIN, `SELECT public.rentals_admin_first_listings()`)) ?? []))) || (one(await as("authenticated", ADMIN, `SELECT public.rentals_admin_first_listings()`)) ?? []).length === 0,
  "and it leaves the queue");

// resubmit -> waiting again -> approve
ok(Array.isArray(await publish(LANDLORD, first)) && (await L(first)).first_review === "pending_review", "the lister fixes it and presses Publish: it waits again");
ok((await adminAlerts()) === 2, "a new waiting spell pages the admins again");
const sub4 = (await L(first)).sub;
ok(one(await svc(`SELECT public.admin_alert_close_rule('First Homes listing waits for review')`)) === "rentals-first-listing-review", "the admin alert has a close rule");
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-first-listing-review', '{}'::jsonb, now())`)) === true, "which stays open while a first listing waits");
await svc(`UPDATE public.rental_properties SET ownership_status = 'rejected' WHERE id = '${prop}'`);
ok(refused(await review(ADMIN, first, true, null, sub4), /ownership_not_approved/), "approval re-runs the publish checks for the OWNER (ownership taken back: refused)");
await svc(`UPDATE public.rental_properties SET ownership_status = 'approved' WHERE id = '${prop}'`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await review(ADMIN, first, true, null, sub4), /account_restricted/), "a banned owner's listing is never approved live");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
ok(Array.isArray(await review(ADMIN, first, true, null, sub4)), "the admin approves the content they saw");
s = await L(first);
ok(s.status === "live" && s.first_review === "approved", "approved: the listing is live");
ok((await told(LANDLORD, "Your listing is live")) === 1, "the lister is told it is live");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)).length === 1, "and it is in Browse now");
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-first-listing-review', '{}'::jsonb, now())`)) === false, "the admin alert closes (nothing waits)");
ok(refused(await review(ADMIN, first, true, null, sub4), /not_pending_review/), "a second decision is refused");

// --- 6. later listings, rent or sale, go live at once
const second = await newRent(LANDLORD, unitB, "Upstairs one bedroom");
await five(LANDLORD, second);
ok(Array.isArray(await publish(LANDLORD, second)) && (await L(second)).status === "live" && (await L(second)).first_review === null,
  "the trusted lister's next rent listing goes live right away, with no review");
const sale = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_sale_listing(NULL, '${prop}', '${JSON.stringify({
  headline: "Three bedroom brick home", sale_price_cents: 24500000, beds: 3, baths: 2, sq_ft: 1650 })}'::jsonb) AS id`));
await five(LANDLORD, sale);
ok(Array.isArray(await publish(LANDLORD, sale)) && (await L(sale)).status === "live", "and a sale listing too");
ok((await adminAlerts()) === 2, "no admin is paged for them");

// --- 7. a second lister's FIRST listing is a SALE: reviewed as well
const prop2 = await newProp(STRANGER, "Cypress");
const sale2 = one(await as("authenticated", STRANGER, `SELECT public.rentals_save_sale_listing(NULL, '${prop2}', '${JSON.stringify({
  headline: "Cottage with a big yard", sale_price_cents: 18900000, beds: 2, baths: 1 })}'::jsonb) AS id`));
await five(STRANGER, sale2);
ok(Array.isArray(await publish(STRANGER, sale2)) && (await L(sale2)).status === "draft" && (await L(sale2)).first_review === "pending_review",
  "another lister's first listing (a sale) waits for review too");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`).then((r) => rows(r).filter((x) => x.id === sale2))),
  "and is not in the Buy browse");
// a seed lister never holds the real alert open
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${STRANGER}'`);
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-first-listing-review', '{}'::jsonb, now())`)) === false, "a test (seed) lister never holds the real alert open");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${STRANGER}'`);

// --- 8. grants
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_lister_trusted(uuid)", "public.rentals_listing_publish_check(public.rental_listings,uuid)"]) {
  const a = await acl(sig);
  ok(!/(^|[{,])(anon|authenticated)?=X/.test(a), `${sig}: not callable by members or anon (${a})`);
}
for (const sig of ["public.rentals_admin_first_listings()", "public.rentals_admin_review_first_listing(uuid,boolean,text,timestamptz)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated (admin checked inside), not anon/PUBLIC (${a})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (FIRST_REVIEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
