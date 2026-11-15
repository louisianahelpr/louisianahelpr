-- "Jobs near you" (the new member's Home) and the Browse map hide jobs across a block, in both directions.
--
-- get_ranked_open_jobs is the read behind the new member Home's "Jobs near you" (FirstJobHome useJobsNearYou) and
-- the welcome emails. It never looked at user_blocks, and it returns no poster id, so the client cannot filter: a
-- member saw open jobs from someone who blocked them, or whom they blocked. The /jobs feed itself drops blocked
-- posters on the client from open_jobs_browse's customer_id; this RPC had no such path.
--
-- Change: the newest definition (20261112202620_guests_read_masked_job_description.sql) restated verbatim, with ONE
-- added condition: NOT EXISTS a user_blocks row between the caller and the job's poster, either direction. Same
-- signature, same return columns in the same order, same grants. A guest (no session) and the service role (the
-- welcome-emails function, which filters blocks itself for the member it mails) match no row, so their results are
-- unchanged.
--
-- get_open_jobs_for_map (the Browse map's pins) had the same gap (lh-authz-rls review of this change, finding 5): its
-- rows carry no customer_id either, so BrowseMap's block cull was a documented no-op. Restated from its newest
-- definition (20261110210539_map_pins_ungeocoded_jobs.sql) verbatim with the same ONE added condition; CREATE OR
-- REPLACE (same signature and return columns), grants as before.
--
-- Proof: src/test/pglite/rankedJobsHideBlocked.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- Guard: src/test/rankedJobsHideBlocked.test.ts.
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION with the same signature; REVOKE/GRANT/COMMENT are idempotent.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text, helper_fee_flat_cents integer, helper_fee_percent numeric, date_window_end date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode, j.helper_fee_flat_cents, j.helper_fee_percent,
      j.date_window_end,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates, the identical
      -- masked pair open_jobs_browse already publishes.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED (20260901031421, 20260915051752).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            -- Q1848 (2): no poster boost while memberships are off for the poster.
            WHEN NOT public.feature_enabled_for_user('memberships', j.customer_id) THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'plus'  THEN 2.5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
      -- A series visit is re-offered only inside its series (20260927015010).
      AND j.parent_job_id IS NULL
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      -- Q2408: a window job stays listed until its window's LAST day (NULL end = one-day job, as before).
      AND (j.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now())
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Q1411: not while the poster is under an open ban settlement review.
      AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
      -- Blocks, either direction (this migration): never a job whose poster blocked the viewer or whom the viewer
      -- blocked. Read here, in the definer, because user_blocks' own policy shows a member only the rows they are
      -- part of and the feed returns no poster id the client could filter on. A guest (auth.uid() NULL) matches no
      -- row, so the guest feed is unchanged.
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
         WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = j.customer_id)
            OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))
      )
  )
  -- F268a: a caller with no session (anon over REST) gets the guest copy, as from open_jobs_browse.
  SELECT id, title, CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(description) ELSE description END AS description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term, so distance cannot be recovered
    -- by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band,
    -- Q1839: the jobs flat-fee stamp (roadmap F3), so a flat job's pay is
    -- priced 5% + 70c, never the viewer's tier.
    helper_fee_flat_cents,
    -- Q2400: and the percent stamped with it, so a job funded at 5% is never
    -- priced at the newer 10% default.
    helper_fee_percent,
    -- Q2408: the window's last day, so a card prints "Any day Nov 4-10".
    date_window_end
  FROM scored
  WHERE
    -- Radius filter. An unevaluable radius KEEPS the row.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term orders the feed and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unknown distance is NEUTRAL (the middle band), never "far".
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$
;


REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) IS
  'Public /jobs feed, ranked. The distance term is applied in ORDER BY only and '
  'is deliberately absent from the returned rank_score: every other term is '
  'derivable from fields in the same row, so returning it would hand back the '
  'exact distance by subtraction. Distance is measured against the job''s '
  '2dp-rounded coordinates — the same masked pair open_jobs_browse already '
  'publishes — so probing p_lat/p_lng for band boundaries cannot resolve a job '
  'more precisely than the app already discloses. distance_band is a band, '
  'never a number.';


-- The Browse map's pins: the newest definition (20261110210539) with the same block condition.
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
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
    -- Blocks, either direction (20261115023248): no pin for a job whose poster blocked the viewer or whom the viewer
    -- blocked. The pin row carries no customer_id, so the client cannot drop it. A guest matches no row.
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
       WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = j.customer_id)
          OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))
    )
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;


REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;
