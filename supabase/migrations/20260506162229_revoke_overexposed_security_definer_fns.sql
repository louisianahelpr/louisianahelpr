-- Three SECURITY DEFINER functions added today were callable via
-- PostgREST RPC by anon + authenticated roles, even though all three
-- are only ever meant to be invoked by triggers (set_broadcast_*,
-- auto_escalate_*) or by service_role / cron (fan_out_broadcast_*).
-- Flagged by the Supabase database linter (anon_security_definer_*,
-- authenticated_security_definer_*).
--
-- Tighten so only triggers + service_role can reach them. The
-- AdminBroadcasts UI no longer calls fan_out_broadcast_to_notifications
-- directly (the new flow goes through the BEFORE INSERT trigger plus
-- the pg_cron sweeper) — confirmed via grep across src/ and
-- supabase/functions/.

-- Replay-safety guard. This migration's timestamp (16:22:29) sorts
-- BEFORE the migrations that create auto_escalate_reports() (17:53:24,
-- 21:00:00) and set_broadcast_pending_fan_out() (18:00:00), so a
-- from-scratch rebuild used to abort here with "function does not
-- exist". Each REVOKE is now guarded on the function actually existing
-- yet; the companion migration 20260518150000_reapply_security_definer_
-- revokes.sql re-applies all three AFTER every CREATE has run, so the
-- final permission state is identical on every apply path.
DO $$
BEGIN
  IF to_regprocedure('public.auto_escalate_reports()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.auto_escalate_reports() FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.set_broadcast_pending_fan_out()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_broadcast_pending_fan_out() FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.fan_out_broadcast_to_notifications(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;
