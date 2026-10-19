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
await db.exec(newestDefinition("shop_local_today").stmt); // the Louisiana date every rent rule uses
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
const day31 = one(await svc(`SELECT (date_trunc('month', public.shop_local_today()) + interval '2 months' - interval '1 day')::date::text`));
ok(refused(await plan(LANDLORD, tA, P({ first_due_on: day31 })), /bad_rent_plan/), "a monthly due day after the 28th is refused (every month has it)");
ok(Array.isArray(await plan(LANDLORD, tA, P())), "the landlord sets a monthly schedule due today");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent schedule set'`)) === 1, "the tenant is told");
ok(refused(await as("authenticated", TENANT, `INSERT INTO public.rental_rent_plans (tenancy_id, amount_cents, frequency, first_due_on) VALUES ('${tA}', 100, 'monthly', public.shop_local_today())`), /permission denied/),
  "no client writes the tables directly");

// --- the sweep writes today's rent and a reminder, once
const s1 = rows(await sweep())[0]?.r;
ok(s1?.rent_rows >= 1, "the sweep writes the rent row that came due today");
await sweep(); await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tA}' AND kind = 'rent'`)) === 1, "one rent row per due date (3 sweeps)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent reminder'`)) === 1, "one friendly reminder on the due date");
ok(Array.isArray(await plan(LANDLORD, tA, P())), "the landlord saves the schedule again on the reminder day");
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent reminder'`)) === 1, "#9: still one reminder that day (rent still owed)");

// --- the ledger, for both sides only
const l1 = await ledger(TENANT, tA);
ok(l1?.side === "tenant" && l1.balance_cents === 120000 && l1.charges.length === 1 && l1.plan?.pay_methods?.length === 2, "the tenant sees the schedule, the charge and what is owed");
ok((await ledger(LANDLORD, tA))?.side === "landlord", "the landlord sees the same record");
ok(l1?.home?.label === "Oak house" && l1.home.unit_label === "Main" && l1.home.city === "Lafayette" && !JSON.stringify(l1).includes("123 Oak")
  && !JSON.stringify(l1).includes(LANDLORD) && !JSON.stringify(l1).includes(TENANT),
  "R5: the record names the home for receipts (label, unit, city), never the street or either member's id");
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
ok(typeof (await ledger(TENANT, tA)).payments.find((x) => x.id === p1)?.decided_at === "string"
  && (await ledger(TENANT, tA)).payments.find((x) => x.id === p1)?.status === "confirmed", "R5: a confirmed payment carries when it was confirmed (the receipt date)");
ok(refused(await decide(LANDLORD, p1, false, "never came"), /payment_already_decided/), "a decided payment stays decided");
const p2 = one(await pay(TENANT, tA, 70000, "check"));
ok(refused(await decide(LANDLORD, p2, false), /reason_required/), "a decline needs a reason the tenant sees");
ok(Array.isArray(await decide(LANDLORD, p2, false, "The check bounced.")), "the landlord declines with a reason");
ok((await ledger(TENANT, tA)).payments.find((x) => x.id === p2)?.decline_reason === "The check bounced." && (await ledger(TENANT, tA)).balance_cents === 70000,
  "the tenant sees why, and the balance is unchanged");
ok(typeof one(await pay(LANDLORD, tA, 70000, "cash")) === "string" && (await ledger(TENANT, tA)).balance_cents === 0, "the landlord records a cash payment directly (confirmed at once)");

