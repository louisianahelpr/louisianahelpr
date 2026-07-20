-- Fix: list view and map view disagreed on which jobs are "open" for browse.
--
-- Root cause: the client-side filter in useDashboardFilters.ts (line 127)
-- correctly hides jobs whose `date_needed` has already passed — a job
-- "wanted yesterday" is stale noise in the browse feed. The map RPC
-- (`get_open_jobs_for_map`) applied every other visibility filter (status,
-- payment_status, expires_at, pending direct offer) EXCEPT the date_needed
-- one — so past-dated jobs disappeared from the list but stayed as pins
-- on the map. Users saw pin clusters on the map, toggled to list, and
-- were shown "Nothing today, neighbor" — a confusing data inconsistency
-- that reads as broken.
--
-- Fix: add `(j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)` to
-- the RPC's WHERE clause so the map filters past-dated jobs the same way
-- the list does. This is the SAME condition the existing
-- `get_ranked_open_jobs` RPC applies (migration 20260628120000, line 125)
-- so the browse surfaces are now consistent across all three sources.
--
-- Everything else is unchanged from migration 20260703161100 (F-DISC-02).
-- Replay-safe: CREATE OR REPLACE FUNCTION with the same RETURNS TABLE
-- signature — no ledger conflict on rebuild.

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
    -- Hide jobs whose needed date has already passed — matches the
    -- client-side filter in useDashboardFilters.ts and the SQL filter in
    -- get_ranked_open_jobs, so list + map + /jobs page all agree on
    -- which posts are "still open for browse."
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
