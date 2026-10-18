#!/usr/bin/env node
/**
 * PGlite proof for 20261019043000_rentals_listings (Homes -> Rent listings,
 * RL1a; spec ~/.lh-wt/handoffs-1017/rentals-full-spec.md 1a, 6a) and the
 * export restatement 20261019043100_export_my_data_rental_listings.
 *
 *   node src/test/pglite/rentalsListings.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/rentalsListings.pglite.mjs   # RED: the listings checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/rentalsListings.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The same prod-shaped stubs as rentalsMaintenance.pglite.mjs (roles + prod's
 * default function ACL, so a REVOKE that forgets anon is caught; auth.uid();
 * storage.objects; profiles), then 20261012031120 (switches), the Rentals S1
 * and slice-three migrations, then the listings migration and the export
 * restatement, each 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019043000";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_listings.sql`, "utf8");
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
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT DELETE ON storage.objects TO authenticated;
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
  license_url text, insurance_url text);
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

const skip = process.env.NEW_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  for (let i = 0; i < 3; i++) await db.exec(EXPORT);
}

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
/** An answered query with no rows (an error is NOT "empty"). */
const empty = (r) => Array.isArray(r) && r.length === 0;

// --- setup through the S1 RPCs: an approved property with a unit (the landlord), and a second unapproved one.
const prop = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak duplex', '123 Oak St', 'Lafayette', '70501') AS id`));
const unit = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit A') AS id`));
await as("authenticated", LANDLORD, `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`);
await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'ok')`);
const prop2 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Elm house', '9 Elm St', 'Lafayette', '70503') AS id`));
const unit2 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop2}', 'Main') AS id`));
ok(typeof unit === "string" && typeof unit2 === "string", "setup: an approved and an unapproved property, one unit each");

const F = (o = {}) => JSON.stringify({
  headline: "Bright 2 bed near downtown", description: "Freshly painted, new floors, close to the park.",
  rent_cents: 120000, rent_frequency: "monthly", deposit_cents: 120000, beds: 2, baths: 1.5, sq_ft: 950,
  available_on: "2026-11-01", lease_months_min: 6, lease_months_max: 12, pets: "cats", pet_rules: "Up to 2 cats.",
  parking: "driveway", utilities_included: ["water", "trash"], accepts_vouchers: "ask", accessibility: ["ground_floor"], ...o,
}).replace(/'/g, "''");
const save = (uid, id, u, o) => as("authenticated", uid, `SELECT public.rentals_save_listing(${id ? `'${id}'` : "NULL"}, ${u ? `'${u}'` : "NULL"}, '${F(o)}'::jsonb) AS id`);

// --- gates
ok(refused(await as("anon", null, `SELECT public.rentals_save_listing(NULL, '${unit}', '${F()}'::jsonb)`), /permission denied/),
  "anon cannot execute rentals_save_listing");
ok(refused(await as("anon", null, `SELECT * FROM public.rentals_browse_listings()`), /permission denied/), "anon cannot browse (switch-gated, signed in)");
ok(refused(await save(ORDINARY, null, unit), /feature_disabled/, "42501"), "testers only: an ordinary account is refused (feature_disabled)");
ok(refused(await save(MINOR, null, unit), /under_18/, "42501"), "under 18 is refused");
ok(refused(await save(BANNED, null, unit), /account_restricted/, "42501"), "a banned account is refused");
ok(refused(await save(STRANGER, null, unit), /unit_not_found/, "P0002"), "a stranger cannot list someone else's unit");
ok(refused(await save(LANDLORD, null, unit2), /ownership_not_approved/, "42501"), "a unit whose ownership is not approved cannot be listed");
ok(refused(await save(LANDLORD, null, unit, { who_may_live: "anyone" }), /bad_listing/, "22023"),
  "an unknown field is refused (no 'who may live here' field can be added)");
ok(refused(await save(LANDLORD, null, unit, { rent_cents: 10 }), /bad_listing/, "22023"), "a rent below $50 is refused (bad_listing)");
ok(refused(await save(LANDLORD, null, unit, { beds: 2.3 }), /bad_listing/, "22023"), "beds come in halves");
ok(refused(await save(LANDLORD, null, unit, { accepts_vouchers: "no" }), /bad_listing/, "22023"), "vouchers: no 'No' option (Q61)");
ok(refused(await save(LANDLORD, null, unit, { utilities_included: ["cable"] }), /bad_listing/, "22023"), "utilities: the fixed list only");
ok(refused(await save(LANDLORD, null, unit, { lease_months_min: 12, lease_months_max: 6 }), /bad_listing/, "22023"), "lease range min <= max");
ok(refused(await save(LANDLORD, null, unit, { available_on: "not a date" }), /bad_listing/, "22023"), "a bad date is refused in words");

// --- draft, flags, photos, publish
const draft = one(await save(LANDLORD, null, unit, { description: "Great for a quiet couple. Adults only, no kids." }));
ok(typeof draft === "string", "the landlord saves a draft (flagged wording is allowed in a draft)");
const flags = one(await svc(`SELECT wording_flags FROM public.rental_listings WHERE id = '${draft}'`));
ok(Array.isArray(flags) && flags.includes("adults only") && flags.includes("no kids"), `the fair-housing check names the phrases (${flags})`);
ok(refused(await save(LANDLORD, null, unit), /unit_already_listed/, "22023"), "one open listing per unit");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`), /wording_flagged/, "22023"),
  "a flagged listing cannot go live");
ok(typeof one(await save(LANDLORD, draft, null)) === "string", "the landlord rewrites it");
ok(one(await svc(`SELECT cardinality(wording_flags) FROM public.rental_listings WHERE id = '${draft}'`)) === 0, "the rewrite clears the flags");
ok(refused(await save(STRANGER, draft, null), /listing_not_found/, "P0002"), "a stranger cannot edit the listing (P0002, never 'not yours')");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`), /too_few_photos/, "22023"),
  "no photos: cannot go live (Q11: 5-25)");
