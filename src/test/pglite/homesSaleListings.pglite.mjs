#!/usr/bin/env node
/**
 * PGlite proof for 20261019061241_rentals_sale_listings (Homes -> BUY: homes for
 * sale by their verified owners, Slice 2; owner 2026-10-18: verified owners,
 * no commission, no negotiating, a title company or attorney closes, a FLAT
 * listing fee whose amount the owner sets later).
 *
 *   node src/test/pglite/homesSaleListings.pglite.mjs
 *   SALE_MIGRATION=skip node src/test/pglite/homesSaleListings.pglite.mjs   # RED: every sale check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesSaleListings.pglite.mjs
 *
 * The same prod-shaped stubs and base chain as rentalsListings.pglite.mjs
 * (Rentals S1, listings 20261019043000, its export, the identity helper
 * 20261019051407 + 20261019061019), then this migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019061241";
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_sale_listings.sql`, "utf8");
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

const skip = process.env.SALE_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(LISTINGS);
await db.exec(newestDefinition("identity_is_verified").stmt);
await db.exec(definitionIn("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"));
await db.exec(IDENTITY);
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

// --- gates
ok(refused(await as("anon", null, `SELECT public.rentals_save_sale_listing(NULL, '${prop}', '${S()}'::jsonb)`), /permission denied/),
  "anon cannot execute rentals_save_sale_listing");
ok(refused(await as("anon", null, `SELECT * FROM public.rentals_browse_sale_listings()`), /permission denied/), "anon cannot browse homes for sale");
ok(refused(await save(ORDINARY, null, prop), /feature_disabled/, "42501"), "testers only: an ordinary account is refused");
ok(refused(await save(MINOR, null, prop), /under_18/, "42501"), "under 18 is refused");
ok(refused(await save(BANNED, null, prop), /account_restricted/, "42501"), "a banned account is refused");
ok(refused(await save(NOIDV, null, prop), /identity_not_verified/, "42501"), "VERIFIED OWNERS ONLY: no ID check, refused");
ok(refused(await save(STRANGER, null, prop), /property_not_found/, "P0002"), "a stranger cannot list someone else's property");
ok(refused(await save(LANDLORD, null, prop2), /ownership_not_approved/, "42501"), "VERIFIED OWNERS ONLY: ownership not approved, refused");
ok(refused(await save(LANDLORD, null, prop, { rent_cents: 100000 }), /bad_listing/, "22023"), "a rent field is refused on a sale listing");
ok(refused(await save(LANDLORD, null, prop, { sale_price_cents: 5000 }), /bad_listing/, "22023"), "a price below $10,000 is refused");
ok(refused(await save(LANDLORD, null, prop, { year_built: 1500 }), /bad_listing/, "22023"), "a year built before 1700 is refused");

// --- draft, wording (fair housing + no haggling), photos, the fee gate, publish
const draft = one(await save(LANDLORD, null, prop, { description: "Price is negotiable, OBO. Perfect for a young couple." }));
ok(typeof draft === "string", "the owner saves a draft (flagged wording is allowed in a draft)");
const flags = one(await svc(`SELECT wording_flags FROM public.rental_listings WHERE id = '${draft}'`)) ?? [];
ok(flags.includes("negotiable") && flags.includes("or best offer") && flags.includes("perfect for"),
  `NO NEGOTIATING: haggling words are flagged with the fair-housing ones (${flags})`);
const kindRow = rows(await svc(`SELECT kind, unit_id, rent_cents, sale_price_cents FROM public.rental_listings WHERE id = '${draft}'`))[0];
ok(kindRow?.kind === "sale" && kindRow.unit_id === null && kindRow.rent_cents === null && Number(kindRow.sale_price_cents) === 24500000,
  "a sale listing is the whole property with a price (kind sale, no unit, no rent)");
ok(refused(await save(LANDLORD, null, prop), /property_already_listed/, "22023"), "one open sale listing per property");
ok(refused(await status(LANDLORD, draft, "live"), /wording_flagged/, "22023"), "a flagged sale listing cannot go live");
ok(typeof one(await save(LANDLORD, draft, null)) === "string", "the owner rewrites it");
ok(one(await svc(`SELECT cardinality(wording_flags) FROM public.rental_listings WHERE id = '${draft}'`)) === 0, "the rewrite clears the flags");
ok(refused(await save(STRANGER, draft, null), /listing_not_found/, "P0002"), "a stranger cannot edit it (P0002)");
ok(refused(await status(LANDLORD, draft, "live"), /too_few_photos/, "22023"), "no photos: cannot go live");
const putObj = (name) =>
  svc(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', '${name}', '${LANDLORD}', '${LANDLORD}', '{"mimetype":"image/jpeg","size":1000}')`);
for (let i = 0; i < 5; i++) {
  const path = `${LANDLORD}/rental-listings/${draft}/p${i}.jpg`;
  await putObj(path);
  await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${draft}', '${path}')`);
}
ok(one(await svc(`SELECT count(*)::int FROM public.rental_listing_photos WHERE listing_id = '${draft}'`)) === 5, "five photos attach (the shared photo path)");
// THE FEE GATE: a fee above 0 with no payment flow refuses the publish.
await svc(`UPDATE public.platform_settings SET homes_sale_listing_fee_cents = 4900`);
ok(refused(await status(LANDLORD, draft, "live"), /listing_fee_not_ready/, "22023"), "FEE GATE: a fee above 0 refuses the publish (never shown unpaid)");
ok(one(await svc(`SELECT status FROM public.rental_listings WHERE id = '${draft}'`)) === "draft", "and the listing stays a draft");
ok(refused(await svc(`UPDATE public.platform_settings SET homes_sale_listing_fee_cents = -1`), /check|violates/), "the fee is never negative");
await svc(`UPDATE public.platform_settings SET homes_sale_listing_fee_cents = 0`);
ok(one(await svc(`SELECT column_default FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'homes_sale_listing_fee_cents'`)) === "0",
  "the fee defaults to 0 (off until the owner sets it)");
ok(Array.isArray(await status(LANDLORD, draft, "live")), "fee 0: the owner publishes it, nothing charged");
ok(refused(await save(LANDLORD, draft, null, { description: "Make an offer!" }), /wording_flagged/, "22023"), "a live listing cannot be edited into haggling words");

// --- reads: Buy shows sale only, Rent shows rent only
const rentDraft = one(await as("authenticated", LANDLORD, `SELECT public.rentals_save_listing(NULL, '${unit}', '${JSON.stringify({
  headline: "Bright 2 bed near downtown", rent_cents: 120000, beds: 2, baths: 1, available_on: "2026-11-01" })}'::jsonb) AS id`));
for (let i = 0; i < 5; i++) {
  const path = `${LANDLORD}/rental-listings/${rentDraft}/r${i}.jpg`;
  await putObj(path);
  await as("authenticated", LANDLORD, `SELECT public.rentals_add_listing_photo('${rentDraft}', '${path}')`);
}
await status(LANDLORD, rentDraft, "live");
const forSale = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`));
ok(forSale.length === 1 && forSale[0].id === draft && Number(forSale[0].sale_price_cents) === 24500000 && forSale[0].city === "Lafayette",
  "Buy browse: the sale listing with its price, city and ZIP");
ok(!JSON.stringify(forSale).includes("123 Oak"), "Buy browse never carries the street address (Q12)");
const forRent = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_listings()`));
ok(forRent.length === 1 && forRent[0].id === rentDraft, "Rent browse shows the rent listing only, never the sale one");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings('70501', 3, 25000000)`)).length === 1, "Buy filters: ZIP, beds, max price");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings(NULL, NULL, 20000000)`)), "Buy filters: under the price shows nothing");
const page = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${draft}')`))[0];
ok(page?.kind === "sale" && Number(page.sale_price_cents) === 24500000 && page.year_built === 1998 && page.lot_sq_ft === 8700
  && !JSON.stringify(page).includes("123 Oak"), "the listing page carries kind, price, year built and lot size, no street");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_listing('${rentDraft}')`))[0]?.kind === "rent", "and a rent page says rent");

// --- endings: sold is sale's, leased is rent's; a sold listing stays sold
ok(refused(await status(LANDLORD, draft, "leased"), /bad_status/, "22023"), "a sale listing cannot be marked rented");
ok(refused(await status(LANDLORD, rentDraft, "sold"), /bad_status/, "22023"), "a rent listing cannot be marked sold");
ok(Array.isArray(await status(LANDLORD, draft, "sold")), "the owner marks it sold");
ok(empty(await as("authenticated", TENANT, `SELECT * FROM public.rentals_browse_sale_listings()`)), "a sold listing leaves the browse");
ok(refused(await status(LANDLORD, draft, "live"), /bad_status/, "22023"), "a sold listing cannot be shown again");
ok(refused(await save(LANDLORD, draft, null), /listing_not_editable/, "22023"), "a sold listing cannot be edited");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_save_sale_listing('${rentDraft}', NULL, '${S()}'::jsonb)`), /listing_not_found/, "P0002"),
  "the sale editor cannot rewrite a rent listing");
ok(typeof one(await save(LANDLORD, null, prop)) === "string", "after a sale, the property can be listed again (a new listing)");

// --- the wording helper
const fl = async (t) => one(await svc(`SELECT public.homes_sale_wording_flags('${t.replace(/'/g, "''")}')`)) ?? ["?"];
ok((await fl("Updated kitchen, walk to the park. Price is firm.")).length === 0, "wording: plain facts and a firm price pass");
ok((await fl("Make me an offer")).includes("make an offer"), "wording: 'make me an offer' is flagged");
ok((await fl("Will haggle")).includes("negotiable"), "wording: 'haggle' is flagged");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.homes_sale_wording_flags('x')`), /permission denied/), "the sale wording helper is server-only");

// --- grants
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_save_sale_listing(uuid,uuid,jsonb)", "public.rentals_set_listing_status(uuid,text)",
  "public.rentals_browse_listings(text,numeric,integer,integer,integer)", "public.rentals_browse_sale_listings(text,numeric,bigint,integer,integer)",
  "public.rentals_listing(uuid)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated yes, anon/PUBLIC no (${a})`);
}
const wa = await acl("public.homes_sale_wording_flags(text)");
ok(/service_role=X/.test(wa) && !/(^|[{,])(anon|authenticated)?=X/.test(wa), `homes_sale_wording_flags: server-only (${wa})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (SALE_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
