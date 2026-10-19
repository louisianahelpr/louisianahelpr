#!/usr/bin/env node
/**
 * PGlite proof for 20261019185722_rentals_saved_homes (owner-approved card design 2026-10-19 14:55Z: the
 * heart on a Homes card and the Saved list): a member saves and unsaves a visible listing; the row is
 * theirs alone (RLS user_id = auth.uid(); no client write grant); a hidden, paused or own listing is refused;
 * a banned member cannot save (but can unsave); the Saved list returns only the caller's still-visible saves
 * with the public facts (no street, no owner id, no storage path); anon executes nothing; deleting the
 * listing or the account removes the row; Download My Data (20261019185723) carries the member's rows only.
 *
 *   node src/test/pglite/homesSavedHomes.pglite.mjs
 *   SAVED_MIGRATION=skip node src/test/pglite/homesSavedHomes.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesSavedHomes.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019185722";
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const EXPORT_SAVED = readFileSync(`${MIG_DIR}20261019185723_export_my_data_saved_homes.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_saved_homes.sql`, "utf8");
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

const skip = process.env.SAVED_MIGRATION === "skip";
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

// --- setup: an approved property, a LIVE rent listing with a photo, a draft, and a second landlord's live listing
const prop = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak house', '123 Oak St', 'Lafayette', '70501') AS id`));
await as("authenticated", LANDLORD, `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`);
await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'ok')`);
const unitA = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Main') AS id`));
const unitB = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit B') AS id`));
const R = (h) => JSON.stringify({ headline: h, rent_cents: 120000, beds: 2, baths: 1, sq_ft: 1100, available_on: "2026-11-01" });
const newRent = async (unit, h) => one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit}', '${R(h)}'::jsonb) AS id`));
const goLive = async (id) => {
  for (let i = 0; i < 5; i++) {
    const p = `${LANDLORD}/rental-listings/${id}/p${i}.jpg`;
    await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('listing-photos', '${p}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/jpeg","size":1000}')`);
    await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${id}', '${p}')`);
  }
  return as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${id}', 'live')`);
};
const liveId = await newRent(unitA, "Bright 2 bed near downtown");
await goLive(liveId);
const draftId = await newRent(unitB, "Draft not yet listed");
ok(one(await svc(`SELECT status FROM public.rental_listings WHERE id = '${liveId}'`)) === "live"
  && one(await svc(`SELECT status FROM public.rental_listings WHERE id = '${draftId}'`)) === "draft", "setup: one live listing, one draft");

if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

const save = (uid, id, v = true) => as("authenticated", uid, `SELECT public.rentals_set_saved_home('${id}', ${v}) AS saved`);

// --- 1. the table: own rows only, no client write
ok(one(await svc(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.saved_homes'::regclass`)) === true, "saved_homes has RLS on (3 replays)");
ok(one(await save(TENANT, liveId)) === true, "a member saves a live listing");
ok(one(await save(TENANT, liveId)) === true, "saving twice is fine (one row)");
ok(one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE user_id = '${TENANT}'`)) === 1, "one row per member and listing");
ok(rows(await as("authenticated", TENANT, `SELECT listing_id FROM public.saved_homes`)).length === 1, "the member reads their own saved row");
ok(empty(await as("authenticated", STRANGER, `SELECT listing_id FROM public.saved_homes`)), "another member reads none of it (RLS user_id = auth.uid())");
ok(refused(await as("authenticated", STRANGER, `INSERT INTO public.saved_homes (user_id, listing_id) VALUES ('${STRANGER}', '${liveId}')`), /permission denied/),
  "no client INSERT (only the RPC writes)");
ok(refused(await as("authenticated", TENANT, `DELETE FROM public.saved_homes WHERE user_id = '${TENANT}'`), /permission denied/), "no client DELETE");
ok(refused(await as("anon", null, `SELECT listing_id FROM public.saved_homes`), /permission denied/), "anon reads nothing");

// --- 2. the write's gates
ok(refused(await save(STRANGER, draftId), /listing_not_found/, "P0002"), "a draft (not visible in Browse) cannot be saved");
ok(refused(await save(STRANGER, "00000000-0000-0000-0000-00000000dead"), /listing_not_found/, "P0002"), "a missing listing cannot be saved");
ok(refused(await save(LANDLORD, liveId), /own_listing/, "22023"), "the owner cannot save their own listing");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${STRANGER}'`);
ok(refused(await save(STRANGER, liveId), /account_restricted/), "a banned member cannot save");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${STRANGER}'`);
ok(refused(await as("anon", null, `SELECT public.rentals_set_saved_home('${liveId}', true)`), /permission denied/), "anon cannot execute the write");
ok(refused(await as("anon", null, `SELECT * FROM public.rentals_saved_listings()`), /permission denied/), "anon cannot execute the read");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await save(STRANGER, liveId), /feature_disabled/), "with the Homes switch off nobody saves (a tester either)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);

// --- 2b. at most 100 saves per member (the Saved list shows 100: nothing silently hidden)
const filler = await svc(`INSERT INTO public.rental_listings SELECT (jsonb_populate_record(NULL::public.rental_listings,
  to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'slug', substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'status', 'leased', 'headline', 'Filler listing'))).*
  FROM public.rental_listings l, generate_series(1, 99) WHERE l.id = '${liveId}'`);
if (!Array.isArray(filler)) console.log("  (filler insert:", filler.error, ")");
await svc(`INSERT INTO public.saved_homes (user_id, listing_id) SELECT '${TENANT}', id FROM public.rental_listings WHERE headline = 'Filler listing'`);
ok(one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE user_id = '${TENANT}'`)) === 100, "setup: the member has 100 saved rows");
await goLive(draftId);
ok(one(await svc(`SELECT public.rentals_listing_visible('${draftId}')`)) === true, "setup: a second visible listing");
ok(refused(await save(TENANT, draftId), /too_many_saved_homes/, "22023"), "the 101st save is refused (too_many_saved_homes)");
ok(one(await save(TENANT, liveId)) === true, "re-saving one already saved is still fine at 100");
await svc(`DELETE FROM public.saved_homes WHERE listing_id IN (SELECT id FROM public.rental_listings WHERE headline = 'Filler listing')`);
ok(one(await save(TENANT, draftId)) === true, "under 100 again, it saves");
await save(TENANT, draftId, false);
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${draftId}', 'paused')`);

// --- 3. the Saved list
const list = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_saved_listings()`));
ok(list.length === 1 && list[0].id === liveId && list[0].kind === "rent" && list[0].rent_cents === 120000 && list[0].sq_ft === 1100
  && list[0].city === "Lafayette" && list[0].zip_code === "70501", "the Saved list shows the saved home with its public facts");
ok(list.length === 1 && !("owner_id" in list[0]) && !("address" in list[0]) && !("street" in list[0])
  && (list[0].photo_refs ?? []).every((r) => !String(r).includes(LANDLORD)), "no street, no owner id, no storage path in it");
ok(empty(await as("authenticated", STRANGER, `SELECT * FROM public.rentals_saved_listings()`)), "another member's list is empty");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${liveId}', 'paused')`);
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_saved_listings()`)), "a paused listing drops out of the Saved list");
ok(one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE user_id = '${TENANT}'`)) === 1, "but the saved row stays");
ok(refused(await save(STRANGER, liveId), /listing_not_found/), "and nobody new can save it while it is paused");
ok(one(await save(TENANT, liveId, false)) === false && one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE user_id = '${TENANT}'`)) === 0,
  "unsaving always works, even while the listing is hidden");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${liveId}', 'live')`);
await save(TENANT, liveId);
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_saved_listings()`)).length === 1, "listed again, it is back");

// --- 4. Download My Data and deletion
// export_my_data reads dozens of tables this harness does not build; its saved_homes section is checked here as
// text and its caller scoping by src/test/dataExportCoversEveryUserTable.test.ts (newest body, both ways).
ok(/jsonb_build_object\('saved_homes', \(SELECT coalesce\(jsonb_agg\(to_jsonb\(t\)\), '\[\]'::jsonb\) FROM public\.saved_homes t\s+WHERE t\.user_id = v_uid\)\)/.test(EXPORT_SAVED),
  "Download My Data carries the member's own saved homes (20261019185723)");
ok(one(await save(STRANGER, liveId)) === true, "setup: a second member saves it");
const delUser = await svc(`DELETE FROM auth.users WHERE id = '${STRANGER}'`);
if (!Array.isArray(delUser)) console.log("  (account delete:", delUser.error, ")");
ok(Array.isArray(delUser) && one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE user_id = '${STRANGER}'`)) === 0, "deleting the account removes its saved rows");
await svc(`DELETE FROM public.rental_listing_photos WHERE listing_id = '${liveId}'`);
const delListing = await svc(`DELETE FROM public.rental_listings WHERE id = '${liveId}'`);
if (!Array.isArray(delListing)) console.log("  (listing delete:", delListing.error, ")");
ok(one(await svc(`SELECT count(*)::int FROM public.saved_homes WHERE listing_id = '${liveId}'`)) === 0, "deleting the listing removes every saved row for it");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (SAVED_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
