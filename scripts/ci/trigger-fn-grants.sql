-- Class check: no TRIGGER function in schema public may be EXECUTE-able by a
-- client role (anon or authenticated). Returns one row per offending
-- (function, grantee); ZERO ROWS = CLEAN.
--
-- Why: a function whose return type is `trigger` is only ever meant to be run
-- by the trigger machinery (as the table owner, no EXECUTE grant involved).
-- Exposed at /rest/v1/rpc/<name> it is pure attack surface with no purpose —
-- NEW/OLD/TG_OP are null on a direct call, so it does nothing useful, but the
-- reachability is real. Postgres grants EXECUTE on every new function to PUBLIC
-- by default, and the default-privilege cleanup in 20260915101101
-- (client-default-privileges.sql) covers only tables/views/sequences, not
-- functions — so eight trigger functions were anon/authenticated-executable
-- until 20260916023649 revoked them. has_function_privilege() below accounts
-- for both explicit grants and the PUBLIC default, so a re-created trigger
-- function that arrives with the default grant is caught again.
--
-- Shared by:
--   scripts/check-live-privileges.mjs   live prod (db-deploy after push,
--                                       db-drift-detect nightly)
-- Keep it a single SELECT.
SELECT p.proname AS function_name,
       g.grantee
  FROM pg_proc p
 CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated')) g(grantee)
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prorettype = 'pg_catalog.trigger'::regtype
   AND has_function_privilege(g.grantee, p.oid, 'EXECUTE')
