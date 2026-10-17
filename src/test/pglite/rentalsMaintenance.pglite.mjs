#!/usr/bin/env node
/**
 * PGlite proof for 20261017205605_rentals_maintenance_requests (Rentals S1,
 * docs/specs/landlord-hub-prep.md Q37-Q48, Q5-Q6, Q53, Q59).
 *
 *   node src/test/pglite/rentalsMaintenance.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/rentalsMaintenance.pglite.mjs     # RED: every check fails
 *   S3=skip node src/test/pglite/rentalsMaintenance.pglite.mjs                # RED for the slice 3 restatements only
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/rentalsMaintenance.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL (anon/authenticated
 * EXECUTE on every new function, so a REVOKE that forgets anon is caught),
 * auth.users/auth.uid(), storage.objects with RLS (the live columns), profiles
 * (gate columns), jobs (the columns the RPCs read), notifications, user_roles/
 * has_role, test_accounts, admin_audit_log. The helpers the migration calls
 * (is_caller_banned, member_under_18, contact_leak_reason) are NOT re-typed:
 * their NEWEST definitions are read out of supabase/migrations.
 * notification_crosses_seed_boundary is stubbed to false (it runs inside the
 * best-effort email block, which PGlite cannot reach: no net/vault, and before
 * a staff notice); the Q137 section below loads its newest definition. Then
 * 20261012031120_hidden_feature_switches.sql, then the migration 3x.
 * export_my_data is created (plpgsql bodies compile lazily) but not run here:
 * src/test/dataExportCoversEveryUserTable.test.ts checks its sections.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261017205605";
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_maintenance_requests.sql`,
  "utf8",
);
// The client's column list for rental_properties (src/lib/rentals/api.ts), read so the proof tests what the app sends.
const RENTAL_PROPERTY_COLUMNS = readFileSync(new URL("../../lib/rentals/api.ts", import.meta.url), "utf8")
  .match(/export const RENTAL_PROPERTY_COLUMNS =\s*"([^"]+)";/)?.[1] ?? "id";
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
// Rentals slice 3 restatements, applied (3x) after S1 in version order. S3=skip leaves S1's bodies (the RED run).
const S3_FILES = ["20261017220911_rentals_link_one_live_job.sql", "20261017221621_rentals_visit_time.sql",
  "20261017223352_rentals_ownership_review_alert.sql"];
const S3 = process.env.S3 === "skip" ? "SELECT 1" : S3_FILES.map((f) => readFileSync(`${MIG_DIR}${f}`, "utf8")).join("\n");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith(SELF)).sort()) {
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
  payment_status text, stripe_session_id text, helper_id uuid);
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
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  for (let i = 0; i < 3; i++) await db.exec(S3);
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

const createProp = (label = "Oak Street duplex") =>
  `SELECT public.rentals_create_property('${label}', '123 Oak St', 'Lafayette', '70501') AS id`;

// --- the switch
const sw = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'rentals'`);
ok(Array.isArray(sw) && sw[0]?.audience === "off", "switch 'rentals' is created OFF");
ok(refused(await as("authenticated", LANDLORD, createProp()), /feature_disabled/, "42501"),
  "switch off: even a test account is refused (feature_disabled 42501)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await db.exec(skip ? "SELECT 1" : MIGRATION);
await db.exec(skip ? "SELECT 1" : S3);
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'rentals'`)) === "testers",
  "a replay keeps the audience an admin chose");
ok(refused(await as("authenticated", ORDINARY, createProp()), /feature_disabled/, "42501"),
  "testers: an ordinary account is refused at the server (feature_disabled)");
ok(refused(await as("anon", null, createProp()), /permission denied/), "anon cannot execute rentals_create_property");

// --- landlord gates (Q5, Q59)
ok(refused(await as("authenticated", NOIDV, createProp()), /identity_not_verified/, "42501"),
  "an account without a verified ID cannot add a property (Q5)");
ok(refused(await as("authenticated", MINOR, createProp()), /under_18/, "42501"), "under 18 cannot add a property (Q59)");
ok(refused(await as("authenticated", BANNED, createProp()), /account_restricted/, "42501"), "a banned account cannot add a property");
const prop = one(await as("authenticated", LANDLORD, createProp()));
ok(typeof prop === "string", "an ID-verified tester landlord adds a property");
ok(one(await svc(`SELECT ownership_status FROM public.rental_properties WHERE id = '${prop}'`)) === "needs_proof",
  "a new property needs ownership proof");
const unit = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit A') AS id`));
ok(typeof unit === "string", "the landlord adds a unit");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_add_unit('${prop}', 'Unit B')`), /property_not_found/, "P0002"),
  "a stranger cannot add a unit to someone else's property");

// --- ownership proof + admin review (Q6, Q53)
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}')`), /ownership_not_approved/, "42501"),
  "no invites before an admin approves the ownership proof");
ok(refused(await as("authenticated", LANDLORD,
  `SELECT public.rentals_submit_ownership_proof('${prop}', '${STRANGER}/rentals/${prop}/deed.pdf')`), /bad_proof_path/, "22023"),
  "proof in someone else's folder is refused");
ok(Array.isArray(await as("authenticated", LANDLORD,
  `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`)),
  "proof in the landlord's own folder for this property is accepted");
ok(one(await svc(`SELECT ownership_status FROM public.rental_properties WHERE id = '${prop}'`)) === "pending_review",
  "the property waits for admin review");
// Slice 3 ("no alert when ownership proof waits for review"): the admin-queue alert, once, closing itself.
const proofAlerts = () => svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${ADMIN}' AND title = 'Ownership proof waits for review' AND type = 'admin_alert'`);
ok(one(await proofAlerts()) === 1, "alert: every admin is told the proof waits (admin_alert)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'Ownership proof waits for review'`)) === 0,
  "alert: the landlord is not");
ok(Array.isArray(await as("authenticated", LANDLORD,
  `SELECT public.rentals_submit_ownership_proof('${prop}', '${LANDLORD}/rentals/${prop}/deed.pdf')`)) && one(await proofAlerts()) === 1,
  "alert: a re-upload while it already waits does not page again");
ok(one(await svc(`SELECT public.admin_alert_close_rule('Ownership proof waits for review')`)) === "rentals-ownership-review",
  "alert: its title has a close rule (the admin-queue class, Q355)");
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-ownership-review', '{}'::jsonb, now())`)) === true,
  "alert: it stays open while the proof waits");
ok(one(await svc(`SELECT public.admin_alert_close_rule('Ban settlement review still waiting')`)) === "ban-settlement-review",
  "alert: the restated close rule keeps the live rows");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_admin_review_property('${prop}', true, NULL)`), /not_authorized/, "42501"),
  "a non-admin cannot approve ownership");
ok(refused(await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', false, '')`), /reason_required/, "22023"),
  "an admin rejection needs a reason");
ok(Array.isArray(await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${prop}', true, 'Assessor page matches')`)),
  "an admin approves the ownership proof");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'rentals_ownership_approved' AND target_id = '${prop}'`)) === 1,
  "the approval is written to admin_audit_log");
// Owner decision 2026-10-17: the landlord sees "Approved by Louisiana Helpr", never which admin.
const approvedLink = one(await svc(`SELECT link FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'Property approved'`));
ok(approvedLink === "/rentals", `the landlord's approval notice carries no admin id (link ${approvedLink})`);
ok(one(await svc(`SELECT ownership_reviewed_by FROM public.rental_properties WHERE id = '${prop}'`)) === ADMIN,
  "the server still records which admin reviewed it");
ok(refused(await as("authenticated", LANDLORD, `SELECT ownership_reviewed_by FROM public.rental_properties WHERE id = '${prop}'`), /permission denied/),
  "the landlord cannot read ownership_reviewed_by");
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-ownership-review', '{}'::jsonb, now())`)) === false,
  "alert: it closes once no proof waits");
ok(refused(await as("authenticated", LANDLORD, `SELECT * FROM public.rental_properties WHERE id = '${prop}'`), /permission denied/),
  "nor through select * (the client names its columns)");
const ownerRow = rows(await as("authenticated", LANDLORD, `SELECT to_jsonb(t) AS j FROM (SELECT ${RENTAL_PROPERTY_COLUMNS} FROM public.rental_properties WHERE id = '${prop}') t`))[0]?.j;
ok(ownerRow?.ownership_status === "approved" && !("ownership_reviewed_by" in ownerRow) && !JSON.stringify(ownerRow).includes(ADMIN),
  "the landlord's own read (the client's column list) returns the row with no reviewer id anywhere in it");
ok(refused(await as("authenticated", ADMIN, `SELECT ownership_reviewed_by FROM public.rental_properties WHERE id = '${prop}'`), /permission denied/),
  "no client read returns it, an admin's included (staff-only: the server and admin_audit_log)");

// --- invites (Q37)
const token = one(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}') AS t`));
ok(typeof token === "string" && /^[0-9a-f]{64}$/.test(token), "the landlord gets a 64-hex invite token");
ok(one(await svc(`SELECT count(*)::int FROM public.rental_tenancies WHERE invite_token_sha256 = '${token}'`)) === 0 && !skip,
  "the plain token is never stored (only its SHA-256)");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_invite_tenant('${unit}')`), /unit_not_found/, "P0002"),
  "a stranger cannot invite to someone else's unit");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_accept_invite('${token}')`), /own_invite/),
  "the landlord cannot accept their own invite");
ok(refused(await as("authenticated", MINOR, `SELECT public.rentals_accept_invite('${token}')`), /under_18/, "42501"),
  "under 18 cannot accept an invite (Q59)");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_accept_invite('${"0".repeat(64)}')`), /invite_not_found/, "P0002"),
  "a made-up token is refused");
const tenancy = one(await as("authenticated", TENANT, `SELECT public.rentals_accept_invite('${token}') AS id`));
ok(typeof tenancy === "string", "the invited tenant accepts");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_accept_invite('${token}')`), /invite_not_found/, "P0002"),
  "a used invite cannot be accepted again by someone else");
const token2 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}') AS t`));
await svc(`UPDATE public.rental_tenancies SET invite_expires_at = now() - interval '1 minute' WHERE status = 'invited'`);
ok(refused(await as("authenticated", TENANT2, `SELECT public.rentals_accept_invite('${token2}')`), /invite_not_found/, "P0002"),
  "an expired invite is refused");

// --- reads (RLS)
ok(empty(await as("authenticated", TENANT, `SELECT id FROM public.rental_properties`)),
  "the tenant cannot read the property row (proof path, admin review, auto-approve limit)");
ok(rows(await as("authenticated", TENANT, `SELECT label, street_address FROM public.rentals_my_homes()`))[0]?.label === "Oak Street duplex",
  "the tenant reads their home's name and address through rentals_my_homes()");
ok(empty(await as("authenticated", STRANGER, `SELECT label FROM public.rentals_my_homes()`)), "a stranger rents no home");
ok(rows(await as("authenticated", TENANT, `SELECT id FROM public.rental_units`)).length === 1, "the active tenant reads their unit");
ok(empty(await as("authenticated", STRANGER, `SELECT id FROM public.rental_units`)), "a stranger reads no unit");
ok(rows(await as("authenticated", TENANT, `SELECT id FROM public.rental_tenancies WHERE status = 'active'`)).length === 1,
  "the tenant reads their own tenancy (authenticated SELECT grant on rental_tenancies)");
ok(rows(await as("authenticated", LANDLORD, `SELECT id FROM public.rental_tenancies`)).length >= 1,
  "the landlord reads the unit's tenancies");
ok(empty(await as("authenticated", STRANGER, `SELECT id FROM public.rental_tenancies`)), "a stranger reads no tenancy");
ok(empty(await as("authenticated", STRANGER, `SELECT id FROM public.rental_properties`)),
  "a stranger reads no property");
ok(rows(await as("authenticated", ADMIN, `SELECT id FROM public.rental_properties`)).length === 1,
  "an admin reads properties (review queue)");

// --- filing (Q38, Q40)
const file = (uid, t, { urgency = "soon", desc = "Kitchen sink drips all night long.", photos = "NULL", windows = "Weekdays after 5pm" } = {}) =>
  as("authenticated", uid, `SELECT public.rentals_file_request('${t}', 'plumbing', '${desc}', '${urgency}', '${windows}',
    true, false, 'Gate code 4471', ${photos}) AS id`);
ok(refused(await file(STRANGER, tenancy), /tenancy_not_found/, "P0002"), "a stranger cannot file on someone else's tenancy");
ok(refused(await file(TENANT, tenancy, { desc: "Call me at 337 555 1234 about the sink" }), /contact_info_not_allowed|Phone/),
  "a phone number in the description is refused (existing message filter)");
ok(refused(await file(TENANT, tenancy, { photos: `ARRAY['${STRANGER}/rentals/requests/${U(50)}/a.jpg']` }), /bad_photo_path/, "22023"),
  "a photo outside the tenant's own folder is refused");
ok(refused(await file(TENANT, tenancy, { urgency: "now" }), /bad_urgency/, "22023"), "an unknown urgency is refused");
const photoPath = `${TENANT}/rentals/requests/${U(51)}/sink.jpg`;
const req1 = one(await file(TENANT, tenancy, { photos: `ARRAY['${photoPath}']` }));
ok(typeof req1 === "string", "the tenant files a request with a photo");
ok(one(await svc(`SELECT status FROM public.maintenance_requests WHERE id = '${req1}'`)) === "submitted",
  "auto-approve OFF by default: the request waits for the landlord (Q48)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'New maintenance request'`)) === 1,
  "the landlord is notified of the new request");
const emerg = one(await file(TENANT, tenancy, { urgency: "emergency", desc: "Water pouring from the ceiling now." }));
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title LIKE 'EMERGENCY%'`)) === 1,
  "an emergency alerts the landlord at once (Q40)");
ok(typeof emerg === "string" && one(await svc(`SELECT count(*)::int FROM public.jobs`)) === 0, "filing never creates a job or sends a Helpr (Q39/Q40)");

// --- reads of requests + photos
ok(rows(await as("authenticated", LANDLORD, `SELECT id FROM public.maintenance_requests`)).length === 2, "the landlord reads both requests");
ok(rows(await as("authenticated", TENANT, `SELECT id FROM public.maintenance_requests`)).length === 2, "the tenant reads their requests");
ok(empty(await as("authenticated", STRANGER, `SELECT id FROM public.maintenance_requests`)), "a stranger reads none");
ok(rows(await as("authenticated", TENANT, `SELECT storage_path FROM public.maintenance_request_photos`))[0]?.storage_path === photoPath,
  "the tenant reads their request's photo row (authenticated SELECT grant on maintenance_request_photos)");
ok(rows(await as("authenticated", LANDLORD, `SELECT storage_path FROM public.maintenance_request_photos`)).length === 1,
  "the landlord reads the request's photo row");
ok(empty(await as("authenticated", STRANGER, `SELECT storage_path FROM public.maintenance_request_photos`)), "a stranger reads no photo row");
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', '${photoPath}'), ('user-documents', '${TENANT}/other/x.jpg')`);
ok(rows(await as("authenticated", LANDLORD, `SELECT name FROM storage.objects`)).map((r) => r.name).join() === photoPath,
  "the landlord reads exactly the request's photo object, nothing else of the tenant's");
ok(typeof req1 === "string" && empty(await as("authenticated", STRANGER, `SELECT name FROM storage.objects`)), "a stranger reads no photo object");
ok(refused(await as("authenticated", LANDLORD, `UPDATE public.maintenance_requests SET status = 'approved'`), /permission denied/),
  "a client cannot write requests directly (RPCs only)");

// --- decline (Q46)
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_decline_request('${emerg}', NULL, NULL)`), /reason_required/, "22023"),
  "declining needs a reason");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_decline_request('${emerg}', 'other', '')`), /reason_required/, "22023"),
  "'other' needs words");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_decline_request('${emerg}', 'handle_myself', NULL)`), /request_not_found/, "P0002"),
  "the tenant cannot decline their own request");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_decline_request('${emerg}', 'already_scheduled', 'Plumber booked for 9am')`)),
  "the landlord declines with a reason");
const dec = await as("authenticated", TENANT, `SELECT status, decline_reason_code, decline_reason_text, decided_at FROM public.maintenance_requests WHERE id = '${emerg}'`);
ok(rows(dec)[0]?.decline_reason_code === "already_scheduled" && rows(dec)[0]?.decided_at != null,
  "the tenant sees the reason, and the record keeps the date");

// --- approve + link the posted job (Q39)
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_approve_request('${req1}')`), /request_not_found/, "P0002"),
  "a stranger cannot approve");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_approve_request('${req1}')`)), "the landlord approves");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Request approved'`)) === 1,
  "the tenant is told it was approved");
const jobL = one(await svc(`INSERT INTO public.jobs (customer_id, status) VALUES ('${LANDLORD}', 'open') RETURNING id`));
const jobS = one(await svc(`INSERT INTO public.jobs (customer_id, status) VALUES ('${STRANGER}', 'open') RETURNING id`));
ok(refused(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${jobS}')`), /not your open job/, "42501"),
  "a job the landlord does not own cannot be linked");
ok(refused(await as("authenticated", TENANT, `SELECT public.link_maintenance_request_job('${req1}', '${jobL}') AS ok`), /not your open job/, "42501"),
  "the tenant cannot link a job");
ok(one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${jobL}') AS ok`)) === true,
  "the landlord links the job they posted from the request");
ok(one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${emerg}', '${jobL}') AS ok`)) === false,
  "a declined request cannot be linked");
const st = (uid) => as("authenticated", uid, `SELECT booking, job_id::text AS j FROM public.rentals_request_job_state('${req1}')`);
ok(rows(await st(TENANT))[0]?.booking === "unpaid" && rows(await st(TENANT))[0]?.j === jobL,
  "linked but unpaid with no checkout: 'unpaid' (not booked; slice 3: still payable, so not 'none')");
ok(empty(await st(STRANGER)), "a stranger gets no job state for someone else's request");
await svc(`UPDATE public.jobs SET payment_status = 'unpaid', stripe_session_id = 'cs_live_x' WHERE id = '${jobL}'`);
ok(rows(await st(LANDLORD))[0]?.booking === "paying", "a checkout in flight reads 'paying'");
const jobL2 = one(await svc(`INSERT INTO public.jobs (customer_id, status) VALUES ('${LANDLORD}', 'open') RETURNING id`));
ok(one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${jobL2}') AS ok`)) === false,
  "a request whose checkout is in flight is never re-pointed (no double payment)");
// Slice 3 ("two tabs can still pay twice for one repair request"; lh-money-escrow re-review of bb5b8bc6e):
// the request moves off its job only once that job is SETTLED. Each row: the current job's state, what the
// screen reads, and whether a second post (a fresh open unpaid job, as tab B makes) may take the request.
// The first row is the two-tab race: tab A linked jobL and is still on photos/geocode/create-payment (open,
// unpaid, NO session) when tab B links its own post. PGlite has one connection, so the race is replayed in
// its dangerous order; on prod the two links serialize on the request row (FOR UPDATE) and the second
// re-reads the committed job_id.
const MATRIX = [
  ["open", "unpaid", null, "unpaid", false, "two tabs: tab A's job open, unpaid, no session yet"],
  ["open", null, null, "unpaid", false, "never reached checkout (NULL payment status)"],
  ["open", "unpaid", "cs_live_x", "paying", false, "a checkout in flight"],
  ["open", "failed", null, "unpaid", false, "a declined card whose session expired (still payable)"],
  ["open", "failed", "cs_live_x", "paying", false, "a declined card inside a live session"],
  ["open", "abandoned", "cs_live_x", "unpaid", false, "an expired checkout: create-payment re-mints 'abandoned'"],
  ["open", "escrow", null, "booked", false, "funded"],
  ["open", "chargeback", null, "refunding", false, "a chargeback (can return to escrow)"],
  ["cancelled", "cancelling", null, "refunding", false, "cancelled mid-refund (can return to escrow)"],
  ["cancelled", "escrow", null, "refunding", false, "cancelled with money still held"],
  ["cancelled", "unpaid", "cs_live_x", "paying", false, "cancelled with a checkout that may still complete"],
  ["cancelled", "unpaid", null, "none", true, "cancelled, never funded, no session"],
  ["cancelled", "failed", null, "none", true, "cancelled after a declined card"],
  ["cancelled", "abandoned", "cs_live_x", "none", true, "cancelled after an expired checkout"],
  ["completed", "refunded", null, "none", true, "money back"],
  ["completed", "cancelled", null, "none", true, "settled with no payment"],
];
const q = (v) => (v === null ? "NULL" : `'${v}'`);
for (const [status, pay, sess, booking, relinks, label] of MATRIX) {
  await svc(`UPDATE public.jobs SET status = '${status}', payment_status = ${q(pay)}, stripe_session_id = ${q(sess)} WHERE id = '${jobL}'`);
  await svc(`UPDATE public.maintenance_requests SET job_id = '${jobL}' WHERE id = '${req1}'`);
  const tabB = one(await svc(`INSERT INTO public.jobs (customer_id, status, payment_status) VALUES ('${LANDLORD}', 'open', 'unpaid') RETURNING id`));
  const got = rows(await st(LANDLORD))[0]?.booking;
  const linked = one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${tabB}') AS ok`));
  const now = one(await svc(`SELECT job_id::text FROM public.maintenance_requests WHERE id = '${req1}'`));
  ok(got === booking && linked === relinks && now === (relinks ? tabB : jobL),
    `one live job: ${label}: reads '${booking}' (got ${got}), a second post ${relinks ? "takes" : "is refused"} the request (link ${linked}, request on ${now === jobL ? "the first job" : "the new job"})`);
  await svc(`DELETE FROM public.jobs WHERE id = '${tabB}'`);
}
await svc(`UPDATE public.jobs SET status = 'open', payment_status = 'unpaid', stripe_session_id = NULL WHERE id = '${jobL}'`);
await svc(`UPDATE public.maintenance_requests SET job_id = '${jobL}' WHERE id = '${req1}'`);
ok(one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${jobL}') AS ok`)) === true,
  "the same job again (tab A's retry) is still linked");

// The way out (re-review #1): the landlord cancels the open, never-funded job, then may post again.
const cancelAs = (uid) => as("authenticated", uid, `SELECT public.rentals_cancel_request_job('${req1}')`);
ok(refused(await cancelAs(TENANT), /request_not_found/, "P0002"), "cancel: the tenant cannot cancel the landlord's job");
ok(refused(await cancelAs(STRANGER), /request_not_found/, "P0002"), "cancel: a stranger cannot");
for (const [pay, sess, label] of [["escrow", null, "a funded job"], ["unpaid", "cs_live_x", "a job with a checkout running"],
  ["failed", "cs_live_x", "a declined card inside a live session"]]) {
  await svc(`UPDATE public.jobs SET payment_status = ${q(pay)}, stripe_session_id = ${q(sess)} WHERE id = '${jobL}'`);
  ok(refused(await cancelAs(LANDLORD), /job_not_cancellable/, "22023")
    && one(await svc(`SELECT status FROM public.jobs WHERE id = '${jobL}'`)) === "open",
    `cancel: ${label} is refused and left open (a stale screen never cancels money)`);
}
await svc(`UPDATE public.jobs SET payment_status = 'failed', stripe_session_id = NULL WHERE id = '${jobL}'`);
ok(rows(await st(LANDLORD))[0]?.booking === "unpaid", "cancel: a declined card whose session expired reads 'unpaid' (the cancel is offered)");
ok(Array.isArray(await cancelAs(LANDLORD)) && one(await svc(`SELECT status FROM public.jobs WHERE id = '${jobL}'`)) === "cancelled",
  "cancel: the landlord cancels it through poster_cancel_job");
ok(rows(await st(LANDLORD))[0]?.booking === "none", "cancel: then the request reads 'none'");
const repost = one(await svc(`INSERT INTO public.jobs (customer_id, status, payment_status) VALUES ('${LANDLORD}', 'open', 'unpaid') RETURNING id`));
ok(one(await as("authenticated", LANDLORD, `SELECT public.link_maintenance_request_job('${req1}', '${repost}') AS ok`)) === true,
  "cancel: and the landlord's new post takes the request");
// The test continues on the first job.
await svc(`DELETE FROM public.jobs WHERE id = '${repost}'`);
await svc(`DELETE FROM public.jobs WHERE id = '${jobL2}'`);
await svc(`UPDATE public.jobs SET status = 'open', payment_status = 'unpaid', stripe_session_id = NULL WHERE id = '${jobL}'`);
await svc(`UPDATE public.maintenance_requests SET job_id = '${jobL}' WHERE id = '${req1}'`);

// --- was it fixed? (Q42)
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_tenant_answer_fixed('${req1}', true, NULL)`), /request_not_found/, "P0002"),
  "no 'Was it fixed?' before work has started");
await svc(`UPDATE public.jobs SET status = 'in_progress', payment_status = 'escrow' WHERE id = '${jobL}'`);
ok(rows(await st(TENANT))[0]?.booking === "booked", "a funded job reads 'booked'");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_tenant_answer_fixed('${req1}', true, NULL)`), /request_not_found/, "P0002"),
  "the landlord cannot answer for the tenant");
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_tenant_answer_fixed('${req1}', false, 'Still drips a little')`)),
  "the tenant answers once work started");
ok(rows(await as("authenticated", LANDLORD, `SELECT tenant_says_fixed FROM public.maintenance_requests WHERE id = '${req1}'`))[0]?.tenant_says_fixed === false,
  "the landlord sees the tenant's answer before paying");

// --- visit time (slice 3, owner Q41: "the tenant OKs the visit time the Helpr offers"). STRANGER is the hired Helpr.
const HELPR = STRANGER;
const visit = (uid) => as("authenticated", uid, `SELECT proposed_for::text AS p, confirmed_at::text AS c FROM public.rentals_visit_for_job('${jobL}')`);
const soon = one(await svc(`SELECT date_trunc('minute', now() + interval '2 days')::text`));
ok(refused(await as("authenticated", HELPR, `SELECT public.rentals_propose_visit('${jobL}', '${soon}')`), /job_not_found/, "P0002"),
  "visit: a member who is not the job's Helpr cannot propose");
await svc(`UPDATE public.jobs SET helper_id = '${HELPR}' WHERE id = '${jobL}'`);
ok(refused(await as("authenticated", HELPR, `SELECT public.rentals_propose_visit('${jobL}', now() - interval '1 hour')`), /visit_time_invalid/, "22023"),
  "visit: a time in the past is refused");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_confirm_visit('${req1}', '${soon}')`), /no_visit_proposed/, "P0002"),
  "visit: nothing to confirm before the Helpr proposes");
ok(Array.isArray(await as("authenticated", HELPR, `SELECT public.rentals_propose_visit('${jobL}', '${soon}')`)),
  "visit: the hired Helpr proposes a time");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'A Helpr offered a visit time'`)) === 1,
  "visit: the tenant is told");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_confirm_visit('${req1}', '${soon}')`), /request_not_found/, "P0002"),
  "visit: the landlord cannot confirm for the tenant");
ok(refused(await as("authenticated", HELPR, `SELECT public.rentals_confirm_visit('${req1}', '${soon}')`), /request_not_found/, "P0002"),
  "visit: the Helpr cannot confirm their own proposal");
ok(refused(await as("authenticated", TENANT2, `SELECT public.rentals_confirm_visit('${req1}', '${soon}')`), /request_not_found|under_18|42501/),
  "visit: another member cannot confirm it");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_confirm_visit('${req1}', '${soon}'::timestamptz + interval '1 hour')`), /visit_time_changed/, "22023"),
  "visit: a stale time on the tenant's screen is refused");
ok(rows(await visit(HELPR))[0]?.p != null && rows(await visit(HELPR))[0]?.c == null, "visit: the Helpr sees the proposal, not yet confirmed");
ok(empty(await visit(TENANT2)), "visit: a stranger to the job reads nothing");
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_confirm_visit('${req1}', '${soon}')`)),
  "visit: the tenant confirms the proposed time");
ok(rows(await visit(HELPR))[0]?.c != null, "visit: the Helpr sees the confirmation");
ok(rows(await visit(LANDLORD))[0]?.c != null, "visit: so does the landlord (the job's poster)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${HELPR}' AND title = 'The tenant OK''d your visit time'`)) === 1,
  "visit: the Helpr is told");
const later = one(await svc(`SELECT date_trunc('minute', now() + interval '3 days')::text`));
ok(Array.isArray(await as("authenticated", HELPR, `SELECT public.rentals_propose_visit('${jobL}', '${later}')`))
  && rows(await visit(HELPR))[0]?.c == null, "visit: a new proposal clears the old confirmation");
await svc(`UPDATE public.jobs SET status = 'completed' WHERE id = '${jobL}'`);
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_confirm_visit('${req1}', '${later}')`), /request_not_found/, "P0002"),
  "visit: no confirming once the job is done");
await svc(`UPDATE public.jobs SET status = 'in_progress' WHERE id = '${jobL}'`);

// --- auto-approve (Q48)
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_auto_approve('${prop}', 50)`), /bad_limit/, "22023"),
  "a limit under $1 is refused");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_set_auto_approve('${prop}', 15000)`)), "the landlord sets auto-approve up to $150");
const autoReq = one(await file(TENANT, tenancy, { desc: "Bathroom fan stopped working." }));
const ar = rows(await svc(`SELECT status, auto_approved, approved_budget_cents FROM public.maintenance_requests WHERE id = '${autoReq}'`))[0];
ok(ar?.status === "approved" && ar?.auto_approved === true && ar?.approved_budget_cents === 15000,
  "under auto-approve a request is approved on filing with the budget capped at the limit");
const autoEm = one(await file(TENANT, tenancy, { urgency: "emergency", desc: "Breaker sparks when switched on." }));
ok(one(await svc(`SELECT status FROM public.maintenance_requests WHERE id = '${autoEm}'`)) === "submitted",
  "an emergency is never auto-approved: it waits for the landlord");

// --- end tenancy cuts access
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_end_tenancy('${tenancy}')`)), "the tenant can end their tenancy");
ok(refused(await file(TENANT, tenancy), /tenancy_not_found/, "P0002"), "an ended tenancy cannot file");
ok(empty(await as("authenticated", TENANT, `SELECT label FROM public.rentals_my_homes()`)),
  "an ended tenant no longer has the home");
ok(rows(await as("authenticated", TENANT, `SELECT id FROM public.maintenance_requests`)).length === 4,
  "but keeps their request record (Q46)");

// --- submitted files cannot be swapped or deleted by their owner (storage UPDATE/DELETE policies)
const sub = (uid, path) => as("authenticated", uid, `SELECT public.is_submitted_credential_object('${path}') AS s`);
ok(one(await sub(LANDLORD, `${LANDLORD}/rentals/${prop}/deed.pdf`)) === true, "the approved ownership proof is locked for its owner");
ok(one(await sub(TENANT, photoPath)) === true, "a request photo is locked for the tenant who filed it");
ok(one(await sub(TENANT, `${TENANT}/other/x.jpg`)) === false, "an unrelated file stays the owner's to change");

// --- landlord ID must still be verified to invite
await svc(`UPDATE public.profiles SET idv_status = 'requires_input' WHERE user_id = '${LANDLORD}'`);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}')`), /identity_not_verified/, "42501"),
  "a landlord whose ID is no longer verified cannot invite");
await svc(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = '${LANDLORD}'`);

// --- a tenant with an ACTIVE tenancy can delete their account
const token3 = one(await as("authenticated", LANDLORD, `SELECT public.rentals_invite_tenant('${unit}') AS t`));
const ten2 = one(await as("authenticated", TENANT2, `SELECT public.rentals_accept_invite('${token3}') AS id`));
const delTenant = await svc(`DELETE FROM auth.users WHERE id = '${TENANT2}'`);
const t2 = rows(await svc(`SELECT status, tenant_id FROM public.rental_tenancies WHERE id = '${ten2}'`))[0];
ok(Array.isArray(delTenant) && t2?.status === "ended" && t2?.tenant_id === null,
  "deleting an active tenant's account succeeds and ends the tenancy");

// --- account deletion keeps the other side's record
await svc(`DELETE FROM auth.users WHERE id = '${LANDLORD}'`);
const afterDel = rows(await svc(`SELECT landlord_id, property_id, property_label FROM public.maintenance_requests WHERE id = '${req1}'`))[0];
ok(afterDel && afterDel.landlord_id === null && afterDel.property_id === null && afterDel.property_label === "Oak Street duplex",
  "a deleted landlord's properties go; the tenant's request record stays with its snapshot");

// --- grants
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'rentals%' OR p.proname = 'link_maintenance_request_job')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon can EXECUTE no Rentals function");
const authInternal = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('rentals_assert_member', 'rentals_notify')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
ok(Array.isArray(authInternal) && one(authInternal) === null && !skip, "authenticated can EXECUTE none of the internal helpers");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'rental%' OR c.relname LIKE 'maintenance_request%') AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null && !skip, "no client role can write any Rentals table (RPCs only)");
const grants = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || has_table_privilege(r.rolname, c.oid, 'SELECT'), ',' ORDER BY c.relname, r.rolname) AS g
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'rental%' OR c.relname LIKE 'maintenance_request%') AND c.relkind = 'r'`);
ok(one(grants) === ["maintenance_request_photos", "maintenance_requests", "rental_properties", "rental_tenancies", "rental_units"]
  .flatMap((t) => [`${t}:anon:false`, `${t}:authenticated:${t !== "rental_properties"}`]).join(),
  "exactly SELECT for authenticated and nothing for anon on each Rentals table (rental_properties: column grants)");
const propCols = await svc(`SELECT string_agg(a.attname || ':' || has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
    || ':' || has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT'), ',' ORDER BY a.attnum) AS c
  FROM pg_attribute a WHERE a.attrelid = 'public.rental_properties'::regclass AND a.attnum > 0 AND NOT a.attisdropped`);
ok(typeof one(propCols) === "string" && one(propCols).split(",").every((c) => c === (c.startsWith("ownership_reviewed_by:") ? "ownership_reviewed_by:false:false" : `${c.split(":")[0]}:true:false`)),
  `rental_properties: authenticated reads every column but ownership_reviewed_by, anon none (${one(propCols)})`);
const tables = await svc(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT relrowsecurity)::int AS norls FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND (relname LIKE 'rental%' OR relname LIKE 'maintenance_request%') AND relkind = 'r'`);
ok(rows(tables)[0]?.n === 5 && rows(tables)[0]?.norls === 0, "5 Rentals tables, every one with RLS on");

// --- Q137: every Rentals notice names its actor, so the seed-boundary trigger can judge it
const newLink = one(await svc(`SELECT link FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'New maintenance request'`));
ok(newLink === `/rentals/requests/${req1}?user=${TENANT}`, "the landlord's notice names the tenant who filed (link ?user=<actor>)");
// The real boundary (newest definitions), with the tenant a test account and the landlord real:
await svc(`ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_seed boolean`);
for (const name of ["notification_job_id_from_link", "notification_crosses_seed_boundary"]) await svc(newestDefinition(name).stmt);
await svc(`UPDATE public.profiles SET is_seed = (user_id = '${TENANT}')`);
ok(one(await svc(`SELECT public.notification_crosses_seed_boundary('${LANDLORD}', NULL, '${newLink}') AS x`)) === true,
  "a test tenant's notice to a real landlord crosses the seed boundary (the trigger drops it)");
ok(typeof newLink === "string" && one(await svc(`SELECT public.notification_crosses_seed_boundary('${LANDLORD}', NULL, '/rentals/requests/${req1}') AS x`)) === false,
  "without the actor in the link the boundary could not tell (why the link carries it)");
// A test ADMIN reviewing a real landlord's proof: the staff notice carries no actor, so rentals_notify judges
// the boundary itself with auth.uid() and sends nothing (Q137 holds without naming the admin).
await svc(`UPDATE public.profiles SET is_seed = (user_id = '${ADMIN}')`);
const staffProp = one(await svc(`INSERT INTO public.rental_properties (owner_id, label, street_address, city, zip_code, ownership_status, ownership_submitted_at)
  VALUES ('${ORDINARY}', 'Staff notice check', '9 Elm Street', 'Lafayette', '70501', 'pending_review', now()) RETURNING id`));
ok(Array.isArray(await as("authenticated", ADMIN, `SELECT public.rentals_admin_review_property('${staffProp}', true, 'Matches')`)),
  "a test admin can still review a real landlord's proof");
ok(!skip && one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${ORDINARY}' AND title = 'Property approved'`)) === 0,
  "but its notice to the real landlord is dropped by the boundary (judged with the actor, not the link)");
ok(one(await svc(`SELECT count(*)::int FROM public.notification_logs WHERE user_id = '${ORDINARY}' AND status = 'suppressed_seed' AND subject = 'Property approved'`)) === 1,
  "and the drop is logged like the trigger's (notification_logs suppressed_seed)");
await svc(`UPDATE public.profiles SET is_seed = false`);

// --- Q807: the unconfirmed-email statement gate covers every Rentals table
const gated = await svc(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'rental%' OR c.relname LIKE 'maintenance_request%')
    AND t.tgname = 'zz_refuse_unconfirmed_email_write'`);
ok(rows(gated)[0]?.n === 5, "all 5 Rentals tables carry the unconfirmed-email gate (zz_refuse_unconfirmed_email_write)");
await svc(`UPDATE auth.users SET email_confirmed_at = NULL WHERE id = '${STRANGER}'`);
ok(refused(await as("authenticated", STRANGER, createProp("Unconfirmed place")), /email_unconfirmed/, "42501"),
  "an unconfirmed-email session cannot create a property through the SECURITY DEFINER RPC");
await svc(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${STRANGER}'`);
ok(typeof one(await as("authenticated", STRANGER, createProp("Confirmed place"))) === "string",
  "the same caller, once confirmed, creates it (the gate is the only thing that refused)");

// --- export_my_data reconcile (20261017205607): the newest-timestamp restatement
// of the export must leave the UNION: every section of main's newest OTHER
// definition (read below, not hard-coded, so a later main restatement moves it)
// plus the five Rentals sections, EXECUTE for service_role only.
const RECONCILE = readFileSync(
  process.env.RECONCILE_PATH ?? `${MIG_DIR}20261017205607_export_my_data_rentals_reconcile.sql`,
  "utf8",
);
const sectionKeys = (sql) => [...sql.matchAll(/jsonb_build_object\('([a-z_]+)'/g)].map((m) => m[1]);
const RECONCILE_FILE = "20261017205607_export_my_data_rentals_reconcile.sql";
const mainExport = (() => {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x !== RECONCILE_FILE && !x.startsWith(SELF)).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const at = sql.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.export_my_data\s*\(\s*p_user_id/i);
    if (at < 0) continue;
    const as = /\bAS\s+(\$\w*\$)/g;
    as.lastIndex = at;
    const t = as.exec(sql);
    found = { file: f, sql: sql.slice(at, sql.indexOf(t[1], t.index + t[0].length)) };
  }
  return found;
})();
const mainKeys = [...new Set(sectionKeys(mainExport?.sql ?? ""))];
ok(mainKeys.length > 40 && mainKeys.includes("declutter_bookings") && mainKeys.includes("category_suggestions"),
  `main's newest export_my_data (${mainExport?.file}) names its sections (${mainKeys.length})`);
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(RECONCILE);
}
const exportDef = one(await svc(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure)`)) ?? "";
const liveKeys = new Set(sectionKeys(exportDef));
ok(mainKeys.length > 0 && mainKeys.every((k) => liveKeys.has(k)),
  `after the reconcile x3 the export keeps every section of ${mainExport?.file} (missing: ${mainKeys.filter((k) => !liveKeys.has(k)).join(", ") || "none"})`);
const RENTAL_SECTIONS = ["rental_properties", "rental_units", "rental_tenancies", "maintenance_requests", "maintenance_request_photos"];
ok(RENTAL_SECTIONS.every((k) => liveKeys.has(k)), "and every Rentals section");
const extraKeys = [...liveKeys].filter((k) => !mainKeys.includes(k) && !RENTAL_SECTIONS.includes(k));
ok(liveKeys.size > 0 && extraKeys.length === 0,
  `and nothing else: no section main's newest body dropped comes back (extra: ${extraKeys.join(", ") || "none"})`);
const exportAcl = one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = 'public.export_my_data(uuid)'::regprocedure`)) ?? "";
ok(/service_role=X/.test(exportAcl) && !/(^|[{,])(anon|authenticated)?=X/.test(exportAcl),
  `export_my_data EXECUTE is service_role only (proacl ${exportAcl || "none"})`);
ok(one(await svc(`SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data' AND pronamespace = 'public'::regnamespace`)) === 1,
  "only the (uuid) overload exists (the no-argument door stays dropped)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
