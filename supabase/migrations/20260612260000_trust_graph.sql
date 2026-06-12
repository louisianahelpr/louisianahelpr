-- Neighborhood trust: how many distinct customers near a given address
-- completed jobs with a given helper. Used by the client to surface
-- "N neighbors hired them" trust signals in the applicant panel.
--
-- Pure SQL Haversine (no PostGIS needed). Stable + SECURITY DEFINER so
-- it runs as the owner and the caller never needs direct table access.

-- Ensure profiles has lat/lng columns before the function body references them.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

CREATE OR REPLACE FUNCTION get_neighbor_hire_count(
  p_helper_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_radius_km numeric DEFAULT 1.0
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT j.customer_id)::integer
  FROM jobs j
  JOIN profiles p ON p.id = j.customer_id
  WHERE j.helper_id = p_helper_id
    AND j.status = 'completed'
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND (
      -- Haversine distance approximation (fast, no PostGIS needed)
      6371 * 2 * ASIN(SQRT(
        POWER(SIN((RADIANS(p.latitude) - RADIANS(p_lat)) / 2), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(p.latitude)) *
        POWER(SIN((RADIANS(p.longitude) - RADIANS(p_lng)) / 2), 2)
      )) <= p_radius_km
    );
$$;

GRANT EXECUTE ON FUNCTION get_neighbor_hire_count TO authenticated;
