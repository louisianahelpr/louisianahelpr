#!/usr/bin/env node
/**
 * PGlite proof for 20261030025302_confirm_reminder_once_after_a_day.sql
 * (owner 2026-10-29: ONE confirm-your-email reminder about 24 hours after
 * sign-up, never more than one; the current unconfirmed accounts get theirs).
 *
 * Applies 20261025190000_confirm_reminders.sql (the two-step original, as on
 * prod), then the new migration 3x (replay-safe), and checks:
 *   - step 1 is never due (no path can send the one-hour email);
 *   - the 24-hour edge to the millisecond: 1 ms short is not due, exactly 24 h
 *     and 1 ms past are;
 *   - no upper age bound (a 9-day-old account is due);
 *   - once only: a second claim returns nobody, and an account that already
 *     had the old step-1 email, or a step-2 one, is never claimed again;
 *   - test accounts, seed profiles, suppressed and fixture addresses skipped;
 *   - service_role only.
 * now() is fixed inside one transaction, so the edge cases are exact.
 *
 *   node src/test/pglite/confirmReminderOnce.pglite.mjs                       # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/confirmReminderOnce.pglite.mjs    # RED: live (unfixed) state
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

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
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text,
  work_visibility text, work_exempt_reason text);
CREATE FUNCTION public.is_fixture_email(p text) RETURNS boolean LANGUAGE sql IMMUTABLE
  AS $$ SELECT lower(coalesce(p, '')) ~ '@(mailinator\\.com|helpr\\.test)$' $$;
`);
await db.exec(mig("20261012031120_hidden_feature_switches.sql"));
await db.exec(mig("20261025190000_confirm_reminders.sql"));
// Prod state since 2026-10-26: the switch is on for everyone (20261025235208).
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'confirm_reminders'`);
if (!MODE) {
  for (let i = 0; i < 3; i++) await db.exec(mig("20261030025302_confirm_reminder_once_after_a_day.sql")); // replay-safe
}

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const NAMES = {
  1: "edge 1 ms short of 24 h", 2: "exactly 24 h", 3: "1 ms past 24 h", 4: "9 days old", 5: "2 hours old",
  6: "had the old one-hour email 20 h ago", 7: "already had the day email", 8: "test account", 9: "suppressed",
  10: "seed profile", 11: "fixture address", 12: "confirmed",
};

// 1. Server-only.
for (const role of ["anon", "authenticated"]) {
  const r = await asRole(db, role, `SELECT * FROM public.claim_confirm_reminders(2, 5)`);
  check(`${role} cannot call claim_confirm_reminders`, !!r.error, r.error ?? "call succeeded");
}
let r = await tryq(db, `SELECT prosecdef, ('search_path=""' = ANY (proconfig)) AS empty_path FROM pg_proc WHERE oid = 'public.claim_confirm_reminders(integer,integer)'::regprocedure`);
check("still SECURITY DEFINER with an empty search_path", r.rows[0]?.prosecdef === true && r.rows[0]?.empty_path === true, JSON.stringify(r.rows));

// 2. One transaction, so now() is the same instant for every insert and claim.
await db.exec("BEGIN");
const add = async (n, email, createdAt, extra = "") => {
  await db.exec(`INSERT INTO auth.users (id, email, created_at${extra ? ", email_confirmed_at" : ""})
                 VALUES ('${U(n)}', '${email}', ${createdAt}${extra ? ", now()" : ""});
                 INSERT INTO public.profiles (user_id, full_name) VALUES ('${U(n)}', 'Person ${n}');`);
};
await add(1, "edge1@gmail.com", "now() - interval '24 hours' + interval '1 millisecond'");
await add(2, "edge2@gmail.com", "now() - interval '24 hours'");
await add(3, "edge3@gmail.com", "now() - interval '24 hours' - interval '1 millisecond'");
await add(4, "old@gmail.com", "now() - interval '9 days'");
await add(5, "fresh@gmail.com", "now() - interval '2 hours'");
await add(6, "hadstep1@gmail.com", "now() - interval '30 hours'");
await db.exec(`INSERT INTO public.confirm_reminder_sends (user_id, reminder_step, claimed_at, queued_at)
               VALUES ('${U(6)}', 1, now() - interval '20 hours', now() - interval '20 hours')`);
await add(7, "hadstep2@gmail.com", "now() - interval '3 days'");
await db.exec(`INSERT INTO public.confirm_reminder_sends (user_id, reminder_step, claimed_at, queued_at)
               VALUES ('${U(7)}', 2, now() - interval '2 days', now() - interval '2 days')`);
await add(8, "tester@gmail.com", "now() - interval '30 hours'");
await db.exec(`INSERT INTO public.test_accounts (user_id) VALUES ('${U(8)}')`);
await add(9, "bounced@gmail.com", "now() - interval '30 hours'");
await db.exec(`INSERT INTO public.suppressed_emails (email, reason) VALUES ('BOUNCED@gmail.com', 'bounce')`);
await add(10, "seed@gmail.com", "now() - interval '30 hours'");
await db.exec(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${U(10)}'`);
await add(11, "x@mailinator.com", "now() - interval '30 hours'");
await add(12, "done@gmail.com", "now() - interval '30 hours'", "confirmed");

const claim = (step) => asRole(db, "service_role", `SELECT user_id::text AS id FROM public.claim_confirm_reminders(${step}, 50) ORDER BY user_id`);
const named = (rows) => rows.map((x) => NAMES[Number(x.id.slice(-2))] ?? x.id).join(", ") || "nobody";

r = await claim(1);
check("step 1 (the one-hour email) claims nobody, and does not raise", !r.error && r.rows.length === 0, r.error ?? named(r.rows));

r = await claim(2);
const got = new Set(r.rows.map((x) => x.id));
check("the day reminder claims exactly: exactly 24 h, 1 ms past 24 h, 9 days old",
  !r.error && got.size === 3 && got.has(U(2)) && got.has(U(3)) && got.has(U(4)), r.error ?? named(r.rows));
check("24-hour edge: 1 ms short is not due", !got.has(U(1)), named(r.rows));
check("no upper age bound: a 9-day-old account gets its one reminder", got.has(U(4)), named(r.rows));
check("never more than one: an account that had the old one-hour email is skipped", !got.has(U(6)), named(r.rows));
check("never more than one: an account that already had the day email is skipped", !got.has(U(7)), named(r.rows));
check("test account skipped", !got.has(U(8)), named(r.rows));
check("suppressed address skipped", !got.has(U(9)), named(r.rows));
check("seed profile and fixture address skipped", !got.has(U(10)) && !got.has(U(11)), named(r.rows));

r = await claim(2);
check("a second run claims nobody (once only)", !r.error && r.rows.length === 0, r.error ?? named(r.rows));
r = await claim(1);
check("step 1 after the day reminder still claims nobody", !r.error && r.rows.length === 0, r.error ?? named(r.rows));

r = await tryq(db, `SELECT count(*)::int AS n FROM (SELECT user_id FROM public.confirm_reminder_sends GROUP BY user_id HAVING count(*) > 1) x`);
check("no account holds more than one reminder row", r.rows[0]?.n === 0, JSON.stringify(r.rows));
await db.exec("COMMIT");

// 3. A bad step is still refused.
r = await asRole(db, "service_role", `SELECT * FROM public.claim_confirm_reminders(3, 5)`);
check("an unknown step is refused", !!r.error, r.error ?? "accepted");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
