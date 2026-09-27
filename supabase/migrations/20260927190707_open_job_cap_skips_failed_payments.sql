-- The 5-open-job cap counts only jobs the poster can see (owner, 2026-09-27:
-- "Unpaid jobs should not show in post anywhere. Even hidden.").
--
-- My Posts and Post a Job hide every never-paid job: payment_status 'unpaid',
-- 'abandoned' or 'failed' (src/lib/neverPaidStatuses.ts). The cap skipped only
-- the first two. A card declined at Checkout leaves the job open with
-- payment_status 'failed' (stripe-webhook paymentIntentPaymentFailed), and the
-- hourly sweeper only abandons 'unpaid' rows, so each decline held a cap slot
-- forever: five declines and the poster is told "maximum of 5 open jobs" with
-- none on screen. Prod had 0 such rows when this was written (read-only SQL).
--
-- Body is the live definition (pg_get_functiondef, 2026-09-27) with 'failed'
-- added. CREATE OR REPLACE keeps the function's ACL.
CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
BEGIN
  -- Skip counting ONLY for a non-self insert (service_role recurring-series
  -- creation, or an admin/impersonation path where the caller is not the
  -- job's own customer_id). A self-insert always gets counted, no matter
  -- what status it names, because trg_jobs_insert_column_lock forces every
  -- self-inserted row to 'open' regardless — so the cap must judge the value
  -- the row will actually land as, not the value the client sent.
  IF NEW.status IS DISTINCT FROM 'open'
     AND NOT (auth.uid() IS NOT NULL AND auth.uid() = NEW.customer_id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO open_count
  FROM public.jobs
  WHERE customer_id = NEW.customer_id
    AND status = 'open'
    -- Never-paid jobs are invisible in every browse surface and in the
    -- poster's own Posts, so they must not consume a slot in the cap either.
    AND COALESCE(payment_status, '') NOT IN ('unpaid', 'abandoned', 'failed');

  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.';
  END IF;
  RETURN NEW;
END;
$function$;
