-- Q263: pin, explicitly, the EXECUTE grants three legacy functions already have
-- on prod (measured 2026-09-23 via pg_proc.proacl), so check-migration-grants
-- --all has nothing left to flag. No privilege changes:
--   is_category_taxable(job_category), can_review_job(uuid,uuid): postgres + service_role only.
--   cancellation_fee_percent(boolean,numeric): SECURITY INVOKER, pure arithmetic,
--   executable by every role today; only SQL calls it (no client rpc). Kept as-is here.
DO $$
BEGIN
  IF to_regprocedure('public.is_category_taxable(job_category)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.is_category_taxable(job_category) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.is_category_taxable(job_category) TO service_role;
  END IF;
  IF to_regprocedure('public.can_review_job(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.can_review_job(uuid,uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.can_review_job(uuid,uuid) TO service_role;
  END IF;
  IF to_regprocedure('public.cancellation_fee_percent(boolean,numeric)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.cancellation_fee_percent(boolean,numeric) TO anon, authenticated, service_role;
  END IF;
END $$;
