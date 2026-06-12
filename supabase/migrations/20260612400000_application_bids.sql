-- Add proposed_price to applications for the "Accept bids" pricing mode.
-- When pricing_mode = 'accept_bids', helprs submit a proposed price alongside
-- their message. NULL means no price proposed (fixed or smart pricing mode jobs).
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS proposed_price numeric CHECK (proposed_price IS NULL OR proposed_price > 0);

-- RPC for applying to a job with an optional proposed price.
-- Validates price only when mode='accept_bids'.
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
BEGIN
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
GRANT EXECUTE ON FUNCTION apply_to_job(uuid, text, numeric) TO authenticated;
