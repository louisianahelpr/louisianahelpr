-- Public RPC for the browse-map view. Returns open jobs with their
-- coordinates rounded to ~110m precision (3 decimal places) so the
-- pin shows the neighborhood, not the customer's doorstep. Without
-- this rounding, exposing exact lat/lng publicly would leak home
-- addresses.
--
-- Returns minimal data (id, title, category, budget, rounded coords) —
-- the full job detail still requires authenticated reads via the
-- normal jobs table + RLS.
--
-- SECURITY DEFINER + grant to anon: bounded query, rounded output, no
-- PII. Safe for the public hero/browse map.

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
    -- 3 decimal places ≈ 110m at Louisiana latitudes. Rounded both
    -- ways so the pin position can't be reverse-engineered to the
    -- exact source coords.
    ROUND(j.latitude, 3) AS latitude,
    ROUND(j.longitude, 3) AS longitude,
    j.parish,
    j.created_at
  FROM public.jobs j
  WHERE j.status = 'open'
    AND j.payment_status IS DISTINCT FROM 'abandoned'
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
