-- Class check: a view or materialized view in a client-exposed schema must
-- never be writable by a client role. Returns one row per (relation, role,
-- privilege) that breaks the rule; ZERO ROWS = CLEAN.
--
-- Why: public.open_jobs_browse (owner postgres, BYPASSRLS, security_invoker
-- off) carried INSERT/UPDATE/DELETE for anon and authenticated, so a PATCH or
-- DELETE on /rest/v1/open_jobs_browse with the anon key rewrote or erased a
-- funded job with jobs RLS bypassed (proven on prod 2026-09-15, rolled back).
-- A security_invoker view is still flagged: no client write through a view is
-- ever needed here, and each one is a second write door nobody reviews.
-- Default privileges re-grant writes on every DROP+CREATE, so a one-off REVOKE
-- cannot hold; this check is what does.
--
-- has_table_privilege / has_any_column_privilege cover direct grants, grants
-- to PUBLIC, inherited role membership, and column-level INSERT/UPDATE grants. MAINTAIN is PostgreSQL 17+ only (the CI replay image is 15),
-- so it is appended at runtime.
--
-- Shared by:
--   .github/workflows/db-smoke.yml       replayed schema (deploy gate)
--   scripts/check-updatable-views.mjs    live prod catalog (db-deploy after
--                                        push, db-drift-detect nightly)
--   scripts/probes/exposed-view-writes.probe.mjs  PGlite red/green proof
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
SELECT n.nspname AS schema,
       c.relname AS view,
       CASE c.relkind WHEN 'v' THEN 'view' ELSE 'matview' END AS kind,
       pg_get_userbyid(c.relowner) AS owner,
       coalesce(array_to_string(c.reloptions, ','), '') AS reloptions,
       r.role,
       p.priv
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
 CROSS JOIN unnest(
         ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']
         || CASE WHEN current_setting('server_version_num')::int >= 170000
                 THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END
       ) AS p(priv)
 WHERE c.relkind IN ('v', 'm')
   AND n.nspname IN ('public', 'graphql_public')
   AND (has_table_privilege(r.role, c.oid, p.priv)
        -- A column-level grant (GRANT UPDATE (payment_status) ON view TO anon)
        -- leaves has_table_privilege false while PostgREST still accepts a
        -- PATCH of that column.
        OR (p.priv IN ('INSERT', 'UPDATE')
            AND has_any_column_privilege(r.role, c.oid, p.priv)))
 ORDER BY 1, 2, 6, 7
