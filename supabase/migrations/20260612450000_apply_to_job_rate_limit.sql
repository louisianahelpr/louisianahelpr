-- Add rate limiting to apply_to_job: 10/min, 50/hr, 200/day per user.
-- The covering index idx_applications_helper_created (helper_id, created_at DESC)
-- already exists (20260519000000_hot_path_indexes_pass2.sql) so we skip it here.
-- CREATE INDEX IF NOT EXISTS is safe to re-declare defensively if ever needed.

CREATE OR REPLACE FUNCTION apply_to_job(
  p_job_id uuid,
  p_message text,
  p_proposed_price numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_app_id uuid;
  v_mode text;
  v_existing int;
  v_status text;
  v_count_1m int;
  v_count_1h int;
  v_count_1d int;
BEGIN
  -- Rate limiting: 10/min, 50/hr, 200/day
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

  -- Validate job is open and get pricing mode
  SELECT pricing_mode, status INTO v_mode, v_status
  FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;
  -- Don't allow applying to your own job
  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  -- Prevent duplicate application
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;
  -- Price required when mode = 'accept_bids'
  IF v_mode = 'accept_bids' AND p_proposed_price IS NULL THEN
    RAISE EXCEPTION 'A price is required for bid-mode jobs';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, proposed_price, status)
  VALUES (p_job_id, auth.uid(), p_message, p_proposed_price, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$$;
-- Re-grant after CREATE OR REPLACE (replaces permissions on the function).
GRANT EXECUTE ON FUNCTION apply_to_job(uuid, text, numeric) TO authenticated;
