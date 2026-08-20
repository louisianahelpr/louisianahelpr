-- get_open_jobs_for_map: enforce the early-access delay SERVER-side.
--
-- "Early access to new jobs" is a paid perk (Basic 5 min, Pro 10, Elite and
-- Business the full 20; free accounts wait 20). Until now it was enforced only
-- in the browser: the RPC returned every open job with no age predicate at all,
-- and the client dropped the young ones in `buildMapJobFilter` /
-- `useDashboardFilters`. A free-tier user could call the RPC directly, or edit
-- `earlyAccessDelayMs` in the running bundle, and get the head start they
-- didn't pay for. The list path gates the same way (a client-supplied
-- `.lte("created_at", cutoff)`), so this is the perk's real enforcement point,
-- not a second one.
--
-- The formula MUST match `src/lib/earlyAccess.ts` exactly — the client still
-- applies its own gate, and if the two disagree a job passes one and not the
-- other, which reads as pins that vanish when you toggle to list (the exact
-- class of bug migration 20260720120000 was written to fix).
--
-- `anon` keeps EXECUTE and simply resolves to the free 20-minute delay:
-- auth.uid() is NULL, the profile lookup finds nothing, and the tier is null.
-- An expired subscription resolves to free the same way, matching
-- useDashboardData's `currentSubActive` check.
--
-- Everything else is carried over verbatim from 20260720120000. Replay-safe:
-- CREATE OR REPLACE with the same RETURNS TABLE signature.

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
    j.created_at
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

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
