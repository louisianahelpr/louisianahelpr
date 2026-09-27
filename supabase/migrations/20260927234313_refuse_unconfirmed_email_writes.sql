-- Q807 — the server refuses writes from a session whose email is unconfirmed.
--
-- WHAT WAS MISSING. Email confirmation was enforced in two places only: GoTrue
-- (mailer_autoconfirm = false, so a password sign-in for an unconfirmed
-- address gets no session) and the client (ProtectedRoute sends a session
-- with no email_confirmed_at to /signup-pending). Nothing in the database
-- looked at it. Any session that reached PostgREST some other way (an
-- admin-created user, a future phone or OAuth provider that does not confirm
-- the address, a flipped auth setting) could post jobs, apply, message and
-- pay through raw PostgREST or any SECURITY DEFINER RPC. Owner decision
-- 2026-09-27 (Q807): enforce it on the server.
--
-- WHY A STATEMENT TRIGGER ON EVERY TABLE, NOT RLS. 118 SECURITY DEFINER
-- functions are executable by `authenticated` (measured 2026-09-27) and they
-- bypass RLS, so a RESTRICTIVE policy would leave every RPC write open. A
-- trigger fires on every write path: PostgREST, SECURITY DEFINER RPCs,
-- updatable views and cascades started by the caller. It is FOR EACH
-- STATEMENT, so it costs one auth.users primary-key lookup per write
-- statement from an end-user session, and nothing for server contexts.
--
-- WHO IS REFUSED. public.session_email_unconfirmed(): a request whose JWT role
-- is `authenticated`, with a sub, whose auth.users row has no
-- email_confirmed_at (or no longer exists — a deleted user's still-valid
-- token cannot write either). Server contexts (service_role edge functions,
-- pg_cron, GoTrue's own connection during signup and confirmation, anon)
-- carry no end-user sub and pass untouched. The check reads auth.users, never
-- a JWT claim: user_metadata.email_verified is writable by the user through
-- auth.updateUser(), so it proves nothing.
--
-- EXEMPT TABLES: analytics_events and error_logs. Both accept anon inserts
-- (anyone_can_insert_analytics / anyone_can_insert_errors), so gating them
-- would stop nothing (sign out and write as anon) and would only drop the
-- telemetry that shows an unconfirmed session misbehaving.
--
-- STORAGE. storage.objects is not ours to put a trigger on; a RESTRICTIVE
-- policy for authenticated covers uploads, overwrites and deletes (storage
-- has no SECURITY DEFINER write path).
--
-- NEW TABLES. public.attach_unconfirmed_email_gate() is idempotent and
-- attaches the trigger to every public table that lacks it. A later migration
-- that creates a table calls it; src/test/unconfirmedEmailWritesRefused.test.ts
-- fails CI on a new table without the call.
--
-- Edge functions that write with the service role after auth.getUser() are a
-- separate layer (the trigger cannot see the end user there); they are
-- tracked in docs/OPEN.md.
--
-- REPLAY-SAFE: CREATE OR REPLACE, DROP ... IF EXISTS, and the attach loop
-- only touches tables that exist when it runs.

CREATE OR REPLACE FUNCTION public.session_email_unconfirmed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND coalesce(auth.role(), '') = 'authenticated'
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND u.email_confirmed_at IS NOT NULL
     )
$fn$;

REVOKE ALL ON FUNCTION public.session_email_unconfirmed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_email_unconfirmed() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refuse_unconfirmed_email_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- SECURITY DEFINER so the check runs whichever role fires the trigger
  -- (supabase_auth_admin, supabase_storage_admin, a future owner role) —
  -- session_email_unconfirmed() is not executable by PUBLIC.
  IF public.session_email_unconfirmed() THEN
    RAISE EXCEPTION 'email_unconfirmed'
      USING ERRCODE = '42501',
            HINT = 'Confirm your email address before making changes. See /signup-pending.';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refuse_unconfirmed_email_write() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attach_unconfirmed_email_gate()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND c.relname NOT IN ('analytics_events', 'error_logs')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_class'::regclass
            AND d.objid = c.oid AND d.deptype = 'e'
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = c.oid
            AND t.tgname = 'zz_refuse_unconfirmed_email_write'
       )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER zz_refuse_unconfirmed_email_write '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write()',
      r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.attach_unconfirmed_email_gate() FROM PUBLIC, anon, authenticated, service_role;

SELECT public.attach_unconfirmed_email_gate();

DROP POLICY IF EXISTS "Unconfirmed email cannot upload" ON storage.objects;
CREATE POLICY "Unconfirmed email cannot upload" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.session_email_unconfirmed());

DROP POLICY IF EXISTS "Unconfirmed email cannot update objects" ON storage.objects;
CREATE POLICY "Unconfirmed email cannot update objects" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.session_email_unconfirmed())
  WITH CHECK (NOT public.session_email_unconfirmed());

DROP POLICY IF EXISTS "Unconfirmed email cannot delete objects" ON storage.objects;
CREATE POLICY "Unconfirmed email cannot delete objects" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.session_email_unconfirmed());
