CREATE OR REPLACE FUNCTION public.business_seat_limit(_business_id uuid)
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
    WHEN 'enterprise' THEN 15
    ELSE 2
  END
  FROM public.businesses b
  WHERE b.id = _business_id
$$;