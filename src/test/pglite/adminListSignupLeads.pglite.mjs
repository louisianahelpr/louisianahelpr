#!/usr/bin/env node
/**
 * PGlite proof for 20261012030524_admin_list_signup_leads (Q1587).
 *
 *   node src/test/pglite/adminListSignupLeads.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminListSignupLeads.pglite.mjs   # RED: no admin read exists
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Fixture: public.signup_leads with the columns and grants of 20261009223714
 * (RLS on, no policy, service_role only; live relacl 2026-10-11
 * {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}), and
 * public.has_role verbatim from pg_get_functiondef (md5(prosrc) checked
 * against prod's dae5cfc5a8d92461a428f6702e4e65af). Roles are real: `SET ROLE
 * authenticated` with a uid is a PostgREST request with a user JWT.
 * The migration is applied 3x, then:
 *   - an admin reads every lead, newest first, with the total on each row;
 *   - a signed-in non-admin is refused (admin_only), anon has no EXECUTE;
 *   - the table itself is still unreadable by authenticated.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261012030524_admin_list_signup_leads.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const MEMBER = "bbbbbbbb-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE TABLE public.signup_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  unsubscribed_at timestamptz
);
ALTER TABLE public.signup_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signup_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.signup_leads TO service_role;

INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.signup_leads (email, created_at, reminder_sent_at, completed_at, unsubscribed_at) VALUES
  ('old@x.test', now() - interval '3 days', now() - interval '2 days', NULL, NULL),
  ('done@x.test', now() - interval '2 days', NULL, now() - interval '1 day', NULL),
  ('new@x.test', now() - interval '1 hour', NULL, NULL, NULL);
`);
{
  const m = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = 'has_role'`)).rows[0].m;
  check("fixture: has_role is prod's code (md5 of prosrc)", m === "dae5cfc5a8d92461a428f6702e4e65af", m);
}
// Prod's pg_default_acl hands EXECUTE on every new function to anon and
// authenticated (MEMORY, measured); model it so the migration's REVOKE is tested.
await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  const role = who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

const CALL = "SELECT email, reminder_sent_at IS NOT NULL AS reminded, completed_at IS NOT NULL AS completed, total_count::int AS n FROM public.admin_list_signup_leads()";
{
  const r = await as(ADMIN, CALL);
  const emails = r.ok ? r.rows.map((x) => x.email) : [];
  check("A1 an admin reads every lead, newest first", r.ok && JSON.stringify(emails) === JSON.stringify(["new@x.test", "done@x.test", "old@x.test"]), r.ok ? JSON.stringify(emails) : r.err);
  check("A2 ...with the total on every row and the reminder/completion stamps", r.ok && r.rows.every((x) => x.n === 3)
    && r.rows.find((x) => x.email === "old@x.test")?.reminded === true && r.rows.find((x) => x.email === "done@x.test")?.completed === true,
    r.ok ? JSON.stringify(r.rows) : r.err);
}
{
  const r = await as(MEMBER, CALL);
  check("A3 a signed-in non-admin is refused (admin_only)", !r.ok && /admin_only/.test(r.err), r.ok ? "read rows" : r.err);
  const r2 = await as(null, CALL);
  check("A4 anon has no EXECUTE", !r2.ok && /permission denied|does not exist/.test(r2.err), r2.ok ? "read rows" : r2.err);
  const r3 = await as(MEMBER, "SELECT count(*) FROM public.signup_leads");
  check("A5 the table itself is still closed to authenticated", !r3.ok && /permission denied/.test(r3.err), r3.ok ? "read rows" : r3.err);
}
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, provolatile, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.admin_list_signup_leads()')`)).rows[0];
  check("F1 SECURITY DEFINER, STABLE, EXECUTE for authenticated + service_role only (no anon, no PUBLIC)",
    f && f.prosecdef === true && f.provolatile === "s" && /authenticated=X/.test(f.acl) && /service_role=X/.test(f.acl)
      && !/(^|[{,])(anon)?=X/.test(f.acl), JSON.stringify(f));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
