-- apply_to_job: make the rate limit and the job-status check race-safe.
--
-- Two concurrency defects in the previous definition (verified against the live
-- prod function on 2026-08-04 — body otherwise carried over verbatim):
--
--   1. The 10/min · 50/hr · 200/day limits were three unlocked `SELECT COUNT(*)`
--      reads under READ COMMITTED. N concurrent apply_to_job calls all observe
--      the same pre-insert count, so they ALL pass the check and the limit is
--      overshot by the width of the burst — which is exactly the scenario the
--      limit exists to stop (scripted spam applying to every open job). The
--      client-side limiter in src/lib/applyRateLimit.ts fails open on
--      PGRST202/network, so this RPC is the only real enforcement point.
--
--      Fixed with a per-user advisory lock taken for the duration of the
--      transaction. Concurrent applications BY THE SAME HELPER serialize here,
--      so each one counts the rows its predecessors already inserted. Different
--      helpers hash to different lock keys and never contend, so this adds no
--      cross-user serialization.
--
--   2. `SELECT pricing_mode, status FROM jobs` took no row share-lock, so an
--      application could be inserted for a job that accept_application was
--      closing in the same instant — producing an application against a job
--      that is already accepted. `FOR SHARE` blocks only against a concurrent
--      `FOR UPDATE` holder (accept_application takes exactly that), so the
--      application either lands before the accept or correctly sees 'accepted'.
--
-- Everything else — ownership check, duplicate guard, bid-price requirement,
-- the INSERT — is unchanged.
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text, p_proposed_price numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app_id uuid;
  v_mode text;
  v_existing int;
  v_status text;
  v_count_1m int;
  v_count_1h int;
  v_count_1d int;
BEGIN
  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  SELECT COUNT(*) INTO v_count_1m FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
  IF v_count_1m >= 10 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
  END IF;

  SELECT COUNT(*) INTO v_count_1h FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
  IF v_count_1h >= 50 THEN
    RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
  END IF;

  SELECT COUNT(*) INTO v_count_1d FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
  IF v_count_1d >= 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT pricing_mode, status INTO v_mode, v_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;
  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;
  IF v_mode = 'accept_bids' AND p_proposed_price IS NULL THEN
    RAISE EXCEPTION 'A price is required for bid-mode jobs';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, proposed_price, status)
  VALUES (p_job_id, auth.uid(), p_message, p_proposed_price, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;
