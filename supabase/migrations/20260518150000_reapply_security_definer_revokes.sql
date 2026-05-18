-- Companion to 20260506162229_revoke_overexposed_security_definer_fns.sql.
--
-- That migration revoked anon/authenticated access to three trigger-only
-- SECURITY DEFINER functions, but its timestamp sorts before the
-- migrations that CREATE two of them — so on a from-scratch rebuild it
-- could only ever revoke whichever functions happened to exist yet
-- (and originally aborted outright). It is now guarded to skip the
-- not-yet-created functions.
--
-- This migration re-applies all three REVOKEs once — running after
-- every CREATE in the history — so the intended permission state is
-- guaranteed on every apply path (fresh rebuild, preview branch, or an
-- incremental push to an environment where 162229 ran only partially).
-- On an environment already fully locked down this is an idempotent
-- no-op. Each REVOKE stays guarded so the migration remains replay-safe
-- if any of these functions is later dropped.

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
