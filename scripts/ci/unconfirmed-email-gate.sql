-- Class check (Q838, 2026-10-03): every public table keeps an ENABLED email
-- gate. Q807 (20260927234313) attached zz_refuse_unconfirmed_email_write
-- (BEFORE INSERT OR UPDATE OR DELETE, FOR EACH STATEMENT, running
-- public.refuse_unconfirmed_email_write()) to every public table except
-- analytics_events and error_logs, which take anonymous writes by design.
-- src/test/unconfirmedEmailWritesRefused.test.ts reads the migrations, so it
-- cannot see a table made in the dashboard or inside DO/EXECUTE format(), or a
-- gate disabled outside a migration. This reads the catalog.
--
-- One row per public table (relkind r/p, exemptions aside) whose gate is
-- missing, disabled (tgenabled 'D'), replica-only ('R' never fires in normal
-- operation), runs another function, or misses one of INSERT/UPDATE/DELETE.
-- ZERO ROWS = CLEAN.
--
-- Shared by:
--   scripts/check-live-privileges.mjs   prod, after every db-deploy and nightly (db-drift-detect)
--   .github/workflows/db-smoke.yml      the replayed migration set, before a deploy
--   src/test/pglite/unconfirmedEmailGateLive.pglite.mjs   PGlite red/green proof
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
WITH gate_exempt(tbl) AS (
  VALUES ('analytics_events'), ('error_logs')
),
tables AS (
  SELECT c.oid, c.relname
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN (SELECT tbl FROM gate_exempt)
),
gates AS (
  SELECT t.tgrelid, t.tgenabled, t.tgfoid, t.tgtype
    FROM pg_trigger t
   WHERE t.tgname = 'zz_refuse_unconfirmed_email_write'
     AND NOT t.tgisinternal
)
SELECT tb.relname AS "table",
       CASE
         WHEN g.tgrelid IS NULL THEN 'no email gate trigger'
         WHEN g.tgenabled::text NOT IN ('O', 'A') THEN 'email gate trigger not enabled (tgenabled ' || g.tgenabled::text || ')'
         WHEN g.tgfoid IS DISTINCT FROM to_regprocedure('public.refuse_unconfirmed_email_write()') THEN 'email gate trigger runs another function'
         ELSE 'email gate trigger misses INSERT, UPDATE or DELETE'
       END AS what
  FROM tables tb
  LEFT JOIN gates g ON g.tgrelid = tb.oid
 WHERE g.tgrelid IS NULL
    OR g.tgenabled::text NOT IN ('O', 'A')
    OR g.tgfoid IS DISTINCT FROM to_regprocedure('public.refuse_unconfirmed_email_write()')
    OR (g.tgtype::int & 28) <> 28
ORDER BY 1
