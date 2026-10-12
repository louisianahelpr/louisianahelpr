#!/usr/bin/env node
/**
 * PGlite proof for 20261012043611_admin_signup_leads (Q1587): an admin reads
 * every sign-up lead through admin_signup_leads(); a signed-in non-admin gets
 * zero rows; anon cannot call it; the table stays closed to both.
 *
 *   node src/test/pglite/adminSignupLeads.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminSignupLeads.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Applies the
 * migration 3x (replay-safety).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};
const tryexec = async (db, sql) => {
  try {
    await db.exec(sql);
    return { error: null };
  } catch (e) {
    return { error: e.message };
  }
};
const asUser = async (db, role, uid, q) => {
  await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role}`);
  try {
    return await tryq(db, q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-00000000000b";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$ SELECT false $f$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $f$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${USER}', 'user');
-- Prod-like defaults: new functions open to the client roles unless closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`);

// The table and its writer, as prod has them (cron/registry steps skip without pg_cron).
const base = await tryexec(db, mig("20261009223714_signup_leads.sql"));
check("signup_leads base migration applies", !base.error, base.error ?? "");
await db.exec(`
INSERT INTO public.signup_leads (email, created_at) VALUES ('old@example.com', now() - interval '3 days');
INSERT INTO public.signup_leads (email, created_at, reminder_sent_at) VALUES ('reminded@example.com', now() - interval '2 days', now() - interval '1 day');
INSERT INTO public.signup_leads (email, created_at, completed_at) VALUES ('done@example.com', now() - interval '1 day', now());
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) {
    const r = await tryexec(db, mig("20261012043611_admin_signup_leads.sql"));
    check(`admin_signup_leads migration applies (pass ${i})`, !r.error, r.error ?? "");
  }
}

let r = await asUser(db, "authenticated", ADMIN, "SELECT email, completed_at IS NOT NULL AS done FROM public.admin_signup_leads()");
check("an admin reads every lead", !r.error && r.rows.length === 3, r.error ?? `${r.rows.length} rows`);
check("newest first", r.rows[0]?.email === "done@example.com", r.rows.map((x) => x.email).join(","));

r = await asUser(db, "authenticated", USER, "SELECT * FROM public.admin_signup_leads()");
check("a signed-in non-admin gets zero rows", !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);

r = await asUser(db, "anon", null, "SELECT * FROM public.admin_signup_leads()");
check("anon cannot call it", /permission denied/.test(r.error ?? ""), r.error ?? "call allowed");

for (const role of ["anon", "authenticated"]) {
  r = await asUser(db, role, role === "anon" ? null : ADMIN, "SELECT count(*) FROM public.signup_leads");
  check(`${role} still cannot read the table itself`, /permission denied/.test(r.error ?? ""), r.error ?? "read allowed");
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
