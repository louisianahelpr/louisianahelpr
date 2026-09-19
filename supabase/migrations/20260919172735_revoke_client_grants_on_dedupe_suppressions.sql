-- Take anon and authenticated off public.notification_dedupe_suppressions.
--
-- FOUND BY src/test/edge/exhaustivenessRegistry.test.ts (D4, 2026-09-19): the
-- dimension is "a table with no policy hands nothing to a client". The table
-- was created by 20260912045624 with
--
--     ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
--
-- and no CREATE POLICY at all, which is correct — only the
-- `suppress_exact_duplicate_notifications` trigger writes it, and it runs as
-- the definer. What the migration did NOT do was say anything about grants, so
-- prod's default privileges handed the table to the client roles anyway. Read
-- live off fncmgoasalhdgfwzhsqa on 2026-09-19:
--
--     relname                            rls  pol  anon_sel auth_sel auth_ins
--     notification_dedupe_suppressions   t    0    t        t        t
--
-- It was the ONLY public table in that state; every other policy-less table
-- (edge_rate_limit_log, retained_bans, dispute_settlement_claims,
-- job_arrival_confirm_nudges) already hands the client nothing.
--
-- NOT EXPLOITABLE TODAY, and that is exactly the reason to close it. RLS with
-- zero policies denies every client row, so the grant buys nobody anything
-- right now. It is the second line of defence that is missing: one future
-- `USING (true)` policy written to let an admin screen read the table, or one
-- `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` during a debug session, turns a
-- dead grant into a live read of who was sent what and when. Same shape as
-- H-004 / AUTHZ-02 (20260915055601) — an excess grant standing behind exactly
-- one load-bearing gate.
--
-- THE CLASS, not just the row. This is the default-privileges re-grant the
-- codebase has been bitten by before (docs/lessons →
-- postgres-default-privs-regrant-views): the one-off REVOKE in
-- 20260915055601 could only name tables that existed when it was written, and
-- prod re-opens anything created afterwards. What stops the NEXT one is
-- scripts/check-migration-relation-grants.mjs (every new table's migration
-- must state its grants) plus the D4 dimension in the exhaustiveness registry.
--
-- REVOKE ALL, never an enumerated privilege list: `REVOKE ... MAINTAIN` is
-- PG17-only and the PG15 db-deploy replay gate refuses it, which once made a
-- CRITICAL fix silently not deploy (src/test/migrationPrivilegeKeywords.test.ts
-- guards that keyword class).
--
-- FROM PUBLIC, anon, authenticated — all three by name. `FROM PUBLIC` alone
-- leaves a role's own explicit grant in place (docs/lessons → revoke-anon), and
-- here the roles may hold either shape, since nobody knows whether the grant
-- arrived through PUBLIC or through the role default.
--
-- service_role and the SECURITY DEFINER trigger are untouched: both run as
-- postgres and bypass grants entirely, so the dedupe suppression keeps
-- recording.
--
-- Replay-safe: guarded on the table existing, and REVOKE of a privilege that
-- is already gone is a no-op, so a third replay changes nothing.
--
-- VERIFY BY OBJECT STATE, not by this migration landing:
--   SELECT has_table_privilege('anon','public.notification_dedupe_suppressions','SELECT'),
--          has_table_privilege('authenticated','public.notification_dedupe_suppressions','SELECT'),
--          has_table_privilege('authenticated','public.notification_dedupe_suppressions','INSERT');
-- must be (false, false, false) afterwards.

DO $$
BEGIN
  IF to_regclass('public.notification_dedupe_suppressions') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM PUBLIC;
    REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM anon;
    REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM authenticated;
  END IF;
END $$;

COMMENT ON TABLE public.notification_dedupe_suppressions IS
'Service-only audit trail of notifications the dedupe trigger suppressed. RLS is on with ZERO policies by design; anon and authenticated hold no privileges (20260919172735). Only suppress_exact_duplicate_notifications writes it, as the definer.';