const putObj = (name, mime = "image/jpeg", owner = LANDLORD) =>
  svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${name}', '${owner}', '${owner}', '{"mimetype":"${mime}","size":1000}')`);
const photoPath = (i, owner = LANDLORD, listing = draft) => `${owner}/rental-listings/${listing}/p${i}.jpg`;
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${photoPath(0)}')`), /photo_not_uploaded/, "22023"),
  "a photo that was never uploaded is refused");
await putObj(`${STRANGER}/rental-listings/${draft}/x.jpg`, "image/jpeg", STRANGER);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${STRANGER}/rental-listings/${draft}/x.jpg')`), /photo_not_uploaded/, "22023"),
  "someone else's object is refused");
await putObj(photoPath(99), "video/mp4");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${photoPath(99)}')`), /photo_not_uploaded/, "22023"),
  "a video is refused (it would keep its GPS)");
const photoIds = [];
for (let i = 0; i < 5; i++) {
  await putObj(photoPath(i));
  photoIds.push(one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${photoPath(i)}') AS id`)));
}
ok(photoIds.every((x) => typeof x === "string"), "five photos attach");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${photoPath(0)}')`), /photo_already_attached/, "22023"),
  "the same photo cannot attach twice");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_set_listing_status('${draft}', 'live')`), /listing_not_found/, "P0002"),
  "a stranger cannot publish it");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`)), "the landlord publishes it");
const live = rows(await svc(`SELECT status, published_at IS NOT NULL AS p, expires_at > now() + interval '29 days' AS e FROM public.rental_listings WHERE id = '${draft}'`))[0];
ok(live?.status === "live" && live.p && live.e, "live, with a 30-day expiry (Q64)");
ok(refused(await save(LANDLORD, draft, null, { description: "Christian family preferred." }), /wording_flagged/, "22023"),
  "a live listing cannot be edited into flagged wording");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_remove_listing_photo('${photoIds[0]}')`), /too_few_photos/, "22023"),
  "a live listing keeps at least 5 photos");

// --- reads
ok(refused(await as("authenticated", TENANT, `SELECT * FROM public.rental_listings`), /./) === false
  && empty(await as("authenticated", TENANT, `SELECT id FROM public.rental_listings`)),
  "a tester reads no listing rows directly (owner-only table)");
ok(rows(await as("authenticated", LANDLORD, `SELECT id FROM public.rental_listings`)).length === 1, "the owner reads their own row");
ok(refused(await as("authenticated", TENANT, `INSERT INTO public.rental_listings (unit_id, property_id, owner_id, headline, rent_cents, beds, baths, available_on) VALUES ('${unit}', '${prop}', '${TENANT}', 'x x x x', 100000, 1, 1, now())`), /permission denied/),
  "no client role writes rental_listings");
const browse = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`));
ok(browse.length === 1 && browse[0].city === "Lafayette" && browse[0].zip_code === "70501" && browse[0].photo_paths.length === 5,
  "a tester browses the live listing: city, ZIP and photos");
ok(browse.length === 1 && !JSON.stringify(browse).includes("123 Oak") && !("owner_id" in browse[0]), "the browse never carries the street address or an owner_id field (Q12; photo paths name the owner's folder, Q2188)");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings('70501', 2, 150000)`)).length === 1, "filters: ZIP, beds, max rent");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings('Baton Rouge')`)), "filters: another city shows nothing");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings(NULL, 3)`)), "filters: 3+ beds shows nothing");
const detail = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${draft}')`))[0];
ok(detail?.headline === "Bright 2 bed near downtown" && detail.is_mine === false && !JSON.stringify(detail).includes("123 Oak"),
  "a tester opens the listing page, no street address");
