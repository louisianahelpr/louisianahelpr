-- New relations in public stop arriving pre-granted to anon and authenticated.
--
-- WHAT WAS BROKEN. Prod's default privileges (pg_default_acl, read live
-- 2026-09-15) handed every TABLE, VIEW and SEQUENCE that postgres creates in
-- public to the client roles:
--   tables/views  anon=arwdxm  authenticated=arwdxm  (SELECT INSERT UPDATE
--                 DELETE REFERENCES MAINTAIN)
--   sequences     anon=rwU     authenticated=rwU
-- So a new relation was client-writable the moment it existed, and a
-- DROP+CREATE silently re-granted whatever an earlier migration had revoked.
-- That is exactly how public.open_jobs_browse (an owner-run, RLS-bypassing
-- view) became writable by anon: 20260706140000 revoked its writes, then
-- 20260912021641 recreated it and the default grant came back
-- (20260915041247 / 20260915043245 closed that door).
--
-- WHAT THIS DOES. Removes those two default-privilege entries for role
-- postgres in schema public. Nothing else:
--   * EXISTING objects keep every grant they have today. ALTER DEFAULT
--     PRIVILEGES only shapes objects created after it runs.
--   * service_role keeps its default grants, so edge functions can still read
--     and write any new table without a migration having to remember them.
--   * FUNCTIONS are deliberately left alone. anon's EXECUTE on a new function
--     does not come only from this schema's entry: the built-in default grants
--     EXECUTE to PUBLIC, which anon inherits, and only a database-wide
--     `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS
--     FROM PUBLIC` removes that. And about half of the recent client-callable
--     function definitions (74 of 131 non-trigger definitions since
--     2026-08-01) do not restate their grant, relying on CREATE OR REPLACE
--     keeping the ACL, while check-migration-grants.mjs is satisfied by a
--     GRANT anywhere in history. A DROP+CREATE after a function-default revoke
--     would therefore lose EXECUTE with every guard green. Left for its own
--     change, with its own check (docs/OPEN.md).
--   * supabase_admin's entries for public are not changed: postgres is not a
--     member of supabase_admin and cannot alter them, and supabase_admin owns
--     no relation in public (all 77 tables, 2 views, 6 sequences are postgres).
--
-- WHAT A NEW TABLE OR VIEW NOW NEEDS. Explicit grants in the migration that
-- creates it, and for a table ENABLE ROW LEVEL SECURITY:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.x TO authenticated;
--   GRANT SELECT ON public.x_view TO anon, authenticated;
--   (a serial/bigserial column also needs GRANT USAGE on its sequence)
-- scripts/check-migration-relation-grants.mjs fails CI on any CREATE TABLE /
-- CREATE VIEW newer than this migration without them. The default entries
-- staying gone is checked on the replayed schema (db-smoke) and live
-- (scripts/check-live-privileges.mjs, after every deploy and nightly), both
-- reading scripts/ci/client-default-privileges.sql.
--
-- REPLAY-SAFETY. REVOKE on a default-privilege entry that does not exist is a
-- no-op, so this is safe three times over and on a database without the entry.
-- REVOKE ALL names no version-specific privilege keyword, so the PG15 replay
-- image parses it (MAINTAIN is PG17-only).

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
