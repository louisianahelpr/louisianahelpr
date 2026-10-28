#!/usr/bin/env node
/**
 * PGlite proof for 20261028151647_feature_switch_members (owner 2026-10-28: Declutter for the owner and Ben Lombas,
 * real payments): a member on the list sees a 'testers' switch exactly as a tester does, only for the keys they are
 * on; 'off' stays off; no client role can read or write the list; the seed rows land only for the two e-mails.
 *
 *   node src/test/pglite/featureSwitchMembers.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/featureSwitchMembers.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The REAL switch migration
 * (20261012031120) is applied first, then this migration 3x (replay-safety).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH ? readFileSync(process.env.MIGRATION_PATH, "utf8") : mig("20261028151647_feature_switch_members.sql");

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
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'LexiLombas05@gmail.com'),
  ('00000000-0000-0000-0000-00000000000b', 'rentsdue01@yahoo.com'),
  ('00000000-0000-0000-0000-00000000000c', 'someone@example.com');
`);
await db.exec(SWITCHES);
await db.exec(`
INSERT INTO public.feature_switches (key, audience, description) VALUES
  ('declutter', 'testers', 'd'), ('declutter_wanted', 'testers', 'w'), ('declutter_off_one', 'off', 'o'), ('shops', 'testers', 's')
ON CONFLICT (key) DO UPDATE SET audience = EXCLUDED.audience;
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try {
      await db.exec(MIGRATION);
    } catch (e) {
      err = e.message;
    }
    check(`migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}

const LEXI = "00000000-0000-0000-0000-00000000000a";
const BEN = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const on = async (key, uid) => (await tryq(db, `SELECT public.feature_enabled_for_user('${key}', '${uid}') AS v`)).rows[0]?.v === true;

check("Ben sees Declutter (testers)", await on("declutter", BEN));
check("Ben sees a Declutter sub-switch (testers)", await on("declutter_wanted", BEN));
check("the owner is enrolled too (e-mail matched case-insensitively)", await on("declutter", LEXI));
check("Ben does NOT see a switch he is not on (shops)", !(await on("shops", BEN)));
check("'off' stays off for an enrolled member", !(await on("declutter_off_one", BEN)));
check("an ordinary member does not see Declutter", !(await on("declutter", OTHER)));
const rows = (await tryq(db, "SELECT count(*)::int AS n FROM public.feature_switch_members")).rows[0]?.n;
check("seed rows: 2 people x 3 declutter keys, nothing for anyone else", rows === 6, `n=${rows}`);

for (const role of ["anon", "authenticated"]) {
  const read = await asRole(db, role, "SELECT * FROM public.feature_switch_members");
  check(`${role} cannot read the list`, !!read.error, read.error ?? "read succeeded");
  const write = await asRole(db, role, `INSERT INTO public.feature_switch_members (key, user_id) VALUES ('shops', '${OTHER}')`);
  check(`${role} cannot add itself to the list`, !!write.error, write.error ?? "insert succeeded");
  const call = await asRole(db, role, `SELECT public.feature_enabled_for_user('declutter', '${BEN}')`);
  check(`${role} cannot call feature_enabled_for_user`, !!call.error, call.error ?? "call succeeded");
}

await db.exec(`DELETE FROM auth.users WHERE id = '${BEN}'`);
const left = (await tryq(db, `SELECT count(*)::int AS n FROM public.feature_switch_members WHERE user_id = '${BEN}'`)).rows[0]?.n;
check("account deletion removes the member's rows", left === 0, `n=${left}`);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