// --- late fees (D10): past the grace days and unpaid, once per rent row; a covered row gets none
ok(Array.isArray(await plan(LANDLORD, tB, P({ frequency: "weekly", amount_cents: 30000, grace_days: 2, late_fee_cents: 2500 }))), "setup: a weekly schedule");
await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 10 WHERE tenancy_id = '${tB}'`); // ten days pass
await pay(LANDLORD, tB, 30000, "cash", one(await svc(`SELECT (public.shop_local_today() - 10)::text`)));
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

// --- lead review #2 #5 #1: each rent row snapshots its fee and grace days; a payment the tenant REPORTED by the
// due + grace date counts as on time until declined; payments go to rent rows oldest first; no fee on a fee
const unitC = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit C') AS id`));
const tC = await tenancy(unitC, TENANT);
const daysAgo = async (n) => one(await svc(`SELECT (public.shop_local_today() - ${n})::text`));
ok(Array.isArray(await plan(LANDLORD, tC, P({ frequency: "weekly", amount_cents: 10000, grace_days: 1, late_fee_cents: 1000 }))), "setup: a weekly schedule (fee $10, 1 grace day)");
await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 16 WHERE tenancy_id = '${tC}'`); // rows 16, 9 and 2 days ago
const rep1 = one(await pay(TENANT, tC, 10000, "zelle", await daysAgo(16)));
await pay(LANDLORD, tC, 10000, "cash", await daysAgo(9));
await sweep();
ok(Array.isArray(await plan(LANDLORD, tC, P({ frequency: "weekly", amount_cents: 10000, first_due_on: await daysAgo(-30), grace_days: 5, late_fee_cents: 7777 }))),
  "the landlord changes the fee and grace days afterwards");
const snap = rows(await svc(`SELECT late_fee_cents, grace_days FROM public.rental_rent_charges WHERE tenancy_id = '${tC}' AND kind = 'rent'`));
ok(snap.length === 3 && snap.every((r) => r.late_fee_cents === 1000 && r.grace_days === 1), "#2: the rows already written keep the fee and grace days they were written with");
const feesC = async () => rows(await svc(`SELECT f.amount_cents, r.due_on::text AS rent_due FROM public.rental_rent_charges f JOIN public.rental_rent_charges r ON r.id = f.rent_charge_id
  WHERE f.tenancy_id = '${tC}' AND f.kind = 'late_fee' ORDER BY r.due_on`));
let fc = await feesC();
ok(fc.length === 1 && fc[0].rent_due === await daysAgo(2) && fc[0].amount_cents === 1000,
  "#5/#1: the reported (undecided) payment keeps the first week on time, the recorded one the second; only the unpaid third week gets its own $10 fee");
ok(Array.isArray(await decide(LANDLORD, rep1, false, "It never arrived.")), "the landlord declines the first week's reported payment");
await sweep(); await sweep();
fc = await feesC();
ok(fc.length === 3 && fc.every((f) => f.amount_cents === 1000),
  "#5: after the decline the next sweep adds the fee (the recorded payment now covers week one, oldest first, so week two is short too), at the snapshot amount, never the edited $77.77");
await pay(LANDLORD, tC, 30000, "cash", today);
await sweep(); await sweep();
ok((await feesC()).length === 3 && one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges f JOIN public.rental_rent_charges g ON g.id = f.rent_charge_id
  WHERE f.tenancy_id = '${tC}' AND g.kind = 'late_fee'`)) === 0, "#1: one fee per rent row at most, and never a fee on a fee");
// a fee written before the next rent's due date (the daily sweep's normal timing) never makes that rent late
const unitE = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit E') AS id`));
const tE = await tenancy(unitE, TENANT2);
ok(Array.isArray(await plan(LANDLORD, tE, P({ frequency: "weekly", amount_cents: 10000, grace_days: 0, late_fee_cents: 500 }))), "setup: weekly, no grace days");
await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 14 WHERE tenancy_id = '${tE}'`);
await sweep();
await svc(`DELETE FROM public.rental_rent_charges WHERE tenancy_id = '${tE}' AND kind = 'late_fee'`);
await svc(`INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents, rent_charge_id)
  SELECT tenancy_id, 'late_fee', due_on + 1, 500, id FROM public.rental_rent_charges WHERE tenancy_id = '${tE}' AND kind = 'rent' AND due_on = public.shop_local_today() - 14`);
await pay(LANDLORD, tE, 10000, "cash", await daysAgo(14));
await pay(LANDLORD, tE, 10000, "cash", await daysAgo(7));
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tE}' AND kind = 'late_fee'`)) === 1,
  "#1: week one's unpaid $5 fee (written the day after) does not make week two late when week two's rent was paid on time");

// --- lead review #9: reminders skip a prepaid due date; a same-day plan edit never sends a second one
const unitD = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit D') AS id`));
const tD = await tenancy(unitD, STRANGER);
ok(Array.isArray(await plan(LANDLORD, tD, P({ amount_cents: 50000, first_due_on: await daysAgo(-3) }))), "setup: rent first due in 3 days");
await pay(LANDLORD, tD, 50000, "cash", today);
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${STRANGER}' AND title = 'Rent reminder'`)) === 0, "#9: no reminder when what is due by then is already paid");

// --- lease end date (lead review #4): a new one is at least 30 days out
ok(refused(await plan(LANDLORD, tD, P({ amount_cents: 50000, first_due_on: await daysAgo(-3), lease_ends_on: await daysAgo(-10) })), /bad_rent_plan/), "a new lease end date under 30 days out is refused");
ok(Array.isArray(await plan(LANDLORD, tD, P({ amount_cents: 50000, first_due_on: await daysAgo(-3), lease_ends_on: await daysAgo(-40) }))), "40 days out is fine");
ok(one(await svc(`SELECT lease_ends_on::text FROM public.rental_tenancies WHERE id = '${tD}'`)) === await daysAgo(-40), "it is kept on the tenancy");

// --- lead review #8: the sweep skips a tenancy while a side is banned or Homes is off for them
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${TENANT2}'`);
await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 14 WHERE tenancy_id = '${tB}'`);
const beforeB = one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tB}'`));
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tB}'`)) === beforeB, "#8: Homes off for the tenant: nothing written for that tenancy");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${TENANT2}')`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tB}'`)) === beforeB, "#8: a banned landlord: nothing written");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tB}'`)) > beforeB, "and it catches up once both are back");

// --- gates
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await plan(LANDLORD, tA, P()), /account_restricted/), "a banned landlord cannot change the schedule");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await pay(TENANT, tA, 100), /feature/), "with Homes switched off, nothing is written");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);

