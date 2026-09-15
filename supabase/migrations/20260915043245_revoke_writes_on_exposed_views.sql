-- Every view in a client-exposed schema is SELECT-only for client roles.
--
-- Companion to 20260915041247 (open_jobs_browse), which fixed the one view
-- that was proven exploitable (it first failed the PG15 replay gate on
-- MAINTAIN, then deployed as REVOKE ALL in db-deploy run 34929239645). This
-- closes the rest of the class and re-asserts open_jobs_browse.
--
-- LIVE STATE READ 2026-09-15 ~04:30Z, BEFORE 20260915041247 reached prod
-- (pg_class.relacl via aclexplode, prod fncmgoasalhdgfwzhsqa, PostgreSQL
-- 17.6). Views/matviews in public or graphql_public where anon/authenticated
-- hold a write privilege:
--   public.open_jobs_browse  owner postgres, security_invoker=false
--                            anon + authenticated: INSERT UPDATE DELETE MAINTAIN
--   public.jobs_helper_safe  owner postgres, security_invoker=on
--                            anon + authenticated: INSERT UPDATE DELETE MAINTAIN
-- No materialized views exist. No app code writes through either view (every
-- src/ caller of open_jobs_browse is .select(); jobs_helper_safe has no caller).
--
-- PROOF (prod, one DO block that always ends in RAISE EXCEPTION, so every
-- probe rolled back; jobs.xmin of the target unchanged afterwards), is_seed
-- job 5eed0a10-0000-4000-8000-000000000001:
--   anon          open_jobs_browse  UPDATE title=title                 1 row
--   anon          open_jobs_browse  UPDATE payment_status, customer_id 1 row
--   anon          open_jobs_browse  DELETE                             1 row
--   authenticated open_jobs_browse  UPDATE / DELETE / INSERT           1 row each
--     (a signed-in non-party: the view runs as postgres, BYPASSRLS, and the
--      jobs guard triggers wave through a NULL auth.uid() as "service role")
--   anon          jobs_helper_safe  UPDATE / DELETE  permission denied for table jobs
--   authenticated jobs_helper_safe  UPDATE / DELETE  0 rows (RLS applies)
--   authenticated jobs_helper_safe  INSERT           1 row (own customer_id;
--     the same write jobs RLS already allows directly, so not a bypass — but
--     a second, unreviewed write door on jobs all the same)
--
-- WHY A LOOP AS WELL AS THE NAMES. prod's default privileges for postgres in
-- public grant anon/authenticated arwdxm on every relation created there, so
-- any DROP+CREATE of a view silently re-opens writes (that is how
-- 20260912021641 re-opened open_jobs_browse after 20260706140000 closed it).
-- The two named views are revoked explicitly; the loop catches any other view
-- or matview present at this point in the replay. What is created LATER is
-- caught by the class check, not by this migration:
--   scripts/ci/client-writable-views.sql
--     - db-smoke.yml (deploy gate): after replaying every migration
--     - scripts/check-updatable-views.mjs (db-drift-detect nightly, and
--       db-deploy after the push): against the live catalog
--
-- MAINTAIN is PostgreSQL 17+ only; the gate replays on 15, so it is added to
-- the privilege list at runtime behind server_version_num.
--
-- SELECT is untouched. A table-level REVOKE also removes column-level grants
-- of the same privilege. REPLAY-SAFE: named objects guarded by to_regclass;
-- REVOKE is idempotent; extension-owned views are skipped.

DO $$
DECLARE
  v_privs text := 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
  v_rel regclass;
  v record;
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_privs := v_privs || ', MAINTAIN';
  END IF;

  FOREACH v_rel IN ARRAY ARRAY[
    to_regclass('public.open_jobs_browse'),
    to_regclass('public.jobs_helper_safe')
  ] LOOP
    IF v_rel IS NOT NULL THEN
      EXECUTE format('REVOKE %s ON %s FROM PUBLIC, anon, authenticated', v_privs, v_rel);
    END IF;
  END LOOP;

  FOR v IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('v', 'm')
       AND n.nspname IN ('public', 'graphql_public')
       -- REVOKE by a role holding no privilege at all on the object is an
       -- error, not a warning. Only touch what this role can act for; a view
       -- owned by anyone else stays red in the class check instead.
       AND pg_has_role(current_user, c.relowner, 'USAGE')
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE %s ON %s FROM PUBLIC, anon, authenticated', v_privs, v.rel);
  END LOOP;
END
$$;
