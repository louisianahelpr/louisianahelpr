#!/usr/bin/env node
/**
 * PGlite proof for 20261019062540_rentals_public_link_takedown: the public
 * listing link (D12: anyone with the link, no exact address, no member id in
 * what a stranger receives, Q2188) and the admin take-down (Q2187).
 *
 *   node src/test/pglite/homesPublicLink.pglite.mjs
 *   LINK_MIGRATION=skip node src/test/pglite/homesPublicLink.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesPublicLink.pglite.mjs
 *
 * Same prod-shaped stubs and base chain as homesSaleListings.pglite.mjs, then
 * the sale migration, then this one 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019062540";
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_public_link_takedown.sql`, "utf8");
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

const skip = process.env.LINK_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(LISTINGS);
await db.exec(newestDefinition("identity_is_verified").stmt);
await db.exec(definitionIn("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"));
await db.exec(IDENTITY);
await db.exec(SALE);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

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

// --- setup: an approved property (with a unit, for a rent listing too) and an unapproved one.
const prop = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak house', '123 Oak St', 'Lafayette', '70501') AS id`));
const unit = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Main') AS id`));
await as("authenticated", LANDLORD, `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`);
await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'ok')`);
const prop2 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Elm house', '9 Elm St', 'Lafayette', '70503') AS id`));
ok(typeof prop === "string" && typeof unit === "string" && typeof prop2 === "string", "setup: an approved and an unapproved property");

const S = (o = {}) => JSON.stringify({
  headline: "Three bedroom brick home with a big yard", description: "New roof in 2024, updated kitchen, fenced back yard.",
  sale_price_cents: 24500000, beds: 3, baths: 2, sq_ft: 1650, lot_sq_ft: 8700, year_built: 1998, parking: "garage",
  accessibility: ["step_free_entrance"], ...o,
}).replace(/'/g, "''");
const save = (uid, id, p, o) => as("authenticated", uid, `SELECT public.rentals_save_sale_listing(${id ? `'${id}'` : "NULL"}, ${p ? `'${p}'` : "NULL"}, '${S(o)}'::jsonb) AS id`);
const status = (uid, id, s) => as("authenticated", uid, `SELECT public.rentals_set_listing_status('${id}', '${s}')`);

const live = async (uid, id, prefix) => {
  for (let i = 0; i < 5; i++) {
    const path = `${uid}/rental-listings/${id}/${prefix}${i}.jpg`;
    await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${path}', '${uid}', '${uid}', '{"mimetype":"image/jpeg","size":1000}')`);
    await as("authenticated", uid, `SELECT public.rentals_add_listing_photo('${id}', '${path}')`);
  }
  return as("authenticated", uid, `SELECT public.rentals_set_listing_status('${id}', 'live')`);
};
const rentId = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit}', '${JSON.stringify({
  headline: "Bright 2 bed near downtown", rent_cents: 120000, beds: 2, baths: 1, available_on: "2026-11-01" })}'::jsonb) AS id`));
ok(Array.isArray(await live(LANDLORD, rentId, "r")), "setup: a live rent listing with five photos");
const slug = one(await svc(`SELECT slug FROM public.rental_listings WHERE id = '${rentId}'`));
const pub = (role, uid, s = slug) => as(role, uid, `SELECT * FROM public.rentals_public_listing('${s}')`);

// --- review #6: public ONLY once Homes is open to everyone, and never a test or seed account's listing
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "while Homes is testers-only, no public link works");
await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'rentals'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "a test account's listing is never public (LANDLORD is a test account)");
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${LANDLORD}'`);
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${LANDLORD}'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "nor a seed account's");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${LANDLORD}'`);

// --- D12: anyone with the link
const anonRow = rows(await pub("anon", null))[0];
ok(anonRow?.headline === "Bright 2 bed near downtown" && anonRow.city === "Lafayette" && anonRow.zip_code === "70501",
  "D12: a signed-out visitor opens the listing by its link (city + ZIP)");
ok(rows(await pub("authenticated", ORDINARY)).length === 1, "D12: a signed-in member outside the testers opens it too (anyone with the link)");
const text = JSON.stringify(anonRow ?? {});
ok(!text.includes("123 Oak") && !("street_address" in (anonRow ?? {})), "no exact address in what a stranger receives (Q12)");
const memberIds = [LANDLORD, TENANT, STRANGER, ADMIN, ORDINARY];
ok(anonRow && !memberIds.some((u) => text.includes(u)) && !text.includes("rental-listings/"),
  "Q2188: no member's id and no storage path anywhere in the public JSON");
ok(Array.isArray(anonRow?.photo_ids) && anonRow.photo_ids.length === 5, "the photos come as five ids, in order");
ok(!("id" in (anonRow ?? {})) && !("owner_id" in (anonRow ?? {})), "no listing id, no owner id");
ok(refused(await pub("anon", null, "zzzz"), /listing_not_found/, "P0002"), "a malformed link is not found");
ok(refused(await pub("anon", null, "0123456789ab"), /listing_not_found/, "P0002"), "an unknown link is not found");

// --- the photo proxy's lookup: server only, visible listings only
const photoId = anonRow?.photo_ids?.[0];
const path = one(await svc(`SELECT public.rentals_public_listing_photo_path('${photoId}')`));
ok(typeof path === "string" && path.startsWith(`${LANDLORD}/rental-listings/${rentId}/`), "the proxy lookup returns the object path for a visible listing's photo");
ok(refused(await as("anon", null, `SELECT public.rentals_public_listing_photo_path('${photoId}')`), /permission denied/), "anon cannot call the path lookup");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_public_listing_photo_path('${photoId}')`), /permission denied/), "nor can a member");

// --- hidden states: paused, switch off, draft
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'paused')`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "a paused listing's link says not found");
ok(one(await svc(`SELECT public.rentals_public_listing_photo_path('${photoId}')`)) === null, "and its photos stop resolving");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "with the Homes switch off, no link works");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "back to testers-only: no public link");
await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'rentals'`);
ok(rows(await pub("anon", null)).length === 1, "open to everyone again: the link works again");

// --- review #9: every hidden state is hidden from a stranger too
await svc(`UPDATE public.rental_listings SET expires_at = now() - interval '1 minute' WHERE id = '${rentId}'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "an expired listing's link says not found");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "a banned owner's listing link says not found");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
await svc(`UPDATE public.rental_properties SET ownership_status = 'rejected' WHERE id = '${prop}'`);
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "ownership revoked: the link says not found");
await svc(`UPDATE public.rental_properties SET ownership_status = 'approved' WHERE id = '${prop}'`);
const unit2 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit B') AS id`));
const draftId = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit2}', '${JSON.stringify({
  headline: "Upstairs one bedroom", rent_cents: 90000, beds: 1, baths: 1, available_on: "2026-12-01" })}'::jsonb) AS id`));
const draftSlug = one(await svc(`SELECT slug FROM public.rental_listings WHERE id = '${draftId}'`));
ok(refused(await pub("anon", null, draftSlug), /listing_not_found/, "P0002"), "a draft's link says not found");
ok(rows(await pub("anon", null)).length === 1, "and the live one still opens");

// --- Q2187: the admin take-down, on the PROPERTY (lead review of slices 2+3, must-fix 1-7)
const remove = (uid, id, reason = "Photos do not show this home.") =>
  as("authenticated", uid, `SELECT public.rentals_admin_remove_listing('${id}', '${reason}')`);
const lift = (uid, p, note = "Removed by mistake.") => as("authenticated", uid, `SELECT public.rentals_admin_lift_takedown('${p}', '${note}')`);
// a live sale listing on the same property, and a draft on another unit, before the take-down
const saleId = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_sale_listing(NULL, '${prop}', '${JSON.stringify({
  headline: "Three bedroom brick home, built 1998, 8700 sq ft lot, 123 Oak St", description: "Call about 123 Oak St.",
  sale_price_cents: 24500000, beds: 3, baths: 2.5, sq_ft: 1650, lot_sq_ft: 8700, year_built: 1998 })}'::jsonb) AS id`));
await live(LANDLORD, saleId, "s");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`)).length === 1, "setup: a live sale listing on the same property");
const saleSlug = one(await svc(`SELECT slug FROM public.rental_listings WHERE id = '${saleId}'`));
const saleRow = rows(await pub("anon", null, saleSlug))[0];
ok(saleRow?.kind === "sale", "a sale listing's link works too, saying sale");
ok(saleRow && saleRow.sq_ft === null && saleRow.lot_sq_ft === null && saleRow.year_built === null,
  "review #5: a stranger gets no home size, lot size or year built for a home for sale (with the ZIP they name the parcel)");
ok(saleRow && saleRow.headline === "3 bed, 2.5 bath home for sale" && saleRow.description === null && !JSON.stringify(saleRow).includes("Oak"),
  "must-fix 4: a stranger gets a plain headline and no description for a home for sale (the owner's words can name the street, year or lot)");
ok(rows(await as("authenticated", TENANT, `SELECT headline FROM public.rentals_listing('${saleId}')`))[0]?.headline.includes("brick"), "a signed-in member still reads the owner's headline");

ok(refused(await remove(LANDLORD, rentId), /not_authorized/, "42501"), "a member (even the owner) cannot use the take-down");
ok(refused(await as("anon", null, `SELECT public.rentals_admin_remove_listing('${rentId}', 'xxxxx')`), /permission denied/), "anon cannot execute it");
ok(refused(await remove(ADMIN, rentId, "no"), /reason_required/, "22023"), "a take-down needs a reason");
ok(refused(await remove(ADMIN, draftId), /listing_not_live/, "22023"), "must-fix 6: a draft (not live or paused) is not taken down");
const admOpen = rows(await as("authenticated", ADMIN, `SELECT public.rentals_admin_listings() AS a`))[0]?.a;
ok(admOpen?.open?.some((x) => x.id === rentId) && admOpen.open.some((x) => x.id === saleId) && !admOpen.open.some((x) => x.id === draftId),
  "the admin card lists live and paused listings to take down (not drafts)");
const openQ = async (q, oo = 0) => rows(await as("authenticated", ADMIN, `SELECT public.rentals_admin_listings('${q}', ${oo}, 0) AS a`))[0]?.a;
ok((await openQ(slug))?.open?.map((x) => x.id).join() === rentId, "round 4 #5: the open list finds a listing by its link code");
ok((await openQ("BRICK"))?.open?.map((x) => x.id).join() === saleId, "by headline words (any case)");
ok((await openQ("70501"))?.open_total === 2 && (await openQ("70501", 1))?.open?.length === 1 && admOpen.page_size === 25, "by ZIP, paged with a total");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(Array.isArray(await remove(ADMIN, rentId)), "an admin removes a live listing, even with the Homes switch off (moderation is never gated)");
await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'rentals'`);
const after = rows(await svc(`SELECT status, removed_by_admin, removed_reason, removed_from_status FROM public.rental_listings WHERE id = '${rentId}'`))[0];
ok(after?.status === "removed" && after.removed_by_admin === true && after.removed_reason === "Photos do not show this home." && after.removed_from_status === "live",
  "removed, by an admin, with the reason and what it was");
const all = rows(await svc(`SELECT id, status, removed_by_admin FROM public.rental_listings WHERE property_id = '${prop}' ORDER BY id`));
ok([saleId, draftId].every((x) => all.find((r) => r.id === x)?.status === "removed" && all.find((r) => r.id === x)?.removed_by_admin === true),
  "must-fix 2: every OPEN listing on the property goes (the sale listing and the draft on another unit too)");
ok(one(await as("authenticated", LANDLORD, `SELECT listings_taken_down_reason FROM public.rental_properties WHERE id = '${prop}'`)) === "Photos do not show this home.",
  "the property carries the take-down and its reason, and the owner can read it (column grant)");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`)), "it leaves the Rent browse");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`)), "and the Buy browse");
ok(refused(await pub("anon", null), /listing_not_found/, "P0002"), "and its public link");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`), /listing_not_editable/), "the owner cannot put it back up");
const audit = rows(await svc(`SELECT details FROM public.admin_audit_log WHERE action = 'rentals_listing_removed' AND target_id = '${rentId}'`));
ok(audit.length === 1 && audit[0].details.listings_removed.length === 3, "the take-down is in the admin audit log, naming every listing it removed");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'Listing removed'`)) >= 1, "the owner is told why");
ok(refused(await remove(ADMIN, rentId), /listing_not_live/, "22023"), "a taken-down listing cannot be taken down twice");
// must-fix 1 + 7: nothing on the property is saved, given photos or published again: a new unit, either kind
const unit3 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit C') AS id`));
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit3}', '${JSON.stringify({
  headline: "Bright 2 bed near downtown", rent_cents: 120000, beds: 2, baths: 1, available_on: "2026-11-01" })}'::jsonb)`), /listing_taken_down/, "42501"),
  "must-fix 1/7: a NEW unit on the property cannot even start a draft");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_save_sale_listing(NULL, '${prop}', '${JSON.stringify({
  headline: "Three bedroom brick home", sale_price_cents: 24500000, beds: 3, baths: 2 })}'::jsonb)`), /listing_taken_down/, "42501"),
  "nor a listing of the other kind (sale)");
const strayPath = `${LANDLORD}/rental-listings/${rentId}/late.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${strayPath}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/jpeg","size":1000}')`);
ok(refused(await svc(`INSERT INTO public.rental_listing_photos (listing_id, owner_id, storage_path, position) VALUES ('${rentId}', '${LANDLORD}', '${strayPath}', 20)`), /listing_taken_down/),
  "must-fix 7: no photo is attached to a listing on a taken-down property (trigger, whatever the writer)");
// round 3 must-fix 3: the same home cannot simply be added again (normalised address, same owner)
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak again', '123  OAK st.', 'Lafayette', '70501')`), /property_taken_down/, "42501"),
  "the owner cannot add the taken-down address again (case, spacing and punctuation ignored)");
ok(typeof one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Other', '77 Pine St', 'Lafayette', '70501') AS id`)) === "string",
  "a different address is fine");
// round 4 #2: the key is normalised (suffixes, directions, unit/apt part, ZIP+4), and ANY other owner's match is flagged
const key = async (st, z) => one(await svc(`SELECT public.rentals_address_key('${st}', '${z}')`));
ok((await key("123 Oak Street, Apt 4", "70501-1234")) === (await key("123 oak st", "70501")), "round 4 #2: 'Street, Apt 4' and ZIP+4 key the same as 'st'");
ok((await key("45 North Elm Avenue #2B", "70503")) === (await key("45 N. Elm Ave", "70503")), "directions, avenue/ave and a '#' unit key the same");
ok((await key("9 Pine Road Suite 100", "70503")) === (await key("9 PINE RD", "70503")), "road/rd and a suite key the same");
ok((await key("124 Oak St", "70501")) !== (await key("123 Oak St", "70501")), "a different house number is a different home");
ok((await key("123 Oak St", "70508")) !== (await key("123 Oak St", "70501")), "a different ZIP is a different home");
ok((await key("12 Aptitude Ln", "70501")) === "12 aptitude ln|70501", "a street word that only starts like a unit word is kept");
ok((await key("Unit 4, 123 Oak Street", "70501")) === (await key("123 Oak St", "70501")), "lead round 4 #1: a LEADING unit part goes too");
ok((await key("#B 123 Oak St", "70501")) === (await key("123 Oak St", "70501")), "and a leading '#B'");
ok((await key("400 Ste Marie St", "70501")) === "400 ste marie st|70501", "lead round 4 #1: 'Ste Marie' (a real street word) is kept");
ok((await key("400 Ste Marie St Ste 2B", "70501")) === "400 ste marie st|70501", "but 'Ste 2B' after the street is a suite and goes");
ok((await key("9 Building Rd", "70501")) === "9 building rd|70501" && (await key("9 Main St Room 12", "70501")) === "9 main st|70501",
  "'building'/'room' count only before a number");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak unit', '123 Oak Street, Unit 4', 'Lafayette', '70501-1234')`), /property_taken_down/, "42501"),
  "the owner cannot add it back as 'Street, Unit 4' with a ZIP+4 either");
const otherProp = one(await as("authenticated", STRANGER, `SELECT public.rentals_create_property('My Oak', '123 Oak Street', 'Lafayette', '70501') AS id`));
ok(typeof otherProp === "string", "another member adding the same address is not refused (it is flagged to the reviewer)");
const otherClean = one(await as("authenticated", STRANGER, `SELECT public.rentals_create_property('Mine', '500 Cedar Dr', 'Lafayette', '70501') AS id`));
const matches = one(await as("authenticated", ADMIN, `SELECT public.rentals_admin_takedown_matches(ARRAY['${otherProp}', '${otherClean}']::uuid[])`));
ok(Array.isArray(matches) && matches.length === 1 && matches[0].property_id === otherProp && matches[0].matched_property_id === prop
  && matches[0].matched_street === "123 Oak St" && matches[0].same_owner === false && matches[0].reason === "Photos do not show this home.",
  "round 4 #2: the reviewer sees the other owner's match, with the matched taken-down address and its reason (and nothing for a clean address)");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_admin_takedown_matches(ARRAY['${otherProp}']::uuid[])`), /not_authorized/, "42501"),
  "a member cannot read the matches (the street is admin-only)");
ok(refused(await as("anon", null, `SELECT public.rentals_admin_takedown_matches(ARRAY['${otherProp}']::uuid[])`), /permission denied/), "nor anon");
// must-fix 6: lifting a mistaken take-down (admin only, audited): drafts back to draft, live/paused back to paused
ok(refused(await lift(LANDLORD, prop), /not_authorized/, "42501"), "a member cannot lift a take-down");
ok(refused(await lift(ADMIN, prop, "no"), /reason_required/, "22023"), "lifting needs a note");
const adm = rows(await as("authenticated", ADMIN, `SELECT public.rentals_admin_listings() AS a`))[0]?.a;
ok(adm?.taken_down?.length === 1 && adm.taken_down[0].property_id === prop && adm.taken_down[0].reason === "Photos do not show this home." && !JSON.stringify(adm).includes("Oak St"),
  "the admin card lists the taken-down property with its reason (no street)");
// round 4 #5: search (link code, headline or label words, ZIP) and pages of 25 with totals
const admQ = async (q, oo = 0, to = 0) => rows(await as("authenticated", ADMIN, `SELECT public.rentals_admin_listings(${q === null ? "NULL" : `'${q}'`}, ${oo}, ${to}) AS a`))[0]?.a;
ok((await admQ("photos do not"))?.taken_down_total === 0 && (await admQ("oak"))?.taken_down_total === 1, "the taken-down list searches by property label (not by the reason)");
ok((await admQ(slug))?.taken_down?.[0]?.property_id === prop, "and by a listing's link code on that property");
ok((await admQ("70501"))?.taken_down_total === 1 && (await admQ("70599"))?.taken_down_total === 0, "and by ZIP");
ok((await admQ(null, 0, 25))?.taken_down?.length === 0 && (await admQ(null, 0, 25))?.taken_down_total === 1, "a page past the end is empty but keeps the total");
ok(refused(await as("authenticated", ADMIN, `SELECT public.rentals_admin_listings('${"x".repeat(101)}', 0, 0)`), /bad_query/, "22023"), "an over-long search is refused");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_admin_listings()`), /not_authorized/, "42501"), "a member cannot read the admin list");
ok(refused(await as("anon", null, `SELECT public.rentals_admin_listings()`), /permission denied/), "nor anon");
ok(Array.isArray(await lift(ADMIN, prop)), "an admin lifts it");
const afterLift = one(await as("authenticated", ADMIN, `SELECT public.rentals_admin_takedown_matches(ARRAY['${otherProp}']::uuid[])`));
ok(Array.isArray(afterLift) && afterLift.length === 0, "once lifted, the other owner's property is no longer flagged");
const back = rows(await svc(`SELECT id, status, removed_by_admin FROM public.rental_listings WHERE id IN ('${rentId}', '${saleId}', '${draftId}') ORDER BY id`));
const st = (x) => back.find((r) => r.id === x);
ok(st(rentId)?.status === "paused" && st(saleId)?.status === "paused" && st(draftId)?.status === "draft" && back.every((r) => r.removed_by_admin === false),
  "each listing goes back to paused (was live) or draft (was a draft), never straight to live");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'rentals_takedown_lifted' AND target_id = '${prop}'`)) === 1, "the lift is in the audit log");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'live')`)), "the owner publishes again through every check");
ok(refused(await lift(ADMIN, prop), /listing_not_found/, "P0002"), "nothing to lift twice");
// must-fix 5: sold and leased are final
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'leased')`);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${rentId}', 'removed')`), /bad_status/), "must-fix 5: a leased listing cannot be removed by its owner (final)");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${saleId}', 'live')`)), "setup: the sale listing live again");
await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${saleId}', 'sold')`);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_listing_status('${saleId}', 'removed')`), /bad_status/), "nor a sold one");
ok(refused(await remove(ADMIN, saleId), /listing_not_live/, "22023"), "and a sold listing (history) is not taken down");

// --- grants
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
const pa = await acl("public.rentals_public_listing(text)");
ok(/anon=X/.test(pa) && /authenticated=X/.test(pa) && !/(^|[{,])=X/.test(pa), `rentals_public_listing: anon + authenticated by name, not PUBLIC (${pa})`);
for (const sig of ["public.rentals_admin_remove_listing(uuid,text)", "public.rentals_admin_lift_takedown(uuid,text)",
  "public.rentals_admin_listings(text,integer,integer)", "public.rentals_admin_takedown_matches(uuid[])"]) {
  const ra = await acl(sig);
  ok(/authenticated=X/.test(ra) && !/(^|[{,])(anon)?=X/.test(ra), `${sig}: authenticated (admin checked inside), anon/PUBLIC no (${ra})`);
}
for (const sig of ["public.rentals_public_listing_photo_path(uuid)", "public.rentals_public_listing_visible(uuid)", "public.rentals_address_key(text,text)"]) {
  const a = await acl(sig);
  ok(/service_role=X/.test(a) && !/(^|[{,])(anon|authenticated)?=X/.test(a), `${sig}: server-only (${a})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (LINK_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
