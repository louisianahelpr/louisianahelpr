-- Coarsen the public browse-map RPC from ~110m (3 decimals) to ~1.1km
-- (2 decimals). The earlier 3-decimal rounding still pinned a job to its
-- block, which is too precise for a public, anonymous-viewable map — a
-- stranger could tell roughly which house. 2 decimals snaps the pin to a
-- ~1km neighborhood cell, so the public map shows the *general area* only.
-- The exact doorstep lives in jobs.latitude/longitude (RLS-protected) and
-- is revealed to a helper only after they're approved for the job.
--
-- CREATE OR REPLACE keeps the existing grants; re-stated below to stay
-- replay-safe on a from-scratch rebuild.

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
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
