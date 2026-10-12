-- The read-only role may run the alert close rule (open-auto-tick red, 2026-10-12).
--
-- scripts/lib/openFeeds.mjs LEDGER_SQL (2eec60461) filters informational
-- notices with public.admin_alert_close_rule(title), and open-sync-trackers
-- sends it through the Management API with read_only: true, which runs as
-- supabase_read_only_user. That role could SELECT ops_alert_ledger but had no
-- EXECUTE on the rule (prod proacl {postgres=X,service_role=X}, read live
-- 2026-10-12), so every "Auto-tick items verified live" run failed with 42501.
--
-- Both functions are LANGUAGE sql IMMUTABLE, not SECURITY DEFINER, and read no
-- table: admin_alert_close_rule maps a title to a rule name from a VALUES list
-- and calls ops_alert_normalise (string normalisation only). Granting EXECUTE
-- to the read-only role exposes no data. anon/authenticated stay revoked.
--
-- Guard: src/test/readOnlySqlCallsOnlyGrantedFunctions.test.ts.
-- Replay-safe: skipped where the role or a function does not exist (PGlite,
-- a fresh local replay before the functions' own migrations).

DO $grant$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    RETURN;
  END IF;
  IF to_regprocedure('public.ops_alert_normalise(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.ops_alert_normalise(text) TO supabase_read_only_user;
  END IF;
  IF to_regprocedure('public.admin_alert_close_rule(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO supabase_read_only_user;
  END IF;
END
$grant$;
