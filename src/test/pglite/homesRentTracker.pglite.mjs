#!/usr/bin/env node
/**
 * PGlite proof for 20261019073106_rentals_rent_tracker (owner D2, pay direct; D10/D11 late fees + partials
 * up to the landlord): the landlord sets the schedule, the daily sweep writes rent rows, late fees and
 * reminders, the tenant reports "I paid", the landlord confirms "Rent received" / declines / records, and
 * both sides read one ledger.
 *
 *   node src/test/pglite/homesRentTracker.pglite.mjs
 *   RENT_MIGRATION=skip node src/test/pglite/homesRentTracker.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesRentTracker.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019073106";
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_rent_tracker.sql`, "utf8");
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

const skip = process.env.RENT_MIGRATION === "skip";
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


const today = one(await svc(`SELECT current_date::text`));
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

const plan = (uid, t, f) => as("authenticated", uid, `SELECT public.rentals_set_rent_plan('${t}', '${JSON.stringify(f).replace(/'/g, "''")}'::jsonb)`);
const P = (o = {}) => ({ amount_cents: 120000, frequency: "monthly", first_due_on: today, grace_days: 3, late_fee_cents: 5000, pay_methods: ["zelle", "check"], ...o });
const ledger = async (uid, t) => { const r = await as("authenticated", uid, `SELECT public.rentals_rent_ledger('${t}') AS l`); return Array.isArray(r) ? r[0]?.l : r; };
const sweep = () => svc(`SELECT public.rentals_rent_sweep() AS r`);

// --- the plan: the landlord's, validated
ok(refused(await plan(TENANT, tA, P()), /tenancy_not_found/, "P0002"), "the tenant cannot set the rent schedule");
ok(refused(await plan(STRANGER, tA, P()), /tenancy_not_found/, "P0002"), "nor a stranger");
ok(refused(await plan(LANDLORD, tA, { ...P(), who_may_live: "x" }), /bad_rent_plan/), "an unknown field is refused");
ok(refused(await plan(LANDLORD, tA, P({ first_due_on: "2020-01-01" })), /bad_rent_plan/), "a back-dated first due date is refused");
ok(refused(await plan(LANDLORD, tA, P({ pay_methods: [] })), /bad_rent_plan/), "at least one way to pay");
ok(refused(await plan(LANDLORD, tA, P({ pay_methods: ["bitcoin"] })), /bad_rent_plan/), "only the listed direct ways");
ok(refused(await plan(LANDLORD, tA, P({ amount_cents: 50 })), /bad_rent_plan/), "a rent under $1 is refused");
const day31 = one(await svc(`SELECT (date_trunc('month', current_date) + interval '2 months' - interval '1 day')::date::text`));
ok(refused(await plan(LANDLORD, tA, P({ first_due_on: day31 })), /bad_rent_plan/), "a monthly due day after the 28th is refused (every month has it)");
ok(Array.isArray(await plan(LANDLORD, tA, P())), "the landlord sets a monthly schedule due today");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent schedule set'`)) === 1, "the tenant is told");
ok(refused(await as("authenticated", TENANT, `INSERT INTO public.rental_rent_plans (tenancy_id, amount_cents, frequency, first_due_on) VALUES ('${tA}', 100, 'monthly', current_date)`), /permission denied/),
  "no client writes the tables directly");

// --- the sweep writes today's rent and a reminder, once
const s1 = rows(await sweep())[0]?.r;
ok(s1?.rent_rows >= 1, "the sweep writes the rent row that came due today");
await sweep(); await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tA}' AND kind = 'rent'`)) === 1, "one rent row per due date (3 sweeps)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent reminder'`)) === 1, "one friendly reminder on the due date");

// --- the ledger, for both sides only
const l1 = await ledger(TENANT, tA);
ok(l1?.side === "tenant" && l1.balance_cents === 120000 && l1.charges.length === 1 && l1.plan?.pay_methods?.length === 2, "the tenant sees the schedule, the charge and what is owed");
ok((await ledger(LANDLORD, tA))?.side === "landlord", "the landlord sees the same record");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_rent_ledger('${tA}')`), /tenancy_not_found/, "P0002"), "a stranger sees nothing");
ok(empty(await as("authenticated", STRANGER, `SELECT * FROM public.rental_rent_charges`)), "nor through the tables");
ok(rows(await as("authenticated", TENANT, `SELECT * FROM public.rental_rent_charges WHERE tenancy_id = '${tA}'`)).length === 1, "the tenant reads their rows");

// --- payments: partial "I paid", confirm, decline with reason, landlord records
const pay = (uid, t, amt, method = "zelle", on = today) => as("authenticated", uid, `SELECT public.rentals_add_rent_payment('${t}', ${amt}, '${on}', '${method}') AS id`);
const p1 = one(await pay(TENANT, tA, 50000));
ok(typeof p1 === "string" && (await ledger(TENANT, tA)).balance_cents === 120000, "D11: the tenant reports a partial payment; it counts only once confirmed");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'Rent payment to confirm'`)) === 1, "the landlord is asked to confirm");
ok(refused(await pay(TENANT, tA, 100, "zelle", "2099-01-01"), /bad_rent_payment/), "a payment in the future is refused");
ok(refused(await pay(STRANGER, tA, 100), /tenancy_not_found/), "a stranger cannot report one");
const decide = (uid, id, yes, reason) => as("authenticated", uid, `SELECT public.rentals_decide_rent_payment('${id}', ${yes}, ${reason ? `'${reason}'` : "NULL"})`);
ok(refused(await decide(TENANT, p1, true), /payment_not_found/), "the tenant cannot confirm their own payment");
ok(Array.isArray(await decide(LANDLORD, p1, true)), "the landlord taps Rent received");
ok((await ledger(TENANT, tA)).balance_cents === 70000, "the balance drops by the confirmed amount");
ok(refused(await decide(LANDLORD, p1, false, "never came"), /payment_already_decided/), "a decided payment stays decided");
const p2 = one(await pay(TENANT, tA, 70000, "check"));
ok(refused(await decide(LANDLORD, p2, false), /reason_required/), "a decline needs a reason the tenant sees");
ok(Array.isArray(await decide(LANDLORD, p2, false, "The check bounced.")), "the landlord declines with a reason");
ok((await ledger(TENANT, tA)).payments.find((x) => x.id === p2)?.decline_reason === "The check bounced." && (await ledger(TENANT, tA)).balance_cents === 70000,
  "the tenant sees why, and the balance is unchanged");
ok(typeof one(await pay(LANDLORD, tA, 70000, "cash")) === "string" && (await ledger(TENANT, tA)).balance_cents === 0, "the landlord records a cash payment directly (confirmed at once)");

// --- late fees (D10): past the grace days and unpaid, once per rent row; a covered row gets none
ok(Array.isArray(await plan(LANDLORD, tB, P({ frequency: "weekly", amount_cents: 30000, grace_days: 2, late_fee_cents: 2500 }))), "setup: a weekly schedule");
await svc(`UPDATE public.rental_rent_plans SET first_due_on = current_date - 10 WHERE tenancy_id = '${tB}'`); // ten days pass
await pay(LANDLORD, tB, 30000, "cash", one(await svc(`SELECT (current_date - 10)::text`)));
await sweep(); await sweep();
const lb = await ledger(TENANT2, tB);
const fees = lb.charges.filter((c) => c.kind === "late_fee");
ok(lb.charges.filter((c) => c.kind === "rent").length === 2, "two weekly rent rows came due (10 and 3 days ago)");
ok(fees.length === 1 && fees[0].amount_cents === 2500, "one late fee: the paid week gets none, the unpaid one past its 2 grace days gets one (2 sweeps)");
ok(lb.balance_cents === 30000 + 2500, "the balance is the unpaid week plus its fee");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT2}' AND title = 'Late fee added'`)) === 1, "the tenant is told once");
ok(refused(await as("authenticated", TENANT2, `SELECT public.rentals_waive_rent_charge('${fees[0].id}')`), /charge_not_found/), "the tenant cannot waive a fee");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_waive_rent_charge('${fees[0].id}')`)), "the landlord waives it");
ok((await ledger(TENANT2, tB)).balance_cents === 30000 && (await ledger(TENANT2, tB)).charges.find((c) => c.id === fees[0].id)?.waived === true, "kept on the record as waived, not owed");

// --- gates
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await plan(LANDLORD, tA, P()), /account_restricted/), "a banned landlord cannot change the schedule");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await pay(TENANT, tA, 100), /feature/), "with Homes switched off, nothing is written");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await svc(`UPDATE public.rental_tenancies SET status = 'ended', ended_at = now() WHERE id = '${tA}'`);
ok(refused(await pay(TENANT, tA, 100), /tenancy_not_found/), "an ended tenancy takes no new payments");
ok((await ledger(TENANT, tA))?.side === "tenant", "but its record stays readable by both sides");

// --- grants
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_set_rent_plan(uuid,jsonb)", "public.rentals_add_rent_payment(uuid,integer,date,text)", "public.rentals_decide_rent_payment(uuid,boolean,text)",
  "public.rentals_waive_rent_charge(uuid)", "public.rentals_rent_ledger(uuid)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated, not anon/PUBLIC (${a})`);
}
const sw = await acl("public.rentals_rent_sweep()");
ok(/service_role=X/.test(sw) && !/(^|[{,])(anon|authenticated)?=X/.test(sw), `rentals_rent_sweep: server-only (${sw})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (RENT_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
