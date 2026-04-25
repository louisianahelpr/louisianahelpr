CREATE OR REPLACE FUNCTION public.enforce_business_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_count integer;
BEGIN
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO member_count
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('active', 'pending');

  IF member_count >= 2 THEN
    RAISE EXCEPTION 'This business has reached its seat limit. Upgrade to add more members.';
  END IF;
  RETURN NEW;
END;
$$;