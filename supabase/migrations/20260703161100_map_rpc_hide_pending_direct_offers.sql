-- F-DISC-02: get_open_jobs_for_map() leaked jobs with a PENDING direct offer
-- onto the public anonymous map. A targeted offer is private to its helper
-- until it resolves — get_public_open_jobs (20260426095550) already applies
-- `offered_to_helper_id IS NULL OR direct_offer_status <> 'pending'`, but the
-- map RPC was missing the same visibility rule. Re-state the function with
-- the canonical filter added; everything else is unchanged from 20260608120000.

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
RETURNS TABLE (
  id uuid,
  title text,
  category text,
  budget numeric,
  is_urgent boolean,
  latitude numeric,
  longitude numeric,
  parish text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ≈ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep, and can't be
    -- reverse-engineered to the source coords.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at
  FROM public.jobs j
  WHERE j.status = 'open'
    AND j.payment_status IS DISTINCT FROM 'abandoned'
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
