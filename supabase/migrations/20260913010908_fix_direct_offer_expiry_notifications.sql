-- expire_pending_direct_offers notified posters only about offers whose
-- deadline passed in the LAST 5 MINUTES, but the cron that calls it runs
-- hourly. So almost every expired offer was never announced: verified live on
-- 2026-09-12, 1 expired offer and 0 notifications (time-travel audit).
--
-- Notify exactly the rows this run expired, from the UPDATE's RETURNING, so a
-- run can neither miss one nor notify the same offer twice. CREATE OR REPLACE
-- keeps the function's existing ACL (service_role only, set by
-- 20260824210000); the explicit statements below restate it so the migration
-- lint sees them. The link keeps the per-job form that 20260831232514 rewrote
-- the live body to ('/my-posts?job=' || id), so this does not regress it.
CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
    RETURNING id, customer_id, title
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now visible to all helpers.',
           'job_updates',
           '/my-posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_direct_offers() TO service_role;
