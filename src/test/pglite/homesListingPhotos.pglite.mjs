#!/usr/bin/env node
/**
 * PGlite proof for 20261019071203_rentals_listing_photos_private (Q2211 + Q2213; Q2212 is the proxy):
 * listing photos in a PRIVATE bucket, every read hands out signed photo refs (never a path or a member id),
 * the proxy lookup re-checks signature, expiry and the scope rule, the admin take-down detaches the photos.
 *
 *   node src/test/pglite/homesListingPhotos.pglite.mjs
 *   PHOTOS_MIGRATION=skip node src/test/pglite/homesListingPhotos.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesListingPhotos.pglite.mjs
 *
 * Same prod-shaped stubs and base chain as homesPublicLink.pglite.mjs, then the link migration, a legacy
 * listing with job-photos photos, then this migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019071203";
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_listing_photos_private.sql`, "utf8");
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

const skip = process.env.PHOTOS_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(LISTINGS);
await db.exec(newestDefinition("identity_is_verified").stmt);
await db.exec(definitionIn("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"));
await db.exec(IDENTITY);
await db.exec(SALE);
await db.exec(LINK);

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

// --- setup: an approved property with units, and a LEGACY listing whose photos sit in the public job-photos bucket
const prop = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak house', '123 Oak St', 'Lafayette', '70501') AS id`));
await as("authenticated", LANDLORD, `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`);
await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'ok')`);
const unitA = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Main') AS id`));
const unitB = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit B') AS id`));
const unitC = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit C') AS id`));
const R = (h) => JSON.stringify({ headline: h, rent_cents: 120000, beds: 2, baths: 1, available_on: "2026-11-01" });
const newRent = async (unit, h) => one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit}', '${R(h)}'::jsonb) AS id`));
const legacyId = await newRent(unitC, "Legacy listing with public photos");
for (let i = 0; i < 5; i++) {
  const p = `${LANDLORD}/rental-listings/${legacyId}/old${i}.jpg`;
  await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${p}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/jpeg","size":1000}')`);
  await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${legacyId}', '${p}')`);
}
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${legacyId}', 'live')`);
ok(one(await svc(`SELECT status FROM public.rental_listings WHERE id = '${legacyId}'`)) === "live", "setup: a live listing whose 5 photos are in job-photos (the old flow)");

if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

// --- 1. the bucket is private, JPEG only
const bucket = rows(await svc(`SELECT public, allowed_mime_types FROM storage.buckets WHERE id = 'listing-photos'`))[0];
ok(bucket?.public === false && JSON.stringify(bucket.allowed_mime_types) === '["image/jpeg"]', "Q2211: listing-photos is a PRIVATE bucket (no public URL), JPEG only");

// --- 2. existing job-photos photos are kept server-side, never lost, and their live listing waits for its owner
ok(one(await svc(`SELECT count(*)::int FROM public.rental_listing_photos WHERE listing_id = '${legacyId}'`)) === 0, "legacy: the job-photos rows are detached from the listing");
ok(one(await svc(`SELECT count(*)::int FROM public.rental_listing_photo_legacy WHERE storage_path LIKE '%/rental-listings/${legacyId}/%'`)) === 5, "legacy: all 5 kept in rental_listing_photo_legacy (3 replays, no duplicates)");
ok(one(await svc(`SELECT status FROM public.rental_listings WHERE id = '${legacyId}'`)) === "paused", "legacy: the live listing, now short of photos, is paused");
ok(refused(await as("authenticated", LANDLORD, `SELECT * FROM public.rental_listing_photo_legacy`), /permission denied/), "legacy table: no member read");

// --- 3. uploads: own folder, own listing, private bucket
const rentId = await newRent(unitA, "Bright 2 bed near downtown");
const up = (uid, path, mime = "image/jpeg") => as("authenticated", uid,
  `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('listing-photos', '${path}', '${uid}', '${uid}', '{"mimetype":"${mime}","size":1000}')`); // no RETURNING: the INSERT policy alone decides
const attach = (uid, id, path) => as("authenticated", uid, `SELECT public.rentals_add_listing_photo('${id}', '${path}') AS id`);
const P = (i, id = rentId, uid = LANDLORD) => `${uid}/rental-listings/${id}/p${i}.jpg`;
ok(Array.isArray(await up(LANDLORD, P(0))), "the owner uploads into their own listing's folder");
ok(refused(await up(STRANGER, P(9)), /row-level security/), "nobody uploads into the landlord's folder");
ok(refused(await up(STRANGER, P(9, rentId, STRANGER)), /row-level security/), "nor into their own folder for someone else's listing");
ok(refused(await up(LANDLORD, P(9, rentId, STRANGER)), /row-level security/), "the owner cannot upload into another member's folder, even for their own listing");
ok(refused(await up(LANDLORD, `${LANDLORD}/rental-listings/${rentId}/sub/x.jpg`), /row-level security/), "an extra path segment is refused");
ok(refused(await up(LANDLORD, `${LANDLORD}/shops/${rentId}/x.jpg`), /row-level security/), "another folder is refused");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await up(LANDLORD, P(8)), /row-level security/), "a banned owner cannot upload");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
// attach rule
const jp = `${LANDLORD}/rental-listings/${rentId}/public.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${jp}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/jpeg","size":1000}')`);
ok(refused(await attach(LANDLORD, rentId, jp), /photo_not_uploaded/), "a photo in the PUBLIC job-photos bucket can no longer be attached");
await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('listing-photos', '${P(7)}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/png","size":1000}')`);
ok(refused(await attach(LANDLORD, rentId, P(7)), /photo_not_uploaded/), "a non-JPEG object is not attached");
const photoIds = [one(await attach(LANDLORD, rentId, P(0)))];
for (let i = 1; i < 5; i++) {
  await up(LANDLORD, P(i));
  photoIds.push(one(await attach(LANDLORD, rentId, P(i))));
}
ok(photoIds.every((x) => typeof x === "string"), "five photos uploaded to listing-photos and attached");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`)), "the listing goes live");

// --- 4. storage reads/deletes: the owner and admins only; never an attached object
ok(empty(await as("authenticated", STRANGER, `SELECT name FROM storage.objects WHERE bucket_id = 'listing-photos'`)), "a stranger sees no listing-photos object");
ok(rows(await as("authenticated", LANDLORD, `SELECT name FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(0)}'`)).length === 1, "the owner sees their own object");
ok(empty(await as("authenticated", LANDLORD, `DELETE FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(0)}' RETURNING id`)), "an ATTACHED photo cannot be deleted by its owner");
ok(empty(await as("authenticated", ADMIN, `DELETE FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(0)}' RETURNING id`)), "nor by an admin");
ok(rows(await as("authenticated", LANDLORD, `DELETE FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(7)}' RETURNING id`)).length === 1, "an unattached one can");

// --- 5. Q2213: reads carry refs, never a path or a member id
const memberIds = [LANDLORD, TENANT, STRANGER, ADMIN, ORDINARY];
const browse = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`));
const bjson = JSON.stringify(browse);
ok(browse.length === 1 && Array.isArray(browse[0]?.photo_refs) && browse[0]?.photo_refs?.length === 5, "browse: five photo refs");
ok(!("photo_paths" in (browse[0] ?? {})) && !memberIds.some((u) => bjson.includes(u)) && !bjson.includes("rental-listings/"),
  "Q2213: no storage path and no member id anywhere in the browse JSON");
const REF = /^[0-9a-f-]{36}\.[pmo]\.[0-9]{10}\.[0-9a-f]{32}$/;
ok(browse[0]?.photo_refs?.every((r) => REF.test(r) && r.split(".")[1] === "m" && photoIds.includes(r.split(".")[0])), "each ref is <photo id>.m.<exp>.<sig>, in order");
const exp = Number(browse[0]?.photo_refs?.[0].split(".")[2]);
const nowS = Math.floor(Date.now() / 1000);
ok(exp > nowS + 3600 - 5 && exp <= nowS + 7200 && exp % 3600 === 0, "a ref lasts to the end of the next whole hour (1-2 h)");
const page = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${rentId}')`))[0];
const pjson = JSON.stringify(page ?? {});
ok(page && !("photo_paths" in page) && page.photo_refs?.length === 5 && page.photo_refs?.every((r) => r.split(".")[1] === "m")
  && !pjson.includes(LANDLORD) && !pjson.includes("rental-listings/"), "Q2213: the listing page gives a member refs only, no landlord id");
const own = rows(await as("authenticated", LANDLORD, `SELECT * FROM public.rentals_listing('${rentId}')`))[0];
ok(own?.photo_refs?.every((r) => r.split(".")[1] === "o"), "the owner's own page carries owner refs");
const mine = rows(await as("authenticated", LANDLORD, `SELECT * FROM public.rentals_my_listing_photos('${rentId}')`));
ok(mine.length === 5 && mine.every((r, i) => r.position === i && r.ref?.split(".")[1] === "o") && !JSON.stringify(mine).includes("rental-listings/"),
  "the editor's photo list: ids + owner refs, in order, no path");
ok(refused(await as("authenticated", STRANGER, `SELECT * FROM public.rentals_my_listing_photos('${rentId}')`), /listing_not_found/), "nobody else reads the editor list");
ok(refused(await as("anon", null, `SELECT * FROM public.rentals_my_listing_photos('${rentId}')`), /permission denied/), "anon cannot call it");
// a sale listing too
const saleId = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_sale_listing(NULL, '${prop}', '${JSON.stringify({
  headline: "Three bedroom brick home", sale_price_cents: 24500000, beds: 3, baths: 2, sq_ft: 1650 })}'::jsonb) AS id`));
for (let i = 0; i < 5; i++) { await up(LANDLORD, P(i, saleId)); await attach(LANDLORD, saleId, P(i, saleId)); }
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${saleId}', 'live')`);
const sale = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`));
const sjson = JSON.stringify(sale);
ok(sale.length === 1 && sale[0]?.photo_refs?.length === 5 && !memberIds.some((u) => sjson.includes(u)) && !sjson.includes("rental-listings/"),
  "Q2213: the Buy browse carries refs only, no member id");

// --- 6. the proxy's lookup: signature, expiry, scope rule
const obj = (ref) => svc(`SELECT public.rentals_listing_photo_object('${ref}') AS p`);
const mRef = browse[0]?.photo_refs?.[0];
const oRef = mine[0]?.ref;
ok(one(await obj(mRef)) === P(0), "a valid member ref resolves to its object path (server only)");
ok(refused(await as("anon", null, `SELECT public.rentals_listing_photo_object('${mRef}')`), /permission denied/), "anon cannot call the lookup");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_listing_photo_object('${mRef}')`), /permission denied/), "nor a member");
const [pid, , pexp, psig] = String(mRef).split(".");
ok(one(await obj(`${pid}.m.${pexp}.${"0".repeat(32)}`)) === null, "a forged signature resolves to nothing");
ok(one(await obj(`${pid}.o.${pexp}.${psig}`)) === null, "a member ref re-labelled as an owner ref resolves to nothing");
ok(one(await obj(`${photoIds[1]}.m.${pexp}.${psig}`)) === null, "a signature moved to another photo resolves to nothing");
const signed = async (id, scope, e) => { const m = `${id}.${scope}.${e}`; return `${m}.${one(await svc(`SELECT public.rentals_photo_sig('${m}')`))}`; };
ok(one(await obj(await signed(pid, "m", nowS - 10))) === null, "an expired ref resolves to nothing");
ok(one(await obj(await signed(pid, "m", nowS + 86400))) === null, "a ref further out than the database mints resolves to nothing");
ok(one(await obj("not-a-ref")) === null && one(await obj("")) === null, "garbage resolves to nothing");
// scope rules re-checked on every fetch
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'paused')`);
ok(one(await obj(mRef)) === null, "paused: a member's ref stops resolving at once");
ok(one(await obj(oRef)) === P(0), "while the owner's own ref still shows it in their editor");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`);
ok(one(await obj(mRef)) === P(0), "live again: the member ref resolves again");
// p scope: only through the public link, only while public
const slug = one(await svc(`SELECT slug FROM public.rental_listings WHERE id = '${rentId}'`));
await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'rentals'`);
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${LANDLORD}'`);
const pubRow = rows(await as("anon", null, `SELECT * FROM public.rentals_public_listing('${slug}')`))[0];
const pubJson = JSON.stringify(pubRow ?? {});
ok(pubRow && pubRow.photo_refs?.length === 5 && pubRow.photo_refs?.every((r) => r.split(".")[1] === "p") && !("photo_ids" in pubRow)
  && !memberIds.some((u) => pubJson.includes(u)) && !pubJson.includes("rental-listings/"), "the public link gives a stranger public refs only");
const pRef = pubRow?.photo_refs?.[0];
ok(one(await obj(pRef)) === P(0), "a public ref resolves while the listing is public");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
ok(one(await obj(pRef)) === null, "Homes back to testers-only: the public ref stops resolving");
ok(one(await obj(mRef)) === P(0), "while a member's still does");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${LANDLORD}')`);
ok(one(await svc(`SELECT to_regprocedure('public.rentals_public_listing_photo_path(uuid)') IS NULL`)) === true, "the old id-only lookup is gone (one ref rule for every read)");

// --- 7. Q2211: the admin take-down detaches the photos; every ref and the old URL stop working
const takedown = rows(await as("authenticated", ADMIN, `SELECT public.rentals_admin_remove_listing('${rentId}', 'Photos do not show this home.') AS paths`))[0];
ok(Array.isArray(takedown?.paths) && takedown.paths.length === 5 && takedown.paths.every((p) => p.startsWith(`${LANDLORD}/rental-listings/${rentId}/`)),
  "the take-down returns the 5 object paths for the admin screen to delete");
ok(one(await svc(`SELECT count(*)::int FROM public.rental_listing_photos WHERE listing_id = '${rentId}'`)) === 0, "the photos are detached");
ok(one(await obj(mRef)) === null && one(await obj(oRef)) === null, "Q2211: the member and owner refs of a taken-down listing resolve to nothing (proxy 404)");
ok(rows(await as("authenticated", ADMIN, `DELETE FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(0)}' RETURNING id`)).length === 1,
  "the admin deletes the detached objects");
ok(empty(await as("authenticated", STRANGER, `DELETE FROM storage.objects WHERE bucket_id = 'listing-photos' AND name = '${P(1)}' RETURNING id`)), "a stranger cannot");
ok(one(await svc(`SELECT (details->>'photos_detached')::int FROM public.admin_audit_log WHERE action = 'rentals_listing_removed' AND target_id = '${rentId}'`)) === 5,
  "the audit log records the photos detached");
ok(refused(await up(LANDLORD, P(5)), /row-level security/), "no uploads into a taken-down listing's folder");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_admin_remove_listing('${saleId}', 'Not allowed here.')`), /not_authorized/), "a member cannot take down");
// owner removal also stops every ref
const sRef = sale[0]?.photo_refs?.[0];
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${saleId}', 'removed')`);
ok(one(await obj(sRef)) === null, "an owner-removed listing's refs resolve to nothing");

// --- 8. the key and the signer are out of every client's reach
for (const role of ["anon", "authenticated", "service_role"]) {
  if (role !== "service_role") ok(refused(await as(role, role === "anon" ? null : TENANT, `SELECT secret FROM public.rentals_photo_serve_keys`), /permission denied/), `${role} cannot read the serve key`);
  ok(refused(await as(role, role === "anon" ? null : TENANT, `SELECT public.rentals_photo_ref('${pid}', 'o')`), /permission denied/), `${role} cannot mint a ref`);
}
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
const la = await acl("public.rentals_listing_photo_object(text)");
ok(/service_role=X/.test(la) && !/(^|[{,])(anon|authenticated)?=X/.test(la), `rentals_listing_photo_object: server-only (${la})`);
for (const sig of ["public.rentals_my_listing_photos(uuid)", "public.rentals_admin_remove_listing(uuid,text)", "public.rentals_listing_photo_access(text,text)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated, not anon/PUBLIC (${a})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (PHOTOS_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
