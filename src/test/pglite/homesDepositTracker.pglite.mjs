#!/usr/bin/env node
/**
 * PGlite proof for 20261019082216_rentals_deposit_tracker (owner D6: deposit TRACK ONLY, paid directly to
 * the landlord; R.S. 9:3251 one-month return clock, itemized statement, forwarding address): the landlord
 * records the deposit, the tenant gives a forwarding address (the landlord reads it only after the tenancy
 * ends), the landlord settles it after the end (returned + itemized kept = the deposit, final), both sides
 * read one record, and the daily sweep reminds the landlord on the end day, 7 days before and after the
 * return-by date, once each.
 *
 *   node src/test/pglite/homesDepositTracker.pglite.mjs
 *   DEPOSIT_MIGRATION=skip node src/test/pglite/homesDepositTracker.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesDepositTracker.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261019082216";
const RENT = readFileSync(`${MIG_DIR}20261019073106_rentals_rent_tracker.sql`, "utf8");
const PHOTOS = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");
const LINK = readFileSync(`${MIG_DIR}20261019062540_rentals_public_link_takedown.sql`, "utf8");
const SALE = readFileSync(`${MIG_DIR}20261019061241_rentals_sale_listings.sql`, "utf8");
const LISTINGS = readFileSync(`${MIG_DIR}20261019043000_rentals_listings.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}_rentals_deposit_tracker.sql`, "utf8");
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

const skip = process.env.DEPOSIT_MIGRATION === "skip";
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

const dep = async (uid, t) => { const r = await as("authenticated", uid, `SELECT public.rentals_deposit('${t}') AS d`); return Array.isArray(r) ? r[0]?.d : r; };
const setDep = (uid, t, amt, on = today) => as("authenticated", uid, `SELECT public.rentals_set_deposit('${t}', ${amt}, '${on}')`);
const fwd = (uid, t, a) => as("authenticated", uid, `SELECT public.rentals_set_forwarding_address('${t}', '${a}')`);
const settle = (uid, t, ret, items, on = today) =>
  as("authenticated", uid, `SELECT public.rentals_settle_deposit('${t}', ${ret}, '${JSON.stringify(items).replace(/'/g, "''")}'::jsonb, '${on}')`);
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

// --- recording: the landlord's, validated
ok((await dep(TENANT, tA))?.deposit === null && (await dep(TENANT, tA))?.side === "tenant", "no deposit yet: both sides read an empty record");
ok(refused(await setDep(TENANT, tA, 120000), /tenancy_not_found/, "P0002"), "the tenant cannot record the deposit");
ok(refused(await setDep(STRANGER, tA, 120000), /tenancy_not_found/, "P0002"), "nor a stranger");
ok(refused(await setDep(LANDLORD, tA, 50), /bad_deposit/, "22023"), "a deposit under $1 is refused");
ok(refused(await setDep(LANDLORD, tA, 120000, "2099-01-01"), /bad_deposit/, "22023"), "a received date in the future is refused");
ok(Array.isArray(await setDep(LANDLORD, tA, 120000)), "the landlord records a $1,200 deposit received today");
ok((await notes(TENANT, "Deposit recorded")) === 1, "the tenant is told");
ok(refused(await as("authenticated", TENANT, `SELECT * FROM public.rental_deposits`), /permission denied/), "no client reads the table directly (the address rule lives in rentals_deposit)");
ok(refused(await as("authenticated", LANDLORD, `UPDATE public.rental_deposits SET amount_cents = 1`), /permission denied/), "nor writes it");

// --- the forwarding address: the tenant's; the landlord reads it only once the tenancy ended AND the tenant ended it
// or the lease end date passed (lead review #4)
ok(refused(await fwd(LANDLORD, tA, "500 New Home Rd, Baton Rouge LA 70801"), /tenancy_not_found/, "P0002"), "the landlord cannot set the tenant's address");
ok(refused(await fwd(TENANT, tA, "short"), /bad_address/, "22023"), "an address needs 10+ characters");
ok(Array.isArray(await fwd(TENANT, tA, "500  New Home Rd,  Baton Rouge LA 70801")), "the tenant gives a forwarding address");
ok((await dep(TENANT, tA))?.forwarding_address === "500 New Home Rd, Baton Rouge LA 70801", "the tenant sees their own (spaces tidied)");
const live = await dep(LANDLORD, tA);
ok(live?.forwarding_address === null && live.has_forwarding_address === true && live.deposit.return_by === null,
  "while the tenancy is live the landlord sees only that an address was given, not the address, and no return clock yet");

// --- settling: only after the tenancy ends; returned + itemized kept = the deposit; final
ok(refused(await settle(LANDLORD, tA, 120000, []), /tenancy_not_ended/, "22023"), "a deposit is settled after the tenancy ends");
ok(Array.isArray(await as("authenticated", LANDLORD, `SELECT public.rentals_end_tenancy('${tA}')`)), "the LANDLORD ends the tenancy early");
const ended = await dep(LANDLORD, tA);
const due = one(await svc(`SELECT (((now() AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date)::text`));
ok(ended?.ended_by === "landlord" && ended.forwarding_address === null && ended.address_visible_to_landlord === false && ended.deposit.return_by === due,
  "#4: after a landlord-only early end the landlord still does not see the address; the one-month return-by date runs (R.S. 9:3251)");
ok((await dep(TENANT, tA))?.address_visible_to_landlord === false, "and the tenant is shown it is not shared yet");
ok(Array.isArray(await setDep(LANDLORD, tA, 120000, today)), "#10: the landlord can still record (or fix) the deposit after the end, within 30 days");
await svc(`UPDATE public.rental_tenancies SET lease_ends_on = public.shop_local_today() WHERE id = '${tA}'`);
const atLeaseEnd = await dep(LANDLORD, tA);
ok(atLeaseEnd?.forwarding_address === "500 New Home Rd, Baton Rouge LA 70801" && atLeaseEnd.address_visible_to_landlord === true,
  "#4: once the lease end date passes the landlord sees the forwarding address");
const endedL = rows(await as("authenticated", LANDLORD, `SELECT * FROM public.rentals_my_ended_deposits()`));
const endedT = rows(await as("authenticated", TENANT, `SELECT * FROM public.rentals_my_ended_deposits()`));
ok(endedL.length === 1 && endedL[0].tenancy_id === tA && endedL[0].side === "landlord" && endedL[0].label === "Oak house" && endedL[0].settled === false
  && endedT.length === 1 && endedT[0].side === "tenant",
  "after move-out both sides still find the deposit to settle (the live-tenancy cards are gone)");
ok(empty(await as("authenticated", STRANGER, `SELECT * FROM public.rentals_my_ended_deposits()`)), "a stranger finds none");
ok(refused(await settle(TENANT, tA, 120000, []), /tenancy_not_found/, "P0002"), "the tenant cannot settle it");
ok(refused(await settle(LANDLORD, tA, 100000, []), /bad_settlement/, "22023"), "returned + kept must equal the deposit (an unexplained $200 short is refused)");
ok(refused(await settle(LANDLORD, tA, 100000, [{ reason: "x", amount_cents: 20000 }]), /bad_settlement/), "each amount kept needs a reason (3+ characters)");
ok(refused(await settle(LANDLORD, tA, 130000, [{ reason: "Carpet cleaning", amount_cents: -10000 }]), /bad_settlement/), "no negative deduction");
ok(refused(await settle(LANDLORD, tA, 120000, [], "2099-01-01"), /bad_settlement/), "no return date in the future");

// --- the sweep: reminders to the landlord, once per stage
const sw = async () => rows(await svc(`SELECT public.rentals_deposit_sweep() AS r`))[0]?.r;
const s1 = await sw();
ok(s1?.reminders === 1 && (await notes(LANDLORD, "Return the deposit")) === 1, "the end day: the landlord is reminded of the one-month rule");
ok(s1?.address_notices === 1 && (await notes(TENANT, "Forwarding address shared")) === 1, "#4: the tenant is told once the landlord can see their address");
await sw();
ok((await notes(LANDLORD, "Return the deposit")) === 1 && (await notes(TENANT, "Forwarding address shared")) === 1, "once each (a second sweep sends nothing)");
await svc(`UPDATE public.rental_tenancies SET ended_at = now() - interval '25 days' WHERE id = '${tA}'`);
await sw(); await sw();
ok((await notes(LANDLORD, "Deposit return due soon")) === 1, "7 days before the return-by date: one reminder");
await svc(`UPDATE public.rental_tenancies SET ended_at = now() - interval '33 days' WHERE id = '${tA}'`);
await sw(); await sw();
ok((await notes(LANDLORD, "Deposit return is overdue")) === 1, "past the return-by date: one overdue reminder");
ok(refused(await setDep(LANDLORD, tA, 1000), /tenancy_not_found/), "#10: more than 30 days after the end the amount no longer changes");
ok((await notes(TENANT, "Deposit return is overdue")) === 0, "the reminders go to the landlord only");

ok(Array.isArray(await settle(LANDLORD, tA, 95000, [{ reason: "Carpet cleaning", amount_cents: 15000 }, { reason: "Broken blinds", amount_cents: 10000 }])),
  "the landlord settles: $950 returned, $250 kept, itemized");
const fin = await dep(TENANT, tA);
ok(fin?.deposit?.returned_cents === 95000 && fin.deposit.deductions.length === 2 && fin.deposit.deductions[0].reason === "Carpet cleaning" && typeof fin.deposit.settled_at === "string",
  "the tenant sees what came back and each amount kept with its reason");
const st = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${TENANT}' AND title = 'Deposit statement'`));
ok(typeof st === "string" && st.includes("$950.00") && st.includes("Carpet cleaning: $150.00") && st.includes("Broken blinds: $100.00"),
  "the tenant gets the itemized statement");
ok(refused(await settle(LANDLORD, tA, 120000, []), /deposit_settled/, "22023"), "a settled deposit is final");
ok(refused(await fwd(TENANT, tA, "9 Other Street, Lafayette LA 70501"), /deposit_settled/), "and its address no longer changes");
await svc(`UPDATE public.rental_deposits SET reminded_stage = 0 WHERE tenancy_id = '${tA}'`);
ok((await sw())?.reminders === 0, "a settled deposit is never reminded");

// --- Download My Data (20261019083350): the four new sections, their real text, run for each person
const EXPORT_SQL = readFileSync(`${MIG_DIR}20261019083350_export_my_data_rent_deposit.sql`, "utf8");
const secStart = EXPORT_SQL.indexOf("  -- Homes rent tracker (20261019073106) and deposit tracker");
const secEnd = EXPORT_SQL.indexOf("  RETURN v_out;", secStart);
ok(secStart > 0 && secEnd > secStart, "setup: the export's rent/deposit sections found in the migration");
await svc(`CREATE OR REPLACE FUNCTION public.export_sections_probe(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE v_uid uuid := p_user_id; v_out jsonb := '{}'::jsonb;
BEGIN
${EXPORT_SQL.slice(secStart, secEnd)}  RETURN v_out;
END $probe$`);
const ex = async (u) => one(await svc(`SELECT public.export_sections_probe('${u}')`));
const exT = await ex(TENANT), exL = await ex(LANDLORD), exS = await ex(STRANGER);
ok(exT?.rental_deposits?.length === 1 && exT.rental_deposits[0].forwarding_address === "500 New Home Rd, Baton Rouge LA 70801"
  && exT.rental_rent_plans.length === 0 && Array.isArray(exT.rental_rent_charges) && Array.isArray(exT.rental_rent_payments),
  "export: the tenant gets their deposit record with their own forwarding address");
ok(exL?.rental_deposits?.length === 1 && exL.rental_deposits[0].forwarding_address === "500 New Home Rd, Baton Rouge LA 70801",
  "export: the landlord gets it too, the address included once the tenancy has ended");
ok(exS?.rental_deposits?.length === 0 && exS.rental_rent_plans.length === 0 && exS.rental_rent_charges.length === 0 && exS.rental_rent_payments.length === 0,
  "export: a stranger gets none of it");
await svc(`INSERT INTO public.rental_deposits (tenancy_id, amount_cents, received_on, forwarding_address) VALUES ('${tB}', 50000, public.shop_local_today(), '12 Live Street, Lafayette LA 70501')`);
const exL2 = await ex(LANDLORD);
ok(exL2?.rental_deposits?.find((d) => d.tenancy_id === tB) && !("forwarding_address" in exL2.rental_deposits.find((d) => d.tenancy_id === tB)),
  "export: the landlord of a LIVE tenancy never gets the tenant's forwarding address");
ok((await ex(TENANT2))?.rental_deposits?.[0]?.forwarding_address === "12 Live Street, Lafayette LA 70501", "export: that tenant does");
await svc(`DELETE FROM public.rental_deposits WHERE tenancy_id = '${tB}'`);
ok(exL?.rental_deposits?.[0]?.forwarding_address !== undefined, "setup: the landlord export above came after the lease end date passed");

// --- lead review #10 + #4: the address before the deposit; a TENANT-ended tenancy shares it at once; recorded after the end
ok(Array.isArray(await fwd(TENANT2, tB, "77 Next Place, Lafayette LA 70503")), "#10: the tenant gives the address before any deposit is recorded");
const preB = await dep(TENANT2, tB);
ok(preB?.deposit === null && preB.forwarding_address === "77 Next Place, Lafayette LA 70503", "kept on the tenancy's record, no deposit yet");
ok((await dep(LANDLORD, tB))?.forwarding_address === null && (await dep(LANDLORD, tB))?.has_forwarding_address === true, "the landlord of the live tenancy sees only that one was given");
ok(Array.isArray(await as("authenticated", TENANT2, `SELECT public.rentals_end_tenancy('${tB}')`)), "the TENANT ends the tenancy");
ok((await dep(LANDLORD, tB))?.forwarding_address === "77 Next Place, Lafayette LA 70503" && (await dep(LANDLORD, tB))?.can_record === true,
  "#4: a tenant-ended tenancy shares the address at once; the landlord can still record the deposit");
ok(rows(await as("authenticated", LANDLORD, `SELECT * FROM public.rentals_my_ended_deposits()`)).some((r) => r.tenancy_id === tB),
  "#10: the moved-out list carries the ended tenancy with no deposit yet");
ok(Array.isArray(await setDep(LANDLORD, tB, 50000, today)), "#10: the landlord records the deposit after the end");
const postB = await dep(TENANT2, tB);
ok(postB?.deposit?.amount_cents === 50000 && postB.forwarding_address === "77 Next Place, Lafayette LA 70503", "the address given earlier is attached to it");
await svc(`DELETE FROM public.test_accounts WHERE user_id IN ('${TENANT2}', '${LANDLORD}')`);
const sOff = await sw();
ok(sOff?.reminders === 0 && sOff.address_notices === 0 && (await notes(TENANT2, "Forwarding address shared")) === 0,
  "#8: Homes off for the landlord: no reminder; off for the tenant: no notice");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${LANDLORD}')`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok((await sw())?.reminders === 0, "#8: a banned landlord gets no reminder");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${TENANT2}')`);
const sBack = await sw();
ok(sBack?.reminders === 1 && sBack.address_notices === 1 && (await notes(TENANT2, "Forwarding address shared")) === 1, "both go out once they are back");

// --- gates
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'rentals'`);
ok(refused(await setDep(LANDLORD, tB, 50000), /feature_disabled/), "Homes off: no writes");
ok(refused(await as("authenticated", LANDLORD, `SELECT public.rentals_deposit('${tB}')`), /feature_disabled/), "nor reads");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals'`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${LANDLORD}'`);
ok(refused(await setDep(LANDLORD, tB, 50000), /account_restricted/), "a banned landlord cannot record one");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${LANDLORD}'`);
ok(refused(await as("anon", null, `SELECT public.rentals_deposit('${tB}')`), /permission denied/), "anon cannot read");

const acl = async (sig) => one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = '${sig}'::regprocedure`)) ?? "";
for (const sig of ["public.rentals_set_deposit(uuid,integer,date)", "public.rentals_set_forwarding_address(uuid,text)",
  "public.rentals_settle_deposit(uuid,integer,jsonb,date)", "public.rentals_deposit(uuid)", "public.rentals_my_ended_deposits()"]) {
  const a = await acl(sig);
  ok(/authenticated=X/.test(a) && !/(^|[{,])(anon)?=X/.test(a), `${sig}: authenticated, not anon/PUBLIC (${a})`);
}
const sa = await acl("public.rentals_deposit_sweep()");
ok(/service_role=X/.test(sa) && !/(^|[{,])(anon|authenticated)?=X/.test(sa), `rentals_deposit_sweep: server-only (${sa})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (DEPOSIT_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
