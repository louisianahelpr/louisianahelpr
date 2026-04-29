CREATE OR REPLACE FUNCTION public.get_public_avg_rating()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(AVG(rating)::numeric(3,2), 0)
  FROM public.reviews
  WHERE rating IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_avg_rating() TO anon, authenticated;