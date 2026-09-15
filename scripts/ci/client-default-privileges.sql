-- Class check: no default privilege may hand a client role (anon,
-- authenticated, or PUBLIC) any privilege on the TABLES/VIEWS or SEQUENCES
-- that the relation-creating role makes in schema public. Returns one row per
-- offending (owner role, object type, grantee, privilege); ZERO ROWS = CLEAN.
--
-- Why: until 20260915051534 prod's pg_default_acl gave anon/authenticated
-- arwdxm on every relation postgres created in public (rwU on sequences), so a
-- new table or a DROP+CREATE of a view arrived client-writable. That is how
-- public.open_jobs_browse, an owner-run view that bypasses jobs RLS, became
-- writable with the anon key after 20260912021641 recreated it.
--
-- Judged roles: postgres (creates every relation in public: 77 tables, 2 views,
-- 6 sequences on 2026-09-15) plus ANY role that owns a relation in public
-- today. supabase_admin keeps its own client-granting entry for public (a
-- platform default postgres cannot alter), and owns nothing there; the moment
-- it does, it is judged too.
-- Functions are not judged here (see the 20260915051534 header).
--
-- Shared by:
--   .github/workflows/db-smoke.yml      replayed schema (deploy gate)
--   scripts/check-live-privileges.mjs   live prod (db-deploy after push,
--                                       db-drift-detect nightly)
--   scripts/probes/default-client-grants.probe.mjs  PGlite red/green proof
-- Keep it a single SELECT.
SELECT pg_get_userbyid(d.defaclrole) AS owner_role,
       coalesce(n.nspname, '(all schemas)') AS schema,
       CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' END AS object_type,
       CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type AS privilege
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclobjtype IN ('r', 'S')
   AND (d.defaclnamespace = 0 OR n.nspname = 'public')
   AND (pg_get_userbyid(d.defaclrole) = 'postgres'
        OR EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.relnamespace = 'public'::regnamespace
                      AND c.relowner = d.defaclrole))
   AND (a.grantee = 0
        OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
 ORDER BY 1, 2, 3, 4, 5
