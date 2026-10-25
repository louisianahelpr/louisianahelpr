#!/usr/bin/env node
/**
 * PGlite proof for 20261025190000_confirm_reminders.sql (lead, 2026-10-25).
 *
 * Confirm-your-email reminders: claim_confirm_reminders(step, limit) claims
 * unconfirmed EMAIL accounts due for step 1 (1h..23h after sign-up) or step 2
 * (24h..7d), at most once per account and step, never a test/seed/suppressed/
 * fixture address, and only while the confirm_reminders switch is on for the
 * account. scanner_safe_confirm_link_for(uuid) answers the auth email hook.
 *
 * Run: node src/test/pglite/confirmReminders.pglite.mjs
 * Skip the migration (expect failures): MIGRATION_PATH=/dev/null node ...
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20261025190000_confirm_reminders.sql");

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};
const asRole = async (db, role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await tryq(db, q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, email_confirmed_at timestamptz, deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false, banned_until timestamptz, raw_app_meta_data jsonb NOT NULL DEFAULT '{"provider":"email"}',
  confirmation_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean NOT NULL DEFAULT false, anonymized_at timestamptz);
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, reason text);
CREATE FUNCTION public.is_fixture_email(p text) RETURNS boolean LANGUAGE sql IMMUTABLE
  AS $$ SELECT lower(coalesce(p, '')) ~ '@(mailinator\\.com|helpr\\.test)$' $$;
`);
await db.exec(SWITCHES);
for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe: applied three times

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const add = (n, email, createdAgo, extra = "") =>
  db.exec(`INSERT INTO auth.users (id, email, created_at${extra ? ", " + extra.split("=")[0] : ""})
           VALUES ('${U(n)}', '${email}', now() - interval '${createdAgo}'${extra ? ", " + extra.split("=").slice(1).join("=") : ""});
           INSERT INTO public.profiles (user_id, full_name) VALUES ('${U(n)}', 'Person ${n}');`);
await add(1, "due1@gmail.com", "2 hours");                    // step 1 due
await add(2, "fresh@gmail.com", "20 minutes");                // too new
await add(3, "due2@gmail.com", "30 hours");                   // step 2 due
await add(4, "old@gmail.com", "9 days");                      // past the window
await add(5, "done@gmail.com", "2 hours", "email_confirmed_at=now()");
await add(6, "google@gmail.com", "2 hours", `raw_app_meta_data='{"provider":"google"}'`);
await add(7, "x@mailinator.com", "2 hours");                  // fixture address
await add(8, "bounced@gmail.com", "2 hours");
await db.exec(`INSERT INTO public.suppressed_emails (email, reason) VALUES ('BOUNCED@gmail.com', 'bounce')`);
await add(9, "tester@gmail.com", "2 hours");
await db.exec(`INSERT INTO public.test_accounts (user_id) VALUES ('${U(9)}')`);
await add(10, "seed@gmail.com", "2 hours");
await db.exec(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${U(10)}'`);

const claim = (step) => asRole(db, "service_role", `SELECT user_id::text AS id, email FROM public.claim_confirm_reminders(${step}, 50) ORDER BY email`);

// 1. Server-only.
let r = await tryq(db, `SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.confirm_reminder_sends')`);
check("confirm_reminder_sends exists with row level security on", r.rows[0]?.relrowsecurity === true, JSON.stringify(r.rows));
for (const role of ["anon", "authenticated"]) {
  r = await asRole(db, role, `SELECT count(*) FROM public.confirm_reminder_sends`);
  check(`${role} cannot read confirm_reminder_sends`, !!r.error, r.error ?? "read succeeded");
  r = await asRole(db, role, `SELECT * FROM public.claim_confirm_reminders(1, 5)`);
  check(`${role} cannot call claim_confirm_reminders`, !!r.error, r.error ?? "call succeeded");
  r = await asRole(db, role, `SELECT public.scanner_safe_confirm_link_for('${U(1)}')`);
  check(`${role} cannot call scanner_safe_confirm_link_for`, !!r.error, r.error ?? "call succeeded");
}

// 2. Both switches are created for testers.
r = await tryq(db, `SELECT key, audience::text AS a FROM public.feature_switches WHERE key IN ('confirm_reminders','scanner_safe_confirm_links') ORDER BY key`);
check("both switches exist at testers", r.rows.length === 2 && r.rows.every((x) => x.a === "testers"), JSON.stringify(r.rows));

// 3. Switch at testers: no ordinary account is claimed (test accounts are excluded by design).
r = await claim(1);
check("switch at testers: nobody is claimed", r.rows.length === 0 && !r.error, JSON.stringify(r));
r = await asRole(db, "service_role", `SELECT public.scanner_safe_confirm_link_for('${U(1)}') AS v, public.scanner_safe_confirm_link_for('${U(9)}') AS t`);
check("scanner-safe link: off for an ordinary account, on for a tester", r.rows[0]?.v === false && r.rows[0]?.t === true, JSON.stringify(r));

// 4. Everyone: exactly the due, eligible accounts, once.
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key IN ('confirm_reminders','scanner_safe_confirm_links')`);
r = await claim(1);
check("step 1 claims only the account due about an hour after sign-up",
  r.rows.length === 1 && r.rows[0].id === U(1), JSON.stringify(r));
r = await claim(1);
check("step 1 again claims nobody (once per account)", r.rows.length === 0, JSON.stringify(r));
r = await claim(2);
check("step 2 claims only the account a day old", r.rows.length === 1 && r.rows[0].id === U(3), JSON.stringify(r));
r = await claim(2);
check("step 2 again claims nobody", r.rows.length === 0, JSON.stringify(r));
r = await asRole(db, "service_role", `SELECT public.scanner_safe_confirm_link_for('${U(1)}') AS v`);
check("scanner-safe link on for everyone once widened", r.rows[0]?.v === true, JSON.stringify(r));

// 5. A bad step is refused.
r = await asRole(db, "service_role", `SELECT * FROM public.claim_confirm_reminders(3, 5)`);
check("an unknown step is refused", !!r.error, r.error ?? "accepted");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
