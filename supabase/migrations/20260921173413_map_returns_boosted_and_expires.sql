-- The map could not evaluate three of the list's filters, so turning any of
-- them on narrowed the list and left every pin in place.
--
-- Owner, 2026-09-21: "the map still shows 6 jobs but 3 on the left ... when i
-- apply they fall off the left but not the map."
--
-- This is the THIRD report of one class. `src/pages/Dashboard.tsx` already
-- carries the note: applied jobs 2026-09-15, dismissed jobs 2026-09-19 ("map
-- shows 7 jobs. list shows 4"). Both previous rounds were VIEWER EXCLUSIONS
-- (applied / dismissed / blocked / saved-only) and both were fixed by routing
-- every surface through one `ViewerFeedExclusions` object.
--
-- This round is not an exclusion. It is the FILTER BAR. `mapFilter.ts` has a
-- function named `unsupportedMapFilters` that names them outright — "Boosted",
-- "Ending soon", "Matches my availability" — as "filters the map has no field
-- to evaluate". The map RPC returns neither `boosted_at` nor `expires_at`, so
-- two of them were genuinely un-evaluatable. (The third, availability, needs
-- only `date_needed` and `start_time`, which the RPC has always returned — it
-- was simply never wired up.)
--
-- So: return the two missing columns. `boosted_at` is already in the ORDER BY
-- of this very function; it just was not projected.
--
-- Nothing else about the function changes. Every WHERE clause below is byte
-- for byte what is deployed today (read from pg_get_functiondef on
-- fncmgoasalhdgfwzhsqa, 2026-09-21).
--
-- WHY A DROP AND NOT `CREATE OR REPLACE`. Postgres refuses to replace a
-- function whose RETURNS TABLE changes — "cannot change return type of
-- existing function" — and adding two output columns is exactly that. The
-- first cut of this migration used CREATE OR REPLACE and db-deploy's
-- replay-every-migration gate caught it before it reached prod, which is what
-- that gate is for.
--
-- The DROP is guarded so this file is replay-safe, and it names the exact
-- signature so it cannot take an overload that does not exist today.
--
-- DROPPING A FUNCTION DISCARDS ITS GRANTS. The REVOKE/GRANT pair at the
-- bottom is therefore load-bearing, not ceremony: without it the anon role
-- loses EXECUTE and the guest map stops loading entirely. (Same family as the
-- DROP+CREATE VIEW trap, which fails the other way and silently RE-OPENS
-- access.)
--
-- SECURITY: still SECURITY DEFINER with a pinned search_path, and both new
-- columns are already public on the surfaces that show them (the list renders
-- the boost badge and the "ending soon" chip from the same two values).
-- Coordinates stay masked to 2dp.

DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();

CREATE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boosted_at timestamp with time zone, expires_at timestamp with time zone)
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
    -- NEW. Already the first key of the ORDER BY below; never projected, so
    -- the client could not honour the "Boosted" filter.
    j.boosted_at,
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
