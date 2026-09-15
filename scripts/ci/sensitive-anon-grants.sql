-- Class check (the TABLE half of what client-writable-views.sql covers for
-- views). Returns one row per offending (table, role, privilege); ZERO ROWS =
-- CLEAN. Two rules, both defense-in-depth against prod's default privileges,
-- which hand `anon`/`authenticated` arwdxm on every relation postgres creates
-- in public — so a one-off REVOKE cannot hold and this catalog read is what
-- does.
--
--   WRITE rule (H-004): a HIGH-VALUE table (jobs + the sensitive allowlist
--   below) with RLS enabled, on which `anon` holds INSERT/UPDATE/DELETE
--   (directly, via PUBLIC, via role membership, or column-level) while NO
--   row-level policy grants that command to anon or to public. An anon write
--   grant that no policy backs is a hole waiting for the one future
--   GRANT/policy that arms it — exactly the open_jobs_browse and jobs shape. A
--   write whose command IS covered by an anon/public policy is not flagged: RLS
--   is doing its job there (this is why analytics_events / error_logs, which
--   take anon INSERT under a permissive policy, are clean, while public.jobs —
--   whose DELETE policy is TO authenticated only — is not).
--   Scope note: the rule is deliberately the curated high-value set, not every
--   table. Supabase's default privileges hand anon arwdxm on EVERY postgres-
--   owned public table, and most tables gate writes with TO-authenticated
--   policies, so a blanket rule would flag scores of tables that RLS already
--   holds — the same reason 20260907034811 revoked a curated list, not all 71.
--   New high-value tables join the set here as they are hardened; this is the
--   table analog of client-writable-views.sql, which can afford to scan ALL
--   views only because there are a handful of them.
--
--   READ rule (AUTHZ-02): a table on the sensitive allowlist below (admin /
--   money / trust surfaces with no signed-out read path) on which `anon` holds
--   SELECT (table or column). These are protected by their RLS policy alone;
--   the SELECT privilege is the second line of defence and there is no reason
--   for anon to keep it. The allowlist is source-derived: each table has no
--   `.from("<t>").select(...)` reachable while signed out (guest reads go
--   through open_jobs_browse and get_safe_profiles, neither listed here).
--
-- has_table_privilege / has_any_column_privilege account for grants to the role
-- directly, to PUBLIC, and by inherited membership, so checking `anon` alone
-- covers the "or PUBLIC" case. MAINTAIN is not a write door and is not checked.
--
-- Shared by:
--   scripts/check-anon-table-grants.mjs          live prod catalog (db-drift-detect)
--   scripts/probes/anon-table-grants.probe.mjs   PGlite red/green proof
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
WITH sensitive(tbl) AS (
  VALUES ('admin_audit_log'), ('fraud_flags'), ('user_bans'), ('payout_transfers'),
         ('instant_payouts'), ('reports'), ('login_history'), ('helper_verifications'),
         ('gift_cards'), ('referral_codes'), ('tips'), ('push_tokens'),
         ('error_logs'), ('analytics_events')
),
-- Every base table in a client-exposed schema, with its RLS flag.
tbls AS (
  SELECT c.oid, n.nspname AS schema, c.relname AS tbl, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r'
     AND n.nspname IN ('public', 'graphql_public')
),
-- WRITE offenders: RLS on, anon holds the command, no anon/public policy for it.
-- Scoped to the high-value set: jobs + the sensitive allowlist.
write_scope(tbl) AS (
  SELECT tbl FROM sensitive
  UNION ALL
  SELECT 'jobs'
),
write_offenders AS (
  SELECT t.schema, t.tbl AS "table", 'anon'::text AS role, p.priv, 'write:no-policy'::text AS rule
    FROM tbls t
    JOIN write_scope w ON w.tbl = t.tbl
   CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p(priv)
   WHERE t.rls
     AND (has_table_privilege('anon', t.oid, p.priv)
          OR (p.priv IN ('INSERT', 'UPDATE') AND has_any_column_privilege('anon', t.oid, p.priv)))
     AND NOT EXISTS (
           SELECT 1 FROM pg_policies pol
            WHERE pol.schemaname = t.schema
              AND pol.tablename = t.tbl
              AND pol.cmd IN (p.priv, 'ALL')
              AND ('anon' = ANY(pol.roles) OR 'public' = ANY(pol.roles))
         )
),
-- READ offenders: sensitive allowlist, anon holds SELECT (table or column).
read_offenders AS (
  SELECT t.schema, t.tbl AS "table", 'anon'::text AS role, 'SELECT'::text AS priv, 'read:sensitive'::text AS rule
    FROM tbls t
    JOIN sensitive s ON s.tbl = t.tbl
   WHERE has_table_privilege('anon', t.oid, 'SELECT')
      OR has_any_column_privilege('anon', t.oid, 'SELECT')
)
SELECT schema, "table", role, priv, rule FROM write_offenders
UNION ALL
SELECT schema, "table", role, priv, rule FROM read_offenders
ORDER BY 5, 1, 2, 4
