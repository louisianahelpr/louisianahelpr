-- get_open_jobs_for_map: return the same "what/where/when" a browse card shows.
--
-- WHY. The map pin popup and the browse JobCard describe the same job, but the
-- popup could only render four things — title, category label, parish, gross
-- budget — because the RPC returned nine columns and none of them carried a
-- city, a date, a start time, or the urgent bonus. Tapping a pin therefore told
-- a helper strictly less than scrolling the list did, and the two surfaces read
-- as different products. This adds the missing card fields so one component can
-- render both.
--
-- PRIVACY: NOTHING NEW IS EXPOSED.
-- Every column added here is ALREADY served to `anon` by
-- `get_ranked_open_jobs` on the public /jobs board:
--   * `location` goes through `public.mask_job_location()`, the same masker the
--     public board and `get_public_open_jobs` use — it returns "City, State"
--     only, never the street line or ZIP.
--   * `date_needed`, `start_time`, `urgent_fee`, `is_group_job` and
--     `helpers_needed` are plain listing facts a helper must know before
--     applying; the public board prints all five today.
-- The ~110m coordinate coarsening (ROUND(lat/lng, 2)) is untouched, and
-- `customer_id` is still deliberately withheld — poster identity remains off
-- the map, so poster rating / ID-verified stay off the popup too.
--
-- WHY DROP + CREATE RATHER THAN CREATE OR REPLACE.
-- Adding columns to a RETURNS TABLE changes the function's result type, and
-- Postgres rejects that under CREATE OR REPLACE ("cannot change return type of
-- existing function"). Safe here for the same reason it was safe in
-- 20260725234500_ranked_open_jobs_return_recurrence_interval.sql: DDL is
-- transactional and a migration runs in one transaction, so the DROP, the
-- CREATE and the GRANTs commit atomically — a concurrent caller sees either the
-- old definition or the new one, never a missing function.
--
-- The one real hazard of a drop is losing privileges, which do NOT survive it.
-- Privileges captured from prod before writing this (pg_proc.proacl):
--     {postgres=X/postgres, service_role=X/postgres,
--      anon=X/postgres, authenticated=X/postgres}
-- i.e. no PUBLIC default (an earlier migration revoked it) and EXECUTE for
-- anon / authenticated / service_role. `anon` is the load-bearing one — without
-- it the signed-out guest map 500s. The REVOKE + GRANT below reproduce that ACL
-- exactly and are mandatory, not defensive.
--
-- Everything else — the early-access `delay` CTE, the coordinate rounding, every
-- WHERE clause, the ORDER BY and the LIMIT — is carried over verbatim from
-- 20260820001000_map_rpc_server_side_early_access.sql. Only the six columns are
-- new.
--
-- Replay-safe: DROP ... IF EXISTS, so a from-scratch rebuild and an incremental
-- deploy land on the same definition.
--
-- Client note: `MapJob` declares the new fields OPTIONAL and the popup renders
-- each row conditionally, so in the window between merge and `db-deploy`
-- finishing, the popup degrades to its previous shape rather than printing
-- blank or `undefined` rows.

DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();

CREATE FUNCTION public.get_open_jobs_for_map()
RETURNS TABLE (
  id uuid,
  title text,
  category text,
  budget numeric,
  is_urgent boolean,
  latitude numeric,
  longitude numeric,
  parish text,
  created_at timestamptz,
  -- New: the browse-card fields.
  location text,
  date_needed date,
  start_time time without time zone,
  urgent_fee numeric,
  is_group_job boolean,
  helpers_needed integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH viewer AS (
    SELECT
      CASE
        WHEN p.subscription_expires_at IS NULL OR p.subscription_expires_at <= now()
          THEN NULL
        ELSE p.subscription_tier
      END AS tier
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ),
  delay AS (
    -- Mirror of earlyAccessDelayMs(): (20 - earned) minutes.
    SELECT make_interval(mins => 20 - COALESCE((
      SELECT CASE
        WHEN tier IN ('elite', 'business') THEN 20
        WHEN tier = 'pro' THEN 10
        WHEN tier = 'basic' THEN 5
        ELSE 0
      END FROM viewer
    ), 0)) AS d
  )
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
    j.created_at,
    -- City, State only — same masker the public /jobs board uses. The popup
    -- prints the city and falls back to the parish when this is empty.
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed
  FROM public.jobs j
  CROSS JOIN delay
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
    -- The paid perk, enforced here rather than trusted to the client.
    AND j.created_at <= now() - delay.d
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$$;

-- Mandatory: privileges do NOT survive DROP FUNCTION. `anon` is what the
-- signed-out guest map authenticates as.
REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map()
  TO anon, authenticated, service_role;
