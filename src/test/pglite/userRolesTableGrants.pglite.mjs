#!/usr/bin/env node
/**
 * PGlite proof for 20261021184118_user_roles_table_grants.sql (Q2305): public.user_roles keeps RLS as its
 * second layer, not its only one.
 *
 *   npx tsx src/test/pglite/userRolesTableGrants.pglite.mjs [--replay] [--before]
 *
 * The table, its grants (relacl, MAINTAIN included), its five policies, its five
 * triggers and every function they call are PROD's, read live 2026-10-21
 * (information_schema.role_table_grants, pg_class.relacl, pg_policies,
 * pg_get_triggerdef / pg_get_functiondef; read-only). Function bodies are prod's
 * with comments and one HINT dropped; function EXECUTE grants are not modelled
 * (PGlite leaves them to PUBLIC), which only widens what a client role can call. --before leaves the
 * migration out and the RED checks must FAIL; without it the migration is
 * applied (3x with --replay) and every check must PASS.
 *
 *   R1 anon holds no privilege on user_roles at all                         RED before
 *   R2 authenticated holds only SELECT and DELETE (no INSERT/UPDATE/...)    RED before
 *   R2b neither client role holds MAINTAIN (Postgres 17+; information_schema
 *      does not list it, has_table_privilege does)                          RED before
 *   R3 a member's INSERT of a role is refused by the GRANT (permission
 *      denied), not only by a policy                                        RED before
 *   R1b anon cannot even read user_roles (permission denied, not zero rows) RED before
 * Kept (green before and after):
 *   K1 a member reads their own role; an admin reads every role
 *   K2 an admin removes another admin's role (AdminSettings removeAdmin, a
 *      client DELETE) and a member cannot remove anyone's
 *   K3 service_role grants admin (admin-user-actions grant_admin) and the
 *      audit trigger logs it
 *   K4 nobody (not even an admin) can UPDATE a role row
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021184118_user_roles_table_grants.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MEMBER = U(1), ADMIN = U(2), ADMIN2 = U(3), NEWBIE = U(4);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; -- as on Supabase
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE (user_id, role));
CREATE TABLE public.admin_audit_log (id bigserial PRIMARY KEY, admin_id uuid, action text, target_id text, target_type text, details jsonb);
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       _user_id IS NOT DISTINCT FROM auth.uid()
       OR public.is_server_context()
       OR pg_trigger_depth() > 0
       OR EXISTS (
         SELECT 1 FROM public.user_roles c
         WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role
       )
     )
     AND EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id AND role = _role
     )
$function$;

-- PROD trigger functions (pg_get_functiondef 2026-10-21), verbatim.
CREATE OR REPLACE FUNCTION public.audit_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(NEW.role, OLD.role)::text <> 'admin' THEN -- AM-004 skip automatic default roles
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
      'role_granted',
      NEW.user_id::text,
      'user_role',
      jsonb_build_object('role', NEW.role)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
      'role_revoked',
      OLD.user_id::text,
      'user_role',
      jsonb_build_object('role', OLD.role)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_admin_role_self_grant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := current_setting('role', true);
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Admin roles can only be granted via service_role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.session_email_unconfirmed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND coalesce(auth.role(), '') = 'authenticated'
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND u.email_confirmed_at IS NOT NULL
     )
$function$;
CREATE OR REPLACE FUNCTION public.enforce_no_admin_for_disposable_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  disposable CONSTANT text[] := ARRAY[
    'mailinator.com',
    'guerrillamail.com',
    'yopmail.com',
    '10minutemail.com',
    'tempmail.com',
    'temp-mail.org',
    'throwawaymail.com',
    'sharklasers.com',
    'trashmail.com',
    'maildrop.cc'
  ];
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = NEW.user_id;
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(disposable) AS d
    WHERE v_email LIKE '%@' || d
  ) THEN
    RAISE EXCEPTION
      'Refusing to grant admin to %, which is a public/disposable inbox: anyone can read its password-reset mail. Use a real, controlled address for admin accounts.',
      v_email
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.refuse_unconfirmed_email_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.session_email_unconfirmed() THEN
    RAISE EXCEPTION 'email_unconfirmed' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER audit_role_changes_trigger AFTER INSERT OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_role_changes();
CREATE TRIGGER enforce_admin_role_grant_insert BEFORE INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_self_grant();
CREATE TRIGGER enforce_admin_role_grant_update BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_self_grant();
CREATE TRIGGER trg_no_admin_for_disposable_email BEFORE INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_no_admin_for_disposable_email();
CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write();

-- PROD policies (pg_policies 2026-10-21).
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Deny all updates to user_roles" ON public.user_roles FOR UPDATE TO public USING (false) WITH CHECK (false);
CREATE POLICY "Users can read their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- PROD grants (pg_class.relacl 2026-10-21: anon=arwdxm, authenticated=arwdxm, service_role=arwdDxtm).
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, MAINTAIN ON public.user_roles TO anon, authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT INSERT ON public.admin_audit_log TO service_role;
GRANT USAGE ON SEQUENCE public.admin_audit_log_id_seq TO service_role;

INSERT INTO auth.users (id, email) VALUES ('${MEMBER}', 'm@x.test'), ('${ADMIN}', 'a@x.test'), ('${ADMIN2}', 'b@x.test'), ('${NEWBIE}', 'n@x.test');
-- Seeded as service_role: prevent_admin_role_self_grant refuses an admin row from anyone else.
SET ROLE service_role;
INSERT INTO public.user_roles (user_id, role) VALUES ('${MEMBER}', 'customer'), ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
RESET ROLE;
`;

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    await db.exec("BEGIN");
    const rows = (await db.query(sql)).rows;
    await db.exec("COMMIT");
    return { rows, err: null };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { rows: [], err: String(e.message) };
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);");
  }
}
const privs = async (grantee) => (await db.query(
  `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'user_roles' AND grantee = $1`, [grantee])).rows[0]?.p ?? "";

console.log(`${BEFORE ? "BEFORE (migration left out)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);
const anonP = await privs("anon");
check("R1 anon holds no privilege on user_roles", anonP === "", anonP, true);
const authP = await privs("authenticated");
check("R2 authenticated holds only SELECT and DELETE", authP === "DELETE,SELECT", authP, true);
const maint = (await db.query(
  `SELECT has_table_privilege('anon', 'public.user_roles', 'MAINTAIN') AS a, has_table_privilege('authenticated', 'public.user_roles', 'MAINTAIN') AS u`)).rows[0];
check("R2b neither anon nor authenticated holds MAINTAIN", maint.a === false && maint.u === false, `anon=${maint.a} authenticated=${maint.u}`, true);
const selfGrant = await as("authenticated", MEMBER, `INSERT INTO public.user_roles (user_id, role) VALUES ('${MEMBER}', 'helper') RETURNING id`);
check("R3 a member's role INSERT is refused by the grant (permission denied)", /permission denied/i.test(selfGrant.err ?? ""), selfGrant.err ?? "inserted", true);
const anonRead = await as("anon", null, "SELECT count(*)::int AS n FROM public.user_roles");
check("R1b anon cannot even read user_roles (permission denied, not zero rows)", /permission denied/i.test(anonRead.err ?? ""), anonRead.err ?? JSON.stringify(anonRead.rows), true);

const own = await as("authenticated", MEMBER, "SELECT role FROM public.user_roles");
const all = await as("authenticated", ADMIN, "SELECT role FROM public.user_roles");
check("K1 a member reads only their own role; an admin reads every role", own.err === null && own.rows.length === 1 && all.err === null && all.rows.length === 3,
  `${own.err ?? own.rows.length} / ${all.err ?? all.rows.length}`);
const memberDel = await as("authenticated", MEMBER, `DELETE FROM public.user_roles WHERE user_id = '${ADMIN2}' RETURNING id`);
const adminDel = await as("authenticated", ADMIN, `DELETE FROM public.user_roles WHERE user_id = '${ADMIN2}' AND role = 'admin' RETURNING id`);
check("K2 a member removes nobody; an admin removes another admin (client DELETE)",
  memberDel.err === null && memberDel.rows.length === 0 && adminDel.err === null && adminDel.rows.length === 1,
  `${memberDel.err ?? memberDel.rows.length} / ${adminDel.err ?? adminDel.rows.length}`);
const grant = await as("service_role", null, `INSERT INTO public.user_roles (user_id, role) VALUES ('${NEWBIE}', 'admin') RETURNING id`);
const logged = (await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'role_granted' AND target_id = '${NEWBIE}'`)).rows[0].n;
check("K3 service_role grants admin and the audit trigger logs it", grant.err === null && grant.rows.length === 1 && logged === 1, `${grant.err} logged=${logged}`);
const upd = await as("authenticated", ADMIN, `UPDATE public.user_roles SET role = 'admin' WHERE user_id = '${MEMBER}' RETURNING id`);
check("K4 nobody can UPDATE a role row (an admin's UPDATE changes nothing or is refused)", upd.err !== null || upd.rows.length === 0, JSON.stringify(upd.rows));

console.log(`\n${failures} failure(s)${BEFORE ? `, ${redFailures} of them RED checks (expected: every RED check fails before)` : ""}`);
if (BEFORE) process.exit(redFailures === 5 && failures === 5 ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);