// --- lead review #3: an ended tenancy's record stays open to both sides for 90 days, then read-only
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_end_tenancy('${tA}')`)), "the tenant ends the tenancy");
ok(one(await svc(`SELECT ended_by FROM public.rental_tenancies WHERE id = '${tA}'`)) === "tenant", "it records who ended it");
ok(refused(await plan(LANDLORD, tA, P()), /tenancy_not_found/), "no schedule changes after the end");
const late = one(await pay(TENANT, tA, 4000, "zelle"));
ok(typeof late === "string", "#3: the tenant can still report a payment after the end");
ok(Array.isArray(await decide(LANDLORD, late, true)), "and the landlord can still confirm it");
const lA = await ledger(TENANT, tA);
ok(lA.open === true && lA.tenancy_status === "ended" && typeof lA.open_until === "string" && lA.plan?.next_due_on === null, "the record says it is open until a date, with no next due date");

// --- lead review #7: the landlord corrects or reverses a confirmed payment within 30 days, with a reason; the tenant may dispute
const correct = (uid, id, action, amt, on, reason) => as("authenticated", uid,
  `SELECT public.rentals_correct_rent_payment('${id}', '${action}', ${amt ?? "NULL"}, ${on ? `'${on}'` : "NULL"}, ${reason ? `'${reason}'` : "NULL"})`);
const balBefore = (await ledger(TENANT, tA)).balance_cents;
ok(refused(await correct(TENANT, late, "edit", 3000, today, "typo"), /payment_not_found/), "the tenant cannot correct a payment");
ok(refused(await correct(LANDLORD, late, "edit", 3000, today, null), /reason_required/), "a correction needs a reason");
ok(Array.isArray(await correct(LANDLORD, late, "edit", 3000, today, "It was $30, not $40.")), "the landlord corrects the amount");
const pc = (await ledger(TENANT, tA)).payments.find((x) => x.id === late);
ok(pc.amount_cents === 3000 && pc.corrections.length === 1 && pc.corrections[0].from.amount_cents === 4000 && pc.corrections[0].reason === "It was $30, not $40."
  && (await ledger(TENANT, tA)).balance_cents === balBefore + 1000, "kept on the payment (before, after, why) and the balance follows");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Rent payment changed'`)) === 1, "the tenant is told");
ok(Array.isArray(await correct(LANDLORD, late, "reverse", null, null, "That transfer was returned.")), "the landlord reverses it");
ok((await ledger(TENANT, tA)).payments.find((x) => x.id === late).status === "reversed" && (await ledger(TENANT, tA)).balance_cents === balBefore + 4000, "reversed: it no longer counts");
ok(refused(await correct(LANDLORD, late, "reverse", null, null, "again"), /payment_not_correctable/), "only a confirmed payment can be corrected");
const dispute = (uid, id, reason) => as("authenticated", uid, `SELECT public.rentals_dispute_rent_payment('${id}', ${reason ? `'${reason}'` : "NULL"})`);
ok(refused(await dispute(LANDLORD, late, "no"), /payment_not_found/), "the landlord cannot dispute");
ok(Array.isArray(await dispute(TENANT, late, "My bank shows it went through.")), "the tenant disputes the reversal");
ok((await ledger(LANDLORD, tA)).payments.find((x) => x.id === late).dispute_reason === "My bank shows it went through."
  && one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${LANDLORD}' AND title = 'Rent payment disputed'`)) === 1, "both see it and the landlord is told");
ok(refused(await dispute(TENANT, late, "again"), /payment_not_disputable/), "once");
const old = one(await pay(LANDLORD, tA, 1000, "cash"));
await svc(`UPDATE public.rental_rent_payments SET decided_at = now() - interval '31 days' WHERE id = '${old}'`);
ok(refused(await correct(LANDLORD, old, "reverse", null, null, "too late"), /payment_not_correctable/), "#7: not after 30 days");

await svc(`UPDATE public.rental_tenancies SET ended_at = now() - interval '91 days' WHERE id = '${tA}'`);
ok(refused(await pay(TENANT, tA, 100), /tenancy_not_found/), "#3: 90 days after the end the record takes no new payments");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_waive_rent_charge(id) FROM public.rental_rent_charges WHERE tenancy_id = '${tA}' LIMIT 1`), /charge_not_found/), "nor waivers");
ok((await ledger(TENANT, tA))?.open === false, "but its record stays readable by both sides");

// --- grants
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_set_rent_plan(uuid,jsonb)", "public.rentals_add_rent_payment(uuid,integer,date,text)", "public.rentals_decide_rent_payment(uuid,boolean,text)",
  "public.rentals_waive_rent_charge(uuid)", "public.rentals_rent_ledger(uuid)", "public.rentals_correct_rent_payment(uuid,text,integer,date,text)",
  "public.rentals_dispute_rent_payment(uuid,text)"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated, not anon/PUBLIC (${a})`);
}
const sw = await acl("public.rentals_rent_sweep()");
ok(/service_role=X/.test(sw) && !/(^|[{,])(anon|authenticated)?=X/.test(sw), `rentals_rent_sweep: server-only (${sw})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (RENT_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
