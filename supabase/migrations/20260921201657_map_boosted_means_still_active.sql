-- "Boosted" means the boost is STILL ACTIVE. Correcting my own fix.
--
-- 20260921173413 taught the map to honour the Boosted filter and projected
-- `boosted_at` to do it. That is the wrong column, and it re-created the very
-- class that migration was written to close.
--
-- Every other surface in the app defines boosted the same way:
--
--   useDashboardData.ts:447   !!j.boost_expires_at && new Date(j.boost_expires_at) > now
--   DashboardGuest.tsx:248    (identical)
--   JobDetail.tsx:72          (identical)
--   useDashboardJobsCount.ts  query.gt("boost_expires_at", now)
--
-- `boosted_at` is "ever boosted". So with the filter on, the map would have
-- shown every job that was EVER boosted — including boosts that expired weeks
-- ago — while the list and the header count showed only the live ones. A new
-- divergence, subtler than the one it replaced, in the exact place the owner
-- has now reported three times.
--
-- Caught before it could show: `jobs` currently holds 0 ever-boosted and 0
-- currently-boosted open rows (measured on prod, 2026-09-21), so no user ever
-- saw it. It would have appeared the first time a boost lapsed.
--
-- `boosted_at` is deliberately NOT also projected. Returning both invites the
-- next person to pick the one that reads more naturally, which is what
-- happened here. The ORDER BY still uses it — ordering by when a boost STARTED
-- is correct and unrelated to whether it is still running.
--
-- Everything else is byte-for-byte 20260921173413. DROP + CREATE again because
-- a RETURNS TABLE cannot be replaced in place, and the REVOKE/GRANT pair is
-- load-bearing because a DROP discards grants.

DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();

CREATE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ~ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    -- `boost_expires_at`, NOT `boosted_at` — see the header.
    j.boost_expires_at,
    -- NEW. The WHERE clause already reads expires_at to cull expired jobs;
    -- the client needs the value itself for "Ending soon" (24h / 3d / 7d).
    j.expires_at
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE j.status = 'open'
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- Re-stated after CREATE OR REPLACE: default privileges can re-open an object
-- on replace, and this one is reachable by anon on the guest map.
REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated;
