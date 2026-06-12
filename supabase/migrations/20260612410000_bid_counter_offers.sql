-- Counter-offer columns on applications for bid-mode negotiation.
-- negotiation_status tracks the current state of price negotiation:
--   open          — no counter yet (initial state)
--   countered     — poster sent a counter price, waiting for helper response
--   counter_accepted — helper accepted the counter
--   counter_declined — helper declined the counter

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS counter_price numeric CHECK (counter_price IS NULL OR counter_price > 0),
  ADD COLUMN IF NOT EXISTS negotiation_status text NOT NULL DEFAULT 'open'
    CHECK (negotiation_status IN ('open', 'countered', 'counter_accepted', 'counter_declined'));

-- Poster sends a counter price
CREATE OR REPLACE FUNCTION counter_application_bid(
  p_application_id uuid,
  p_counter_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id uuid;
  v_helper_id uuid;
  v_pricing_mode text;
BEGIN
  -- Validate: caller is the poster of the job this application is for
  SELECT a.job_id, a.helper_id, j.pricing_mode
  INTO v_job_id, v_helper_id, v_pricing_mode
  FROM applications a
  JOIN jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
    AND j.customer_id = auth.uid()
    AND a.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or you are not the poster';
  END IF;
  IF v_pricing_mode != 'accept_bids' THEN
    RAISE EXCEPTION 'Counter-offers only available on bid-mode jobs';
  END IF;
  IF p_counter_price <= 0 THEN
    RAISE EXCEPTION 'Counter price must be positive';
  END IF;

  UPDATE applications
  SET counter_price = p_counter_price,
      negotiation_status = 'countered'
  WHERE id = p_application_id;
END;
$$;
GRANT EXECUTE ON FUNCTION counter_application_bid(uuid, numeric) TO authenticated;

-- Helper responds to a counter offer
CREATE OR REPLACE FUNCTION respond_to_counter_offer(
  p_application_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id uuid;
  v_counter_price numeric;
BEGIN
  SELECT a.job_id, a.counter_price
  INTO v_job_id, v_counter_price
  FROM applications a
  WHERE a.id = p_application_id
    AND a.helper_id = auth.uid()
    AND a.negotiation_status = 'countered';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Counter offer not found or not in countered state';
  END IF;

  UPDATE applications
  SET negotiation_status = CASE WHEN p_accept THEN 'counter_accepted' ELSE 'counter_declined' END
  WHERE id = p_application_id;

  -- If accepted, update the job budget to the counter price
  IF p_accept THEN
    UPDATE jobs SET budget = v_counter_price WHERE id = v_job_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION respond_to_counter_offer(uuid, boolean) TO authenticated;