ok(refused(await as("authenticated", ORDINARY, `SELECT * FROM public.rentals_browse_listings()`), /feature_disabled/), "an ordinary account cannot browse");

// --- pause / expiry / ban / leased / removed
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'paused')`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "a paused listing leaves the browse");
ok(refused(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${draft}')`), /listing_not_found/, "P0002"),
  "and its page says not found to others");
ok(rows(await as("authenticated", LANDLORD, `SELECT * FROM public.rentals_listing('${draft}')`))[0]?.is_mine === true, "the owner still previews it");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`);
await svc(`UPDATE public.rental_listings SET expires_at = now() - interval '1 minute' WHERE id = '${draft}'`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "an expired listing leaves the browse (Q64)");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`);
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)).length === 1, "renewing puts it back for 30 days");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "a banned landlord's listing leaves the browse");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'bogus')`), /bad_status/, "22023"), "an unknown status is refused");
// lh-authz-rls review of 390bbc7a9 #1: an attached photo's file cannot be deleted, switch on or off.
const delAttached = () => as("authenticated", LANDLORD, `DELETE FROM storage.objects WHERE bucket_id = 'job-photos' AND name = '${photoPath(1)}' RETURNING name`);
ok(empty(await delAttached()), "the owner cannot delete an attached photo's file (switch on)");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(empty(await delAttached()), "nor once the switch is off for them (the attached check reads the owner's rows ungated)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await putObj(`${LANDLORD}/rental-listings/${draft}/loose.jpg`);
ok(rows(await as("authenticated", LANDLORD, `DELETE FROM storage.objects WHERE bucket_id = 'job-photos' AND name = '${LANDLORD}/rental-listings/${draft}/loose.jpg' RETURNING name`)).length === 1,
  "an unattached upload in the owner's own folder can be deleted (the cleanup path works)");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'leased')`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "a leased listing leaves the browse");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'live')`), /bad_status/, "22023"),
  "a rented listing cannot be shown again (review #3: list the unit anew instead, never a raw unique violation)");
ok(typeof one(await save(LANDLORD, null, unit)) === "string", "a leased unit can be listed again later");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draft}', 'removed')`);
ok(refused(await save(LANDLORD, draft, null), /listing_not_editable/, "22023"), "a removed listing cannot be edited");

// --- the wording check itself
const flRaw = async (t) => one(await svc(`SELECT public.rentals_listing_wording_flags('${t.replace(/'/g, "''")}')`));
const fl = async (t) => (await flRaw(t)) ?? [];
const plain = await flRaw("Near the church and two schools. Quiet street.");
ok(Array.isArray(plain) && plain.length === 0, "wording: plain facts about the home pass");
ok((await fl("No Section 8 please")).includes("no vouchers"), "wording: 'no section 8' is flagged (Q61)");
ok((await fl("English speaking tenants only")).includes("english only"), "wording: language preference is flagged");
ok((await fl("Must be able to climb stairs")).includes("no disabilities"), "wording: disability limits are flagged");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_listing_wording_flags('x')`), /permission denied/),
  "the wording helper is server-only");

// --- grants (prod's default ACL gives anon EXECUTE unless revoked by name)
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_save_listing(uuid,uuid,jsonb)", "public.rentals_add_listing_photo(uuid,text)",
  "public.rentals_remove_listing_photo(uuid)", "public.rentals_set_listing_status(uuid,text)",
  "public.rentals_browse_listings(text,numeric,integer,integer,integer)", "public.rentals_listing(uuid)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated yes, anon/PUBLIC no (${a})`);
}
for (const sig of ["public.rentals_listing_wording_flags(text)", "public.rentals_lock_own_listing(uuid,uuid)", "public.rentals_listing_visible(uuid)"]) {
  const a = await acl(sig);
  ok(/service_role=X/.test(a) && !/(^|[{,])(anon|authenticated)?=X/.test(a), `${sig}: server-only (${a})`);
}

// --- export
const exportDef = one(await svc(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure)`)) ?? "";
ok(/'rental_listings'/.test(exportDef) && /'rental_listing_photos'/.test(exportDef), "Download My Data carries the listings and their photos");
const exportAcl = await acl("public.export_my_data(uuid)");
ok(/service_role=X/.test(exportAcl) && !/(^|[{,])(anon|authenticated)?=X/.test(exportAcl), `export_my_data stays service_role only (${exportAcl})`);
// --- account deletion: the listings and photos go with the owner (CASCADE)
await svc(`DELETE FROM auth.users WHERE id = '${LANDLORD}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.rental_listings`)) === 0 && one(await svc(`SELECT count(*)::int FROM public.rental_listing_photos`)) === 0,
  "deleting the account removes the listings and their photo rows");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
