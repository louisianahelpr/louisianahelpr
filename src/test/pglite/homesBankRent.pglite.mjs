#!/usr/bin/env node
/**
 * PGlite proof for 20261019103751_rentals_bank_rent (owner D2/D7/D9; DRAFT pending lh-money-escrow): the landlord
 * turns bank pay on (payouts required) and picks who pays the bank cost; the tenant starts a bank payment (capped,
 * one in flight); only the bank's confirmation writes a confirmed payment and queues the landlord's transfer; a
 * failure records nothing; a return reverses the payment and the transfer; members cannot change a bank payment.
 *
 *   node src/test/pglite/homesBankRent.pglite.mjs
 *   BANK_MIGRATION=skip node src/test/pglite/homesBankRent.pglite.mjs   # RED
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019103751";
const DEPOSIT = readFileSync(`${MIG_DIR}20261019082216_rentals_deposit_tracker.sql`, "utf8");
const RENT = readFileSync(`${MIG_DIR}20261019073106_rentals_rent_tracker.sql`, "utf8");
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_bank_rent.sql`, "utf8");
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
  stripe_account_id text, stripe_payouts_enabled boolean NOT NULL DEFAULT false,
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

const skip = process.env.BANK_MIGRATION === "skip";
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


const plan = (uid, t, f) => as("authenticated", uid, `SELECT public.rentals_set_rent_plan('${t}', '${JSON.stringify(f).replace(/'/g, "''")}'::jsonb)`);
const P = (o = {}) => ({ amount_cents: 120000, frequency: "monthly", first_due_on: today, grace_days: 3, late_fee_cents: 0, pay_methods: ["zelle"], ...o });
const bankPay = (uid, t, on, payer) => as("authenticated", uid, `SELECT public.rentals_set_bank_pay('${t}', ${on}, '${payer}')`);
const start = (uid, t, cents) => as("authenticated", uid, `SELECT public.rentals_start_bank_rent('${t}', ${cents}) AS r`);
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

// --- the fee: 0.8% rounded up, at most $5
const fee = async (c, who) => one(await svc(`SELECT public.rentals_bank_fee_cents(${c}, '${who}')`));
ok((await fee(120000, "landlord")) === 500 && (await fee(30000, "landlord")) === 240 && (await fee(101, "landlord")) === 1,
  "the bank cost the landlord pays is 0.8% of the rent rounded up, at most $5");
// Lead review #6: the tenant's fee is grossed up, so Stripe's 0.8% of (rent + fee) never exceeds it.
let grossOk = true;
for (const c of [100, 101, 124, 125, 248, 12345, 30000, 61900, 62000, 62001, 1000000]) {
  const f = await fee(c, "tenant");
  if (f !== Math.min(Math.ceil(c / 124), 500) || Math.min(Math.ceil((c + f) * 0.008 - 1e-9), 500) > f) grossOk = false;
}
ok(grossOk && (await fee(30000, "tenant")) === 242 && (await fee(120000, "tenant")) === 500, "lead #6: the tenant's fee covers the fee on the fee (0.8% of rent + fee)");

// --- the landlord turns it on (a rent schedule and payouts first)
ok(refused(await bankPay(LANDLORD, tA, true, "tenant"), /no_rent_plan/), "no rent schedule, no bank pay");
ok(Array.isArray(await plan(LANDLORD, tA, P())), "setup: a monthly schedule due today");
await svc(`SELECT public.rentals_rent_sweep()`);
ok(refused(await bankPay(LANDLORD, tA, true, "tenant"), /payouts_not_ready/), "bank pay needs the landlord's payouts on");
await svc(`UPDATE public.profiles SET stripe_account_id = 'acct_test1', stripe_payouts_enabled = true WHERE user_id = '${LANDLORD}'`);
ok(refused(await bankPay(TENANT, tA, true, "tenant"), /tenancy_not_found/), "only the landlord turns it on");
ok(refused(await bankPay(LANDLORD, tA, true, "nobody"), /bad_bank_pay/), "the fee is paid by the tenant or the landlord");
ok(refused(await start(TENANT, tA, 120000), /bank_pay_off/), "the tenant cannot pay by bank while it is off");
ok(Array.isArray(await bankPay(LANDLORD, tA, true, "tenant")) && (await notes(TENANT, "Pay rent in the app")) === 1, "the landlord turns it on (tenant pays the cost); the tenant is told");

// --- the tenant starts a payment
ok(refused(await start(LANDLORD, tA, 120000), /tenancy_not_found/), "only the tenant pays");
ok(refused(await start(TENANT, tA, 120000 * 2 + 1), /bad_rent_payment/), "at most what is open plus one rent");
const b1 = rows(await start(TENANT, tA, 120000))[0]?.r;
ok(b1?.rent_cents === 120000 && b1.fee_cents === 500 && b1.charge_cents === 120500 && b1.transfer_cents === 120000, "tenant pays the cost: the bank is debited $1,205, the landlord gets $1,200");
ok(refused(await start(TENANT, tA, 1000), /bank_payment_in_flight/), "one bank payment in flight at a time");
const stT = one(await as("authenticated", TENANT, `SELECT public.rentals_bank_state('${tA}')`));
const stL = one(await as("authenticated", LANDLORD, `SELECT public.rentals_bank_state('${tA}')`));
ok(stT?.bank_pay === true && stT.fee_payer === "tenant" && stT.in_flight?.charge_cents === 120500 && stT.payouts_ready === null
  && stL?.payouts_ready === true && !("bank_label" in (stL.autopay ?? {})), "the card's bank state: on, who pays, the payment in flight; payouts only to the landlord");
ok(refused(await as("authenticated", STRANGER, `SELECT public.rentals_bank_state('${tA}')`), /tenancy_not_found/), "a stranger sees none of it");
ok(refused(await as("authenticated", TENANT, `SELECT * FROM public.rental_rent_bank_payments`), /permission denied/), "no client reads the bank table");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_bank_rent_succeeded('pi_x')`), /permission denied/), "no member can mark a payment paid");

// --- Stripe's word: processing, then confirmed by the bank (once)
await svc(`SELECT public.rentals_bank_rent_attach('${b1.id}', 'cs_test_1', false)`);
await svc(`SELECT public.rentals_bank_rent_processing('${b1.id}', 'pi_test_1')`);
const bal = async () => one(await as("authenticated", TENANT, `SELECT (public.rentals_rent_ledger('${tA}') ->> 'balance_cents')::int`));
ok((await bal()) === 120000, "while the debit is processing nothing counts yet");
ok(rows(await svc(`SELECT * FROM public.rentals_bank_transfers_due(10)`)).length === 0, "D9: and nothing is sent to the landlord before the bank confirms");
ok(one(await svc(`SELECT public.rentals_bank_rent_succeeded('pi_test_1')`)) === "succeeded" && (await bal()) === 0, "the bank confirms: the payment counts");
ok(one(await svc(`SELECT public.rentals_bank_rent_succeeded('pi_test_1')`)) === "succeeded"
  && one(await svc(`SELECT count(*)::int FROM public.rental_rent_payments WHERE tenancy_id = '${tA}' AND pay_method = 'bank'`)) === 1, "a repeated webhook writes nothing more");
ok((await notes(LANDLORD, "Rent received")) >= 1 && (await notes(TENANT, "Rent paid")) === 1, "both are told");
const due = rows(await svc(`SELECT * FROM public.rentals_bank_transfers_due(10)`));
ok(due.length === 1 && due[0].action === "transfer" && due[0].transfer_cents === 120000 && due[0].stripe_account_id === "acct_test1", "D9: the landlord's transfer is queued only now");
const bankPayId = one(await svc(`SELECT rent_payment_id FROM public.rental_rent_bank_payments WHERE id = '${b1.id}'`));
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_correct_rent_payment('${bankPayId}', 'reverse', NULL, NULL, 'not mine')`), /bank_payment_locked/),
  "the landlord cannot take back a bank payment by hand");
ok(one(await svc(`SELECT public.rentals_bank_transfer_executed('${b1.id}', 'transfer', 'tr_1', true, NULL)`)) === "succeeded", "the transfer went out");

// --- a return after success: the payment no longer counts, the transfer is pulled back
ok(one(await svc(`SELECT public.rentals_bank_rent_returned('pi_test_1', 'R01 insufficient funds')`)) === "returned" && (await bal()) === 120000, "D9: a bank return reverses the payment");
const rev = rows(await svc(`SELECT * FROM public.rentals_bank_transfers_due(10)`));
ok(rev.length === 1 && rev[0].action === "reverse" && rev[0].stripe_transfer_id === "tr_1", "and queues the transfer reversal");
ok(one(await svc(`SELECT public.rentals_bank_transfer_executed('${b1.id}', 'reverse', NULL, true, NULL)`)) === "reversed", "pulled back");
ok((await notes(LANDLORD, "Rent payment returned")) === 1 && (await notes(TENANT, "Rent payment returned")) === 1, "both are told");

// --- landlord pays the cost; a failed debit records nothing
ok(Array.isArray(await bankPay(LANDLORD, tA, true, "landlord")), "the landlord switches to paying the bank cost");
const b2 = rows(await start(TENANT, tA, 120000))[0]?.r;
ok(b2?.charge_cents === 120000 && b2.transfer_cents === 119500, "landlord pays: the bank is debited $1,200, the landlord gets $1,195");
await svc(`SELECT public.rentals_bank_rent_attach('${b2.id}', 'cs_test_2', false)`);
await svc(`SELECT public.rentals_bank_rent_failed('${b2.id}', false)`);
ok((await bal()) === 120000 && (await notes(TENANT, "Rent payment did not go through")) === 1, "a failed debit records nothing and tells the tenant");

// --- the sweep: a bank payment started by the due + grace date is on time while the bank confirms it
{
  const unitZ = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit Z') AS id`));
  const tZ = await tenancy(unitZ, TENANT2);
  await svc(`UPDATE public.profiles SET idv_status = 'verified', date_of_birth = '1990-01-01' WHERE user_id = '${TENANT2}'`);
  ok(Array.isArray(await plan(LANDLORD, tZ, P({ frequency: "weekly", amount_cents: 10000, grace_days: 0, late_fee_cents: 300 }))), "setup: weekly, no grace days");
  await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 3 WHERE tenancy_id = '${tZ}'`);
  await svc(`SELECT public.rentals_rent_sweep()`);
  await svc(`DELETE FROM public.rental_rent_charges WHERE tenancy_id = '${tZ}' AND kind = 'late_fee'`);
  ok(Array.isArray(await bankPay(LANDLORD, tZ, true, "tenant")), "setup: bank pay on");
  const bz = rows(await start(TENANT2, tZ, 10000))[0]?.r;
  await svc(`UPDATE public.rental_rent_bank_payments SET created_at = now() - interval '3 days' WHERE id = '${bz.id}'`); // started on the due date
  await svc(`SELECT public.rentals_bank_rent_attach('${bz.id}', 'cs_test_z', false)`);
  await svc(`SELECT public.rentals_bank_rent_processing('${bz.id}', 'pi_test_z')`);
  await svc(`SELECT public.rentals_rent_sweep()`);
  const feesZ = async () => one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tZ}' AND kind = 'late_fee'`));
  ok((await feesZ()) === 0, "a bank payment started on the due date is on time while the bank confirms it");
  await svc(`SELECT public.rentals_bank_rent_succeeded('pi_test_z')`);
  await svc(`SELECT public.rentals_rent_sweep()`);
  ok((await feesZ()) === 0 && one(await svc(`SELECT paid_on::text FROM public.rental_rent_payments WHERE tenancy_id = '${tZ}' AND pay_method = 'bank'`)) === one(await svc(`SELECT (public.shop_local_today() - 3)::text`)),
    "confirmed days later, it counts from the day it was started: still on time");
  // Lead review #10: a return clears the on-time mark it made, so the next sweep finds the row late.
  ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tZ}' AND kind = 'rent' AND on_time_at IS NOT NULL`)) >= 1,
    "setup: the row was marked on time by the bank payment");
  await svc(`SELECT public.rentals_bank_rent_returned('pi_test_z', 'R01 insufficient funds')`);
  ok(one(await svc(`SELECT count(*)::int FROM public.rental_rent_charges WHERE tenancy_id = '${tZ}' AND kind = 'rent' AND on_time_at IS NOT NULL`)) === 0,
    "lead #10: a returned bank payment clears the on-time mark of the rows it covered");
  await svc(`SELECT public.rentals_rent_sweep()`);
  ok((await feesZ()) === 1, "lead #10: and the next sweep adds the late fee");
  // Lead review #4: the transfer was being made when the bank returned the payment; it is recorded and pulled back.
  ok(one(await svc(`SELECT transfer_status FROM public.rental_rent_bank_payments WHERE id = '${bz.id}'`)) === "none", "setup: returned before any transfer was recorded");
  ok(one(await svc(`SELECT public.rentals_bank_transfer_executed('${bz.id}', 'transfer', 'tr_z', true, NULL)`)) === "reverse_due"
    && one(await svc(`SELECT stripe_transfer_id FROM public.rental_rent_bank_payments WHERE id = '${bz.id}'`)) === "tr_z"
    && rows(await svc(`SELECT * FROM public.rentals_bank_transfers_due(10)`)).some((r) => r.bank_payment_id === bz.id && r.action === "reverse"),
    "lead #4: a transfer made as the bank returned the payment is recorded and queued to be pulled back, never orphaned");
  ok(refused(await svc(`SELECT public.rentals_bank_transfer_executed('${bz.id}', 'reverse', 'nope', true, NULL)`), /invalid_transfer/), "a transfer id is always a tr_ id");
}

// --- autopay (D7)
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_set_autopay('${tA}', true)`), /no_saved_bank/), "autopay needs a saved bank");
ok(refused(await as("authenticated", TENANT, `SELECT public.rentals_autopay_saved('${tA}', '${TENANT}', 'cus_1', 'pm_1', 'Test Bank 6789', false)`), /permission denied/), "only the server saves the bank");
ok(refused(await svc(`SELECT public.rentals_autopay_saved('${tA}', '${STRANGER}', 'cus_x', 'pm_x', 'Other', false)`), /tenancy_not_found/), "a bank saved by someone who is not the tenant is refused");
await svc(`SELECT public.rentals_autopay_saved('${tA}', '${TENANT}', 'cus_1', 'pm_1', 'Test Bank 6789', false)`);
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_set_autopay('${tA}', true)`), /tenancy_not_found/), "only the tenant turns autopay on");
ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_set_autopay('${tA}', true)`)) && (await notes(LANDLORD, "Autopay on")) === 1, "the tenant turns it on; the landlord is told");
// Lead review #8: what the tenant reports paying directly (still waiting for the landlord) is not debited again.
await svc(`INSERT INTO public.rental_rent_payments (tenancy_id, amount_cents, paid_on, pay_method, reported_by, status)
           VALUES ('${tA}', 20000, public.shop_local_today(), 'zelle', 'tenant', 'reported')`);
const apR = await svc(`SELECT * FROM public.rentals_autopay_due()`); const ap = rows(apR);
ok(ap.length === 1 && ap[0].charge_cents === 100000 && ap[0].stripe_payment_method_id === "pm_1", "today's open rent row, less the $200 the tenant reported paying directly (lead #8), is queued once for an off-session bank charge (landlord pays the cost)");
ok(rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).length === 0, "never twice");
await svc(`SELECT public.rentals_bank_rent_failed('${ap[0].bank_payment_id}', false)`);
ok(rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).length === 0, "a failed autopay debit is not retried (the tenant is told)");
await svc(`DELETE FROM public.rental_rent_bank_payments WHERE id = '${ap[0].bank_payment_id}'`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${TENANT}'`);
ok(rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).length === 0, "a banned side: autopay does not charge");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${TENANT}'`);
ok(Array.isArray(await bankPay(LANDLORD, tA, false, "landlord")) && one(await svc(`SELECT enabled FROM public.rental_rent_autopay WHERE tenancy_id = '${tA}'`)) === false,
  "the landlord turning bank pay off turns autopay off");

// --- lead review #2 #3 #5 #9: stale rows, the in-flight gate, missed days, lost replies
{
  const unitY = one(await as("authenticated", LANDLORD, `SELECT public.rentals_add_unit('${prop}', 'Unit Y') AS id`));
  const tY = await tenancy(unitY, TENANT);
  ok(Array.isArray(await plan(LANDLORD, tY, P({ amount_cents: 50000 }))), "setup: a monthly plan");
  await svc(`UPDATE public.rental_rent_plans SET first_due_on = public.shop_local_today() - 3 WHERE tenancy_id = '${tY}'`);
  await svc(`DELETE FROM public.rental_rent_charges WHERE tenancy_id = '${tY}'`);
  await svc(`SELECT public.rentals_rent_sweep()`);
  ok(Array.isArray(await bankPay(LANDLORD, tY, true, "tenant")), "setup: bank pay on");
  const m1 = rows(await start(TENANT, tY, 50000))[0]?.r;
  await svc(`UPDATE public.rental_rent_bank_payments SET created_at = now() - interval '40 minutes' WHERE id = '${m1.id}'`);
  const m2 = rows(await start(TENANT, tY, 50000))[0]?.r;
  ok(typeof m2?.id === "string" && one(await svc(`SELECT status FROM public.rental_rent_bank_payments WHERE id = '${m1.id}'`)) === "expired",
    "lead #3: a payment whose checkout never started is closed after 35 minutes and never blocks the next");
  await svc(`SELECT public.rentals_bank_rent_attach('${m2.id}', 'cs_test_y', false)`);
  await svc(`UPDATE public.rental_rent_bank_payments SET created_at = now() - interval '2 hours' WHERE id = '${m2.id}'`);
  ok(refused(await start(TENANT, tY, 50000), /bank_payment_in_flight/), "lead #5: a started checkout Stripe has not answered still blocks a second payment, at any age");
  await svc(`SELECT public.rentals_bank_rent_failed('${m2.id}', true)`);
  await svc(`SELECT public.rentals_autopay_saved('${tY}', '${TENANT}', 'cus_y', 'pm_y', 'Test Bank 1111', false)`);
  ok(Array.isArray(await as("authenticated", TENANT, `SELECT public.rentals_set_autopay('${tY}', true)`)), "setup: autopay on");
  const ay = rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).filter((r) => r.tenancy_id === tY);
  ok(ay.length === 1 && ay[0].charge_cents === 50000 + 404, "lead #9: a rent row due 3 days ago (a missed run) is caught up");
  ok(rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).filter((r) => r.tenancy_id === tY).length === 0, "and only once");
  await svc(`UPDATE public.rental_rent_bank_payments SET created_at = now() - interval '15 minutes' WHERE id = '${ay[0].bank_payment_id}'`);
  const again = rows(await svc(`SELECT * FROM public.rentals_autopay_due()`)).filter((r) => r.tenancy_id === tY);
  ok(again.length === 1 && again[0].bank_payment_id === ay[0].bank_payment_id,
    "lead #2: a charge whose answer was lost is offered again under the SAME id (same idempotency key: Stripe returns the same charge)");
  await svc(`SELECT public.rentals_bank_rent_failed('${ay[0].bank_payment_id}', false)`);
  await svc(`SELECT public.rentals_bank_rent_processing('${ay[0].bank_payment_id}', 'pi_test_y')`);
  ok(one(await svc(`SELECT status FROM public.rental_rent_bank_payments WHERE id = '${ay[0].bank_payment_id}'`)) === "processing",
    "lead #2: a charge recorded failed before Stripe's answer arrived is recorded when the bank's word comes (never lost)");
  await svc(`UPDATE public.rental_rent_charges SET due_on = public.shop_local_today() WHERE tenancy_id = '${tY}' AND kind = 'rent'`);
  await svc(`UPDATE public.profiles SET stripe_payouts_enabled = false WHERE user_id = '${LANDLORD}'`);
  await svc(`SELECT * FROM public.rentals_autopay_due()`); await svc(`SELECT * FROM public.rentals_autopay_due()`);
  await svc(`UPDATE public.profiles SET stripe_payouts_enabled = true WHERE user_id = '${LANDLORD}'`);
  ok((await notes(TENANT, "Autopay did not run")) === 1, "lead #9: autopay that cannot run on the due day (landlord payouts off) tells the tenant, once");
}

// --- Download My Data (20261019105226): the two bank sections, their real text, run for each person
{
  const EXP = readFileSync(`${MIG_DIR}20261019105226_export_my_data_bank_rent.sql`, "utf8");
  const a0 = EXP.indexOf("  -- Homes bank rent (20261019103751): the bank payments");
  const a1 = EXP.indexOf("  RETURN v_out;", a0);
  ok(a0 > 0 && a1 > a0, "setup: the export's bank sections found");
  await svc(`CREATE OR REPLACE FUNCTION public.export_bank_probe(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE v_uid uuid := p_user_id; v_out jsonb := '{}'::jsonb;
BEGIN
${EXP.slice(a0, a1)}  RETURN v_out;
END $probe$`);
  const ex = async (u) => one(await svc(`SELECT public.export_bank_probe('${u}')`));
  const eT = await ex(TENANT), eL = await ex(LANDLORD), eS = await ex(STRANGER);
  ok(eT?.rental_rent_bank_payments?.length >= 2 && eT.rental_rent_autopay?.[0]?.bank_label === "Test Bank 6789"
    && !JSON.stringify(eT.rental_rent_autopay).includes("pm_1") && !JSON.stringify(eT.rental_rent_autopay).includes("cus_1"),
    "export: the tenant gets the bank payments and their autopay (the bank's label, never the Stripe ids)");
  ok(eL?.rental_rent_bank_payments?.length > eT.rental_rent_bank_payments.length && eL.rental_rent_autopay?.[0] && !("bank_label" in eL.rental_rent_autopay[0]),
    "export: the landlord gets the bank payments and only whether autopay is on");
  ok(eS?.rental_rent_bank_payments?.length === 0 && eS.rental_rent_autopay?.length === 0, "export: a stranger gets none");
}

// --- gates
await bankPay(LANDLORD, tA, true, "landlord");
await svc(`UPDATE public.profiles SET stripe_payouts_enabled = false WHERE user_id = '${LANDLORD}'`);
ok(refused(await start(TENANT, tA, 1000), /payouts_not_ready/), "no payment while the landlord's payouts are off");
await svc(`UPDATE public.profiles SET stripe_payouts_enabled = true WHERE user_id = '${LANDLORD}'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await start(TENANT, tA, 1000), /feature/), "Homes off: no payment");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_bank_rent_attach(uuid,text,boolean)", "public.rentals_bank_rent_processing(uuid,text)", "public.rentals_bank_rent_succeeded(text)",
  "public.rentals_bank_rent_failed(uuid,boolean)", "public.rentals_bank_rent_returned(text,text)", "public.rentals_bank_transfers_due(integer)",
  "public.rentals_bank_transfer_executed(uuid,text,text,boolean,text)", "public.rentals_autopay_saved(uuid,uuid,text,text,text,boolean)", "public.rentals_autopay_due()"]) {
  const a = await acl(sig);
  ok(/service_role=X/.test(a) && !/(^|[{,])(anon|authenticated)?=X/.test(a), `${sig}: server only (${a})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (BANK_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
