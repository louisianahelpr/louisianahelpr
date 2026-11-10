-- The map never drops a job whose address did not geocode (owner bug, 2026-11-10).
--
-- What happened: "Hang Christmas lights outside" (9816 Lake Peigneur Rd, New Iberia 70560) was posted with
-- latitude/longitude NULL. The post flow writes the job, then asks the free geocoder (Nominatim) for the street
-- address; that rural address found no match, so nothing was written back. get_open_jobs_for_map required
-- `latitude IS NOT NULL`, so the job was missing from the map while get_ranked_open_jobs (no such filter) listed it:
-- the owner saw 3 of her 4 jobs. The lead set that one job's pin by hand.
--
-- Why at read time and not by writing a centroid into jobs.latitude/longitude: those columns mean "the job's
-- address", and the Helpr's arrival check (mark_helper_arrival, 20261103043002) measures the Helpr's GPS against
-- them, verifying outright when they are NULL ("the job itself never geocoded"). A ZIP centroid stored there would
-- sit miles from a rural house (median 2.3 km, up to ~33 km, 20260907051306), turning every such arrival into
-- "too far". So the job keeps NULL, and the map joins the ZIP centroid (else the parish's) when it reads, exactly as
-- 20260907051306 designed centroids to be used ("centroids live HERE and are joined at read time").
--
-- RESTATED FROM THE NEWEST CREATE, checked by name: get_open_jobs_for_map() from 20261104080753, verbatim except the
-- area join, the two coordinate columns and the coordinate filter. Same signature, grants as before.
-- The browse list's own radius filter (src/hooks/useDashboardFilters.ts) does the same with the parish centroid.
-- Proof: src/test/pglite/mapPinsUngeocodedJobs.pglite.mjs (3x). Guard: src/test/mapPinsUngeocodedJobs.test.ts.

DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();
CREATE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone, helper_fee_flat_cents integer, helper_fee_percent numeric, date_window_end date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
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
    -- Owner bug 2026-11-10: a job whose address never geocoded is pinned at its ZIP's centroid, else its parish's
    -- (area.*), never dropped. jobs.latitude/longitude stay NULL: they mean "the address", and the arrival check
    -- trusts them.
    ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.latitude ELSE area.latitude END, 2) AS latitude,
    ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.longitude ELSE area.longitude END, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    j.boost_expires_at,
    j.expires_at,
    -- Q1839: the jobs flat-fee stamp (roadmap F3); the pin popup's JobCard
    -- prices a flat job 5% + 70c from it, never the viewer's tier.
    j.helper_fee_flat_cents,
    -- Q2400: and the percent stamped with it (a 5% job is never priced at 10%).
    j.helper_fee_percent,
    -- Q2408: the window's last day, so the pin popup prints "Any day Nov 4-10".
    j.date_window_end
  FROM public.jobs j
  CROSS JOIN cutoff
  -- Only for a job with no coordinate pair: its ZIP's centroid (louisiana_zip_parishes, 20260907051306), else the
  -- middle of its parish's ZIP centroids.
  LEFT JOIN LATERAL (
    SELECT COALESCE(zc.latitude, pc.latitude) AS latitude, COALESCE(zc.longitude, pc.longitude) AS longitude
      FROM (SELECT z.latitude, z.longitude FROM public.louisiana_zip_parishes z
             WHERE z.zip_code = left(regexp_replace(j.zip_code, '\D', '', 'g'), 5)
               AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL
             LIMIT 1) zc
      FULL JOIN (SELECT avg(z.latitude) AS latitude, avg(z.longitude) AS longitude FROM public.louisiana_zip_parishes z
                  WHERE lower(z.parish) = lower(btrim(regexp_replace(j.parish, '\s+Parish\s*$', '', 'i')))
                    AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL) pc ON true
     WHERE j.latitude IS NULL OR j.longitude IS NULL
  ) area ON true
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND ((j.latitude IS NOT NULL AND j.longitude IS NOT NULL) OR (area.latitude IS NOT NULL AND area.longitude IS NOT NULL))
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Q2408: a window job stays on the map until its window's LAST day (NULL end = one-day job, as before).
    AND (j.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now())
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;


REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;
