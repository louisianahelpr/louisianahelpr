-- Re-grant EXECUTE on two client-facing RPCs that lost their `authenticated`
-- grant during an over-broad security-definer revoke earlier in the history.
-- The 2026-05-28/05-29 re-grant audits (grant_execute_client_rpcs_audit_*)
-- restored most client RPCs but missed these two. Symptom: every signed-in
-- user gets a 403 "permission denied for function", which:
--   * breaks the dashboard feed — useDashboardData's context query calls
--     get_public_platform_settings(); its failure flips the feed to the
--     "We couldn't load jobs" ErrorState even though open_jobs_browse is fine.
--   * breaks the Saved Helprs tab — get_my_saved_helpers() 403s into its
--     own error state.
-- These functions were always intended to be authenticated-callable (see
-- 20260419032529 and 20260423025644, which granted them on creation).
--
-- Guarded with to_regprocedure so a from-scratch replay (where the function
-- may not exist yet at this point) doesn't abort the rebuild.
DO $$
BEGIN
  IF to_regprocedure('public.get_public_platform_settings()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.get_my_saved_helpers()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated;
  END IF;
END $$;
