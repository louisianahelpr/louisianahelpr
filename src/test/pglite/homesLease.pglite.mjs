#!/usr/bin/env node
/**
 * PGlite proof for 20261019110137_rentals_lease (owner D4: our Louisiana lease template only; template
 * APPROVED AS WRITTEN 2026-10-18): the landlord fills and saves a draft for a live tenancy, signs and sends
 * it; the tenant reads it only once sent, asks for changes (back to an unsigned draft) or signs it with a
 * typed name, consent to sign electronically and the same text hash the landlord signed; a signed lease is
 * final and both sides keep reading it after the tenancy ends.
 *
 *   node src/test/pglite/homesLease.pglite.mjs
 *   LEASE_MIGRATION=skip node src/test/pglite/homesLease.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesLease.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019110137";
const RENT = readFileSync(`${MIG_DIR}20261019073106_rentals_rent_tracker.sql`, "utf8");
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const DEPOSIT = readFileSync(`${MIG_DIR}20261019082216_rentals_deposit_tracker.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_lease.sql`, "utf8");
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
await db.exec(newestDefinition("shop_local_today").stmt); // the Louisiana date the rent and deposit rules use
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

const skip = process.env.LEASE_MIGRATION === "skip";
await db.exec(BASE);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(LISTINGS);
await db.exec(newestDefinition("identity_is_verified").stmt);
await db.exec(definitionIn("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"));
await db.exec(IDENTITY);
await db.exec(SALE);
await db.exec(LINK);
await db.exec(PHOTOS);
await db.exec(newestDefinition("rentals_invite_tenant").stmt);
await db.exec(newestDefinition("rentals_accept_invite").stmt);
await db.exec(RENT);
await db.exec(DEPOSIT);
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


const today = one(await svc(`SELECT public.shop_local_today()::text`));
const prop = one(await as("authenticated", LANDLORD, `SELECT public.rentals_create_property('Oak house', '123 Oak St', 'Lafayette', '70501') AS id`));
await as("authenticated", LANDLORD, `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`);
await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'ok')`);
const unitA = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Main') AS id`));
const unitB = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit B') AS id`));
const tenancy = async (unit, tenant) => {
  const tok = one(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}') AS t`));
  await as("authenticated", tenant, `SELECT public.rentals_accept_invite('${tok}')`);
  return one(await svc(`SELECT id FROM public.rental_tenancies WHERE unit_id = '${unit}' AND tenant_id = '${tenant}' AND status = 'active'`));
};
const tA = await tenancy(unitA, TENANT);
const tB = await tenancy(unitB, TENANT2);
ok(typeof tA === "string" && typeof tB === "string", "setup: two active tenancies");
await svc(`UPDATE public.profiles SET idv_status = 'verified', date_of_birth = '1990-01-01' WHERE user_id = '${TENANT2}'`);

const H1 = "a".repeat(64), H2 = "b".repeat(64);
const V = "la-2026-10-14";
const q = (s) => s.replace(/'/g, "''");
const read = async (uid, t) => { const r = await as("authenticated", uid, `SELECT public.rentals_lease('${t}') AS l`); return Array.isArray(r) ? r[0]?.l : r; };
const save = (uid, t, fields, v = V) => as("authenticated", uid, `SELECT public.rentals_lease_save('${t}', '${v}', '${q(JSON.stringify(fields))}'::jsonb) AS id`);
// The landlord's app sends the version and blanks it hashed with the hash (lead review #1); by default the stored ones.
const stored = async (id) => rows(await svc(`SELECT template_version, fields, sent_at::text AS sent_at, public.rentals_lease_initial_keys(fields) AS ini FROM public.rental_leases WHERE id = '${id}'`))[0] ?? {};
const arr = (a) => `ARRAY[${(a ?? []).map((x) => `'${q(x)}'`).join(",")}]::text[]`;
const send = async (uid, id, h = H1, name = "Dana Landlord", o = {}) => {
  const st = await stored(id);
  const fields = o.fields ?? st.fields ?? {};
  return as("authenticated", uid, `SELECT public.rentals_lease_send('${id}', '${o.version ?? st.template_version ?? V}', '${q(JSON.stringify(fields))}'::jsonb, '${h}', '${q(name)}', ${o.consent ?? true}, ${arr(o.initials ?? st.ini)})`);
};
const sign = async (uid, id, h = H1, name = "Terry Tenant", consent = true, o = {}) => {
  const st = await stored(id);
  const sentAt = o.sentAt ?? st.sent_at;
  return as("authenticated", uid, `SELECT public.rentals_lease_sign('${id}', ${sentAt ? `'${sentAt}'` : "NULL"}, '${h}', '${q(name)}', ${consent}, ${arr(o.initials ?? st.ini)})`);
};
const ask = (uid, id, note) => as("authenticated", uid, `SELECT public.rentals_lease_request_changes('${id}', '${q(note)}')`);
const withdraw = (uid, id) => as("authenticated", uid, `SELECT public.rentals_lease_withdraw('${id}')`);
const discard = (uid, id) => as("authenticated", uid, `SELECT public.rentals_lease_discard('${id}')`);
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));
// A complete fill of la-2026-10-14 (the server refuses to send a lease with a required blank empty, lead review #9).
const F1 = {
  lease_date: "2026-10-20", landlord_name: "Dana Landlord", tenant_names: "Terry Tenant", home_address: "123 Oak St, Lafayette, LA 70501",
  home_type: "house", bedrooms: "3", bathrooms: "2", home_includes: "yard", term_kind: "fixed", start_date: "2026-11-01", end_date: "2027-10-31",
  monthly_notice_days: "30", early_move_in: false, rent_amount: "1200", rent_due_day: "1", pay_methods: "Zelle", payee: "Dana",
  first_rent_amount: "1200", first_rent_due: "at signing", partial_month: "prorated daily", late_after_day: "5", late_fee: "50",
  daily_late: false, late_fee_cap: "$100", returned_payment_fee: "$25", deposit_amount: "1200", deposit_due: "at signing",
  tenant_utilities: "electric", landlord_utilities: "none", occupants: "none", guest_days_row: "14", guest_days_six_months: "30",
  emergency_contact: "Pat, 337-555-0100", furnishings: "unfurnished", appliances: "stove", tenant_supplies: "none", as_is: false,
  checklist_days: "5", pets_allowed: false, no_smoking_property: false, picture_hooks_ok: true, extra_rules: "None", ac_landlord: true,
  lawn: "Landlord provides lawn care", filter_days: "30", filters_supplied: false, pest_control: "Landlord", detector_locations: "hall",
  entry_notice_hours: "24", key_count: "2", key_cost: "25", landlord_contact: "d@example.com", tenant_contact: "337-555-0101",
  landlord_address: "PO Box 1", sale_ends_lease: false, early_exit: false, insurance: "recommended", accelerate: false,
  notice_waiver: false, federal_mortgage: false, holdover_amount: "$40 per day", assume_condition: false, additional_terms: "None",
  built_before_1978: false, foreclosure: "none", flood_disclosure: false,
};

// --- nothing yet
const r0 = await read(TENANT, tA);
ok(r0?.side === "tenant" && r0.open === null && Array.isArray(r0.signed) && r0.signed.length === 0 && r0.can_edit === false, "no lease yet: the tenant reads an empty record and cannot edit");
ok((await read(LANDLORD, tA))?.can_edit === true, "the landlord of the live tenancy can start one");
ok(refused(await read(STRANGER, tA), /tenancy_not_found/, "P0002"), "a stranger reads nothing");

// --- the draft: the landlord's
ok(refused(await save(TENANT, tA, F1), /tenancy_not_found/, "P0002"), "the tenant cannot write the lease");
ok(refused(await save(STRANGER, tA, F1), /tenancy_not_found/, "P0002"), "nor a stranger");
ok(refused(await save(LANDLORD, tA, F1, "v2"), /bad_lease_fields/, "22023"), "a template version must be one of ours (la-YYYY-MM-DD)");
ok(refused(await save(LANDLORD, tA, { "Bad Key": "x" }), /bad_lease_fields/), "blank names are lower-case words");
ok(refused(await save(LANDLORD, tA, { notes: { nested: true } }), /bad_lease_fields/), "a blank is text or yes/no, never an object");
ok(refused(await save(LANDLORD, tA, { notes: "x".repeat(4001) }), /bad_lease_fields/), "a blank holds at most 4000 characters");
ok(refused(await save(LANDLORD, tA, Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`k${i}`, "x"]))), /bad_lease_fields/), "at most 300 blanks");
const id = one(await save(LANDLORD, tA, F1));
ok(typeof id === "string", "the landlord saves a draft");
ok(one(await save(LANDLORD, tA, { ...F1, rent_amount: "1250" })) === id, "a second save updates the same draft (one open lease per tenancy)");
const dL = await read(LANDLORD, tA), dT = await read(TENANT, tA);
ok(dL?.open?.status === "draft" && dL.open.fields.rent_amount === "1250", "the landlord reads the draft's blanks");
ok(dT?.open?.status === "draft" && !("fields" in dT.open) && !("id" in dT.open) && !("updated_at" in dT.open) && !("template_version" in dT.open),
  "lead #8: the tenant sees only that a lease is being prepared: no blanks, no id, no save times");
ok(refused(await as("authenticated", TENANT, `SELECT * FROM public.rental_leases`), /permission denied/), "no client reads the table directly");
ok(refused(await as("authenticated", LANDLORD, `UPDATE public.rental_leases SET status = 'signed'`), /permission denied/), "nor writes it");
ok(refused(await sign(TENANT, id), /lease_not_found/, "P0002"), "the tenant cannot sign a draft (its id is not even confirmed)");
ok(refused(await ask(TENANT, id, "Please change the rent"), /lease_not_found/), "nor send a draft back");

// --- lead review #1 #3 #4 #9: what the landlord signs is exactly what is stored, complete, consented and initialed
ok(refused(await send(LANDLORD, id, H1, "Dana Landlord", { fields: { ...F1, rent_amount: "999" } }), /lease_changed/, "22023"),
  "#1: blanks other than the stored ones (a second tab saved meanwhile) are refused");
ok(refused(await send(LANDLORD, id, H1, "Dana Landlord", { version: "la-2099-01-01" }), /lease_changed/), "#1: and so is another template version");
await save(LANDLORD, tA, { ...F1, rent_amount: "1250", deposit_amount: "" });
ok(refused(await send(LANDLORD, id), /lease_incomplete/, "22023"), "#9: a required blank left empty is refused by the server");
await save(LANDLORD, tA, { ...F1, rent_amount: "1250", term_kind: "fixed", end_date: undefined });
ok(refused(await send(LANDLORD, id), /lease_incomplete/), "#9: and so is a blank required by a choice (a fixed term needs its end date)");
ok(one(await svc(`SELECT array_to_string(public.rentals_lease_missing('la-2026-10-14', '${q(JSON.stringify({ ...F1, pets_allowed: true }))}'::jsonb), ',')`))
  === "pet_deposit,pet_fee,pet_list,pet_max,pet_rent,pet_weight_limit", "#9: choosing pets asks for every pet blank");
await save(LANDLORD, tA, { ...F1, rent_amount: "1250" });
ok(refused(await save(LANDLORD, tA, { ...F1, landlord_name: "O\u2019Brien" }), /bad_lease_fields/), "#4: a curly quote (non-ASCII) never reaches the stored lease");
ok(refused(await send(LANDLORD, id, H1, "Dana Landlord", { consent: false }), /lease_consent_required/), "#3: the landlord must agree to sign electronically");
await save(LANDLORD, tA, { ...F1, rent_amount: "1250", notice_waiver: true });
ok(refused(await send(LANDLORD, id, H1, "Dana Landlord", { initials: [] }), /lease_initials_required/), "#3: each initialed clause chosen must be ticked");
ok(refused(await send(LANDLORD, id, H1, "Jos\u00e9 Landlord"), /bad_signature/), "#4: a typed name is printable ASCII (the app normalises accents)");
await save(LANDLORD, tA, { ...F1, rent_amount: "1250" });

// --- sign and send
ok(refused(await send(TENANT, id), /lease_not_found/, "P0002"), "only the landlord sends");
ok(refused(await send(LANDLORD, id, H1, "D"), /bad_signature/, "22023"), "a signature is a typed name of 2+ characters");
ok(refused(await send(LANDLORD, id, "nothex"), /bad_lease_fields/), "the text hash must be a sha256");
ok(Array.isArray(await send(LANDLORD, id, H1, "  Dana   Landlord ")), "the landlord signs and sends");
ok((await notes(TENANT, "Lease ready to sign")) === 1, "the tenant is told");
const sT = await read(TENANT, tA);
ok(sT?.open?.status === "sent" && sT.open.fields.rent_amount === "1250" && sT.open.landlord_signed_name === "Dana Landlord" && sT.open.body_sha256 === H1,
  "the tenant now reads the blanks, the landlord's signature (spaces tidied) and the text hash");
ok(refused(await save(LANDLORD, tA, F1), /lease_awaiting_signature/, "22023"), "a sent lease cannot be edited until taken back");
ok(refused(await send(LANDLORD, id), /lease_not_open/, "22023"), "nor sent twice");

// --- changes asked: back to an unsigned draft with the tenant's note
ok(refused(await ask(TENANT, id, "x"), /bad_change_request/, "22023"), "a change request needs a note");
ok(Array.isArray(await ask(TENANT, id, "Please allow my cat.")), "the tenant asks for changes");
ok((await notes(LANDLORD, "Lease changes asked")) === 1, "the landlord is told");
const cL = await read(LANDLORD, tA);
ok(cL?.open?.status === "draft" && cL.open.change_request === "Please allow my cat." && cL.open.landlord_signed_name === null && cL.open.body_sha256 === null,
  "it is a draft again: the landlord's signature and hash are gone, the note is kept");
ok((await read(TENANT, tA))?.open?.change_request === "Please allow my cat.", "the tenant sees their note too");
ok(Array.isArray(await save(LANDLORD, tA, { ...F1, rent_amount: "1300" })), "the landlord edits");

// --- withdraw: the landlord takes back a sent lease
ok(Array.isArray(await send(LANDLORD, id, H2)), "the landlord sends it again");
ok((await read(LANDLORD, tA))?.open?.change_request === null, "sending clears the old note");
ok(refused(await withdraw(TENANT, id), /lease_not_found/), "only the landlord takes it back");
ok(Array.isArray(await withdraw(LANDLORD, id)), "the landlord takes it back");
const wL = await read(LANDLORD, tA);
ok(wL?.open?.status === "draft" && wL.open.landlord_signed_name === null && wL.open.landlord_signed_at === null && wL.open.body_sha256 === null,
  "taken back: a draft again, the landlord's signature gone (they sign again when they send)");
ok(!("fields" in ((await read(TENANT, tA))?.open ?? {})) && (await notes(TENANT, "Lease taken back")) === 1, "the tenant no longer sees the blanks, and is told");
ok(Array.isArray(await send(LANDLORD, id, H2)), "and sends it once more");

// --- the tenant signs: consent, a name, and the same text
ok(refused(await sign(TENANT, id, H2, "Terry Tenant", false), /lease_consent_required/, "22023"), "signing needs agreement to sign electronically");
ok(refused(await sign(TENANT, id, H2, " "), /bad_signature/), "and a typed name");
ok(refused(await sign(TENANT, id, H1), /lease_changed/, "22023"), "a different text hash than the landlord signed is refused");
ok(refused(await sign(LANDLORD, id, H2), /lease_not_found/), "the landlord cannot sign as the tenant");
ok(refused(await sign(TENANT, id, H2, "Terry Tenant", true, { sentAt: "2001-01-01T00:00:00Z" }), /lease_changed/),
  "#1: the tenant signs only the version they read (a lease taken back and sent again has a new sent_at)");
// Round 2 #2: the text hash is bound to the blanks the server fingerprinted at send; blanks changed since
// (any path) are refused even with the right text hash.
await svc(`ALTER TABLE public.rental_leases DISABLE TRIGGER rental_leases_signed_is_final`);
await svc(`UPDATE public.rental_leases SET fields = fields || '{"rent_amount": "9999"}'::jsonb WHERE id = '${id}'`);
ok(refused(await sign(TENANT, id, H2), /lease_changed/), "round 2 #2: blanks that changed after sending cannot be signed, even with the sent text hash");
await svc(`UPDATE public.rental_leases SET fields = fields || '{"rent_amount": "1300"}'::jsonb WHERE id = '${id}'`);
await svc(`ALTER TABLE public.rental_leases ENABLE TRIGGER rental_leases_signed_is_final`);
ok(typeof one(await svc(`SELECT blanks_sha256 FROM public.rental_leases WHERE id = '${id}'`)) === "string", "the server's own fingerprint of the blanks is kept from the send");
ok(Array.isArray(await sign(TENANT, id, H2)), "the tenant signs");
ok((await notes(LANDLORD, "Lease signed")) === 1 && (await notes(TENANT, "Lease signed")) === 1, "both are told");
const fin = await read(LANDLORD, tA);
ok(fin?.open === null && fin.signed.length === 1 && fin.signed[0].tenant_signed_name === "Terry Tenant" && fin.signed[0].fields.rent_amount === "1300"
  && fin.signed[0].body_sha256 === H2 && typeof fin.signed[0].landlord_signed_at === "string" && typeof fin.signed[0].tenant_signed_at === "string",
  "the signed lease: both names and times, the blanks and the hash");
ok(typeof fin?.signed?.[0]?.landlord_consent_at === "string" && typeof fin.signed[0].tenant_consent_at === "string"
  && fin.signed[0].home_label === "Oak house, Main (123 Oak St, Lafayette 70501)",
  "#3: both consents are recorded; the home is kept in words");
ok(refused(await sign(TENANT, id, H2), /lease_not_open/), "signing twice is refused");
ok(refused(await withdraw(LANDLORD, id), /lease_not_open/), "a signed lease cannot be taken back");
ok(refused(await svc(`UPDATE public.rental_leases SET fields = '{}' WHERE id = '${id}'`), /lease_signed_is_final/), "a signed lease never changes, even from the server");
ok(refused(await svc(`DELETE FROM public.rental_leases WHERE id = '${id}'`), /lease_signed_is_final/), "nor is deleted while either party remains");

// --- a renewal is a new lease; a draft can be discarded
const id2 = one(await save(LANDLORD, tA, F1));
ok(typeof id2 === "string" && id2 !== id, "a new lease (renewal) can be started after one is signed");
ok(refused(await discard(TENANT, id2), /lease_not_found/), "only the landlord discards a draft");
ok(Array.isArray(await discard(LANDLORD, id2)) && (await read(LANDLORD, tA))?.open === null && (await read(LANDLORD, tA))?.signed.length === 1,
  "the landlord discards the draft; the signed lease stays");

// --- after the tenancy ends: both still read the signed lease; nothing new is written
const id3 = one(await save(LANDLORD, tA, F1));
ok(Array.isArray(await send(LANDLORD, id3)), "setup: a sent, unsigned lease");
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_end_tenancy('${tA}')`)), "the tenancy ends");
ok(one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE tenancy_id = '${tA}' AND status <> 'signed'`)) === 0
  && one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE tenancy_id = '${tA}' AND status = 'signed'`)) === 1,
  "round 2 #1: a normal end takes the unsigned lease with it; the signed one is untouched");
ok((await read(TENANT, tA))?.signed?.length === 1 && (await read(LANDLORD, tA))?.can_edit === false, "both still read the signed lease; the landlord can no longer edit");
ok(refused(await sign(TENANT, id3), /lease_not_found/), "a lease left unsigned cannot be signed after the end");
ok(refused(await save(LANDLORD, tA, F1), /tenancy_not_found/), "nor a new one started");

// --- gates
const idB = one(await save(LANDLORD, tB, F1));
ok(typeof idB === "string", "setup: the landlord's other tenancy has a draft");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await save(LANDLORD, tB, F1), /feature_disabled/), "Homes off: no writes");
ok(refused(await read(LANDLORD, tB), /feature_disabled/), "nor reads");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await send(LANDLORD, idB), /account_restricted/), "a banned landlord cannot send");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
ok(Array.isArray(await send(LANDLORD, idB)), "setup: sent to the second tenant");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${TENANT2}'`);
ok(refused(await sign(TENANT2, idB), /account_restricted/), "a banned tenant cannot sign");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${TENANT2}'`);
await svc(`UPDATE auth.users SET email_confirmed_at = NULL WHERE id = '${TENANT2}'`);
ok(refused(await sign(TENANT2, idB), /email/i), "Q807: an unconfirmed email cannot sign");
await svc(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${TENANT2}'`);
ok(refused(await as("anon", null, `SELECT public.rentals_lease('${tB}')`), /permission denied/), "anon cannot read");

// --- Download My Data (20261019111310): the leases section, its real text, run for each person
const EXPORT_SQL = readFileSync(`${MIG_DIR}20261019111310_export_my_data_rental_leases.sql`, "utf8");
const secStart = EXPORT_SQL.indexOf("  -- Homes lease (20261019110137)");
const secEnd = EXPORT_SQL.indexOf("  RETURN v_out;", secStart);
ok(secStart > 0 && secEnd > secStart, "setup: the export's leases section found in the migration");
await svc(`CREATE OR REPLACE FUNCTION public.export_sections_probe(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE v_uid uuid := p_user_id; v_out jsonb := '{}'::jsonb;
BEGIN
${EXPORT_SQL.slice(secStart, secEnd)}  RETURN v_out;
END $probe$`);
const ex = async (u) => one(await svc(`SELECT public.export_sections_probe('${u}')`))?.rental_leases;
ok(Array.isArray(await withdraw(LANDLORD, idB)), "setup: the second tenant's lease is a draft again");
await svc(`UPDATE public.rental_leases SET change_request = 'Shorter term please' WHERE id = '${idB}'`);
const exL = await ex(LANDLORD), exT = await ex(TENANT), exT2 = await ex(TENANT2), exS = await ex(STRANGER);
ok(exL?.length === 2 && exL.every((l) => l.fields && typeof l.fields === "object"), "export: the landlord gets every lease with its blanks (signed, and the draft; the unsigned one went with the ended tenancy)");
ok(exT?.length === 1 && exT[0].status === "signed" && exT[0].tenant_signed_name === "Terry Tenant", "export: the tenant gets the signed lease");
ok(exT2?.length === 1 && exT2[0].status === "draft" && exT2[0].change_request === "Shorter term please" && !("fields" in exT2[0]) && !("id" in exT2[0]),
  "export: a draft gives the tenant only its status and their own note, never its blanks");
ok(Array.isArray(exS) && exS.length === 0, "export: a stranger gets none");

const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_lease(uuid)", "public.rentals_my_leases()", "public.rentals_lease_save(uuid,text,jsonb)",
  "public.rentals_lease_send(uuid,text,jsonb,text,text,boolean,text[])", "public.rentals_lease_withdraw(uuid)", "public.rentals_lease_discard(uuid)",
  "public.rentals_lease_request_changes(uuid,text)", "public.rentals_lease_sign(uuid,timestamptz,text,text,boolean,text[])"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated, not anon/PUBLIC (${a})`);
}
for (const sig of ["public.rentals_lease_missing(text,jsonb)", "public.rentals_lease_initial_keys(jsonb)", "public.rentals_lease_signature(text)",
  "public.rentals_lease_signed_json(rental_leases,uuid)"]) {
  const h = await acl(sig);
  ok(!/(^|[{,])(anon|authenticated)?=X/.test(h), `${sig}: server-only (${h})`);
}
const fa = await acl("public.rentals_lease_for_action(uuid,text,text)");
ok(!/(^|[{,])(anon|authenticated)?=X/.test(fa), `rentals_lease_for_action: server-only (${fa})`);


// --- lead review #2 #6: a signed lease belongs to both people; it outlives the tenancy and the other's account
const myL = async (uid) => one(await as("authenticated", uid, `SELECT public.rentals_my_leases() AS l`));
ok((await myL(TENANT))?.length === 1 && (await myL(LANDLORD))?.length === 1 && (await myL(STRANGER))?.length === 0,
  "#2: each party finds every signed lease, whatever happened to the tenancy (a stranger none)");
const signedId = (await myL(TENANT))?.[0]?.id;
await svc(`UPDATE public.rental_leases SET tenancy_id = tenancy_id WHERE id = '${signedId}'`); // a no-op write is allowed
// Round 2 #1: a tenant who deletes their account while a lease is sent to them leaves no unsigned row.
ok(Array.isArray(await send(LANDLORD, idB)), "setup: a lease sent to the second tenant");
const before2 = one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE status = 'signed'`));
await svc(`DELETE FROM auth.users WHERE id = '${TENANT2}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE id = '${idB}'`)) === 0
  && one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE status = 'signed'`)) === before2,
  "round 2 #1: the deleted tenant's unsigned lease is gone (nothing of theirs kept); signed leases untouched");
const delL = await svc(`DELETE FROM auth.users WHERE id = '${LANDLORD}'`);
ok(Array.isArray(delL), `#6 setup: the landlord deletes their account (${delL?.error ?? "ok"})`);
const afterT = await myL(TENANT);
ok(afterT?.length === 1 && afterT[0].id === signedId && afterT[0].tenancy_id === null && afterT[0].tenant_signed_name === "Terry Tenant",
  "#6: the tenant keeps the signed lease after the landlord's account (and so the tenancy) is gone");
ok(one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE status <> 'signed'`)) === 0, "#6: unsigned leases go with their tenancy");
ok(refused(await svc(`UPDATE public.rental_leases SET body_sha256 = '${H1}' WHERE id = '${signedId}'`), /lease_signed_is_final/), "#6: and stays final");
await svc(`DELETE FROM auth.users WHERE id = '${TENANT}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.rental_leases WHERE id = '${signedId}'`)) === 0, "#6: once both people are gone it goes too");
console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (LEASE_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
