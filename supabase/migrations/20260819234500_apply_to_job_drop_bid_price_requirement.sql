-- apply_to_job: remove the bid-price requirement, and retire the last
-- `accept_bids` jobs.
--
-- Bidding was removed from the product (PRICING_MODE_REMOVED in
-- src/components/postjob/BudgetSection.tsx). The client no longer sends
-- `p_proposed_price` at all, and the "what's your price?" input that used to
-- collect it is gone. But the RPC still raised
--
--     'A price is required for bid-mode jobs'
--
-- whenever `jobs.pricing_mode = 'accept_bids'`. Any legacy row still in that
-- mode is therefore UN-APPLIABLE: every helper who taps Apply gets an
-- exception the client can only render as its generic "Couldn't send your
-- application through" toast, with no way to succeed on retry. A dead end, not
-- an error.
--
-- Two changes, both required:
--   1. Backfill the surviving `accept_bids` rows to `set_price` so the jobs
--      themselves become appliable (prod had 4, all seed data, 0 bids and
--      0 counter-offers against them — verified 2026-08-19).
--   2. Drop the branch from the function so a row that somehow re-acquires the
--      value (a direct write, a restored backup) can't resurrect the dead end.
--
-- `p_proposed_price` stays in the signature and still writes through to
-- applications.proposed_price. Dropping the parameter would change the
-- function's identity, breaking any in-flight client built before this deploy
-- for the length of the rollout — and the column still holds historical bids
-- that reporting reads. It is simply never supplied any more.

-- Replay-safe: `pricing_mode` ships in 20260612400000, which is earlier in
-- timestamp order, but guard anyway so a partial/rebuilt schema can't abort the
-- whole replay on this statement.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'pricing_mode'
  ) THEN
    UPDATE public.jobs SET pricing_mode = 'set_price' WHERE pricing_mode = 'accept_bids';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text, p_proposed_price numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app_id uuid;
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
  SELECT status INTO v_status
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

  INSERT INTO applications (job_id, helper_id, message, proposed_price, status)
  VALUES (p_job_id, auth.uid(), p_message, p_proposed_price, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;
