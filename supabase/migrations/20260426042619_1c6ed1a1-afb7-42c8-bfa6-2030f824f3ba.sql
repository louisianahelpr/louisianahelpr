-- 1. Add seat-tier columns to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS seat_tier text NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS seat_subscription_id text,
  ADD COLUMN IF NOT EXISTS seat_subscription_status text,
  ADD COLUMN IF NOT EXISTS seat_subscription_current_period_end timestamptz;

-- Constrain to known tiers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_seat_tier_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_seat_tier_check
      CHECK (seat_tier IN ('starter', 'crew', 'team', 'enterprise'));
  END IF;
END $$;

-- 2. Helper that returns the seat limit for a business's current tier
CREATE OR REPLACE FUNCTION public.get_business_seat_limit(_business_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE COALESCE(b.seat_tier, 'starter')
    WHEN 'starter'    THEN 2
    WHEN 'crew'       THEN 5
    WHEN 'team'       THEN 10
    WHEN 'enterprise' THEN 25
    ELSE 2
  END
  FROM public.businesses b
  WHERE b.id = _business_id
$$;

-- 3. Trigger to enforce seat cap server-side on every insert
CREATE OR REPLACE FUNCTION public.enforce_business_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used integer;
BEGIN
  SELECT public.get_business_seat_limit(NEW.business_id) INTO v_limit;

  SELECT count(*) INTO v_used
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('pending', 'active');

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Seat limit reached (%). Upgrade your team plan to add more members.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_business_seat_limit ON public.business_members;
CREATE TRIGGER trg_enforce_business_seat_limit
  BEFORE INSERT ON public.business_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_business_seat_limit();