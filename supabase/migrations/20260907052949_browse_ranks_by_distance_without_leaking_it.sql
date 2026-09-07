-- Browse finally ranks by distance — and the ranking cannot be used to find
-- the job.
--
-- `get_ranked_open_jobs` powers `/jobs` and its rank_score has never had a
-- distance term: boost 1000 + parish 500 + urgent 100 + recency 0-50 + poster
-- tier 0-5, and no coordinate anywhere in the function. `/jobs` therefore hid
-- its radius control entirely (`showNearby` in FilterSheet.tsx) rather than
-- ship a chip that provably could not change the results — an honest choice,
-- and this migration is what lets it be reversed.
--
-- (For the record, because a report went out saying otherwise: the SIGNED-IN
-- dashboard's radius filter has always worked. It reads the `open_jobs_browse`
-- view, which projects `round(latitude, 2)`, and measures a real haversine in
-- `useDashboardFilters.ts`. Only `/jobs` was distance-blind.)
--
-- ---------------------------------------------------------------------------
-- THE PART THAT IS NOT OBVIOUS: a ranking is an oracle
-- ---------------------------------------------------------------------------
-- The naive implementation adds a smooth distance decay to `rank_score` and
-- returns it. That leaks the job's exact position two different ways, and
-- BOTH have to be closed, because each defeats the other's fix:
--
--   INVERSION. `rank_score` is returned to the client, which also receives
--   `parish_match`, `is_urgent`, `boosted_at` and `created_at` — every other
--   term. Subtract them and the distance term falls out. A continuous term
--   yields the true distance at full precision, undoing the 2dp mask the app
--   applies everywhere else.
--
--     Closed by: the distance term is added in ORDER BY only. The returned
--     `rank_score` does NOT include it. This is free — no client reads
--     rank_score (verified: `useOpenJobsFeed.ts` relies purely on the server's
--     order and dedupes by id; the only other references are comments in
--     smartSort.ts and utils.ts). So the ordering can use information the
--     payload never carries.
--
--   BOUNDARY SWEEPING. The caller supplies `p_lat`/`p_lng`. Even a STEPPED
--   term can be probed: vary the claimed position and watch a job jump bands.
--   The set of points where a job sits exactly on the 5-mile boundary is a
--   circle centred on that job, so sweeping recovers its position to
--   arbitrary precision — worse than the 2dp mask, and these are home
--   addresses.
--
--     Closed by: the distance is measured against the job's coordinates
--     ROUNDED TO 2dp — byte-for-byte the same masked pair `open_jobs_browse`
--     already publishes to any signed-in user. Sweeping can therefore never
--     resolve anything finer than what the app already gives away. The bound
--     is structural: it is not that the attack is hard, it is that success
--     yields nothing new.
--
-- Either fix alone would be insufficient. Inversion beats rounding (a smooth
-- term over rounded input still returns an exact rounded distance); rounding
-- beats sweeping but not inversion. Both, together.
--
-- ---------------------------------------------------------------------------
-- WEIGHTS
-- ---------------------------------------------------------------------------
--     under 5 mi   400
--     5-15 mi      250
--     15-30 mi     100
--     beyond, or no position on either side    0
--
-- Stepped, not smooth — a step function is what makes the inversion fix cheap
-- and the sweep fix sufficient. Strictly BELOW the 500-point parish term, on
-- purpose: parish match and distance are highly correlated, so a distance term
-- that outranks parish double-counts one signal and makes the order
-- unexplainable. Under 500 the ranking stays sayable in one sentence — your
-- parish first, then nearest — which is worth more than a marginally better
-- sort.
--
-- ---------------------------------------------------------------------------
-- WHERE THE VIEWER'S POSITION COMES FROM
-- ---------------------------------------------------------------------------
--   1. `p_lat`/`p_lng`      a fresh device fix, and the only option for a guest
--   2. `profiles.latitude`  the stored fix, for a signed-in viewer
--   3. (ZIP centroid)       NOT YET — `louisiana_zip_parishes` has no
--                           coordinate columns. The seam is marked below; it
--                           is one COALESCE arm when that lane lands them.
--   4. nothing              no distance term at all, rank unchanged
--
-- `p_max_miles` makes the radius a real server-side filter. Its three cases
-- mirror `useDashboardFilters.ts` deliberately, so the two browse surfaces
-- behave identically: measure when both ends have coordinates; KEEP the job
-- when the viewer has no position (a filter that cannot be evaluated must not
-- empty the feed); KEEP the job when the JOB has no geocode (a poster whose
-- geocoding failed silently losing their listing is worse than one extra card,
-- and it is invisible to them).
--
-- `distance_band` is returned so `/jobs` can finally show proximity. A band,
-- never a number, per the standing rule this repo adopted on 2026-09-06: no
-- client-visible surface returns a precise distance or a raw coordinate for
-- another PERSON. A job SITE keeps the mask it already has, and this band is
-- computed from the already-published 2dp pair, so it discloses nothing new.
--
-- Replay-safe: guarded drop, idempotent create, explicit grants. Proven by
-- applying three times consecutively under PGlite.

-- The return type gains `distance_band`, so this is DROP + CREATE.
DROP FUNCTION IF EXISTS public.get_ranked_open_jobs(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(
  p_limit        integer DEFAULT 20,
  p_offset       integer DEFAULT 0,
  p_include_seed boolean DEFAULT true,
  p_lat          numeric DEFAULT NULL,
  p_lng          numeric DEFAULT NULL,
  p_max_miles    numeric DEFAULT NULL
)
RETURNS TABLE(
  id uuid, title text, description text, category job_category, budget numeric,
  date_needed date, start_time time without time zone, location text, parish text,
  is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean,
  is_recurring boolean, recurrence_interval text, is_group_job boolean,
  helpers_needed integer, estimated_hours numeric, photos text[],
  special_requirements text, created_at timestamp with time zone,
  expires_at timestamp with time zone, boosted_at timestamp with time zone,
  boost_expires_at timestamp with time zone, parish_match boolean,
  rank_score numeric, pricing_mode text, distance_band text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.helper_preferred_parishes
        WHERE helper_id = (SELECT auth.uid())
      )
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix. `profiles.latitude` is
  -- device-only by construction — a ZIP centroid is never written there — so
  -- this is always a real position or nothing.
  --
  -- SEAM: the centroid rung goes here as a third COALESCE arm, once
  -- `louisiana_zip_parishes` has latitude/longitude:
  --   COALESCE(p_lat, pr.latitude, z.latitude)
  -- joined via `profiles.zip_code`. Deliberately absent rather than stubbed —
  -- referencing columns that do not exist yet would not deploy.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates — the identical
      -- masked pair `open_jobs_browse` already publishes. This is what makes
      -- boundary-sweeping worthless rather than merely awkward.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED — 10% / 5% of the recency span above, so
        -- it is strictly smaller than every other term here and cannot
        -- outrank boost, parish, urgency or a real age gap (20260901031421).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term. See the header: every other term
    -- is derivable from fields in this same row, so including distance here
    -- would hand back the true distance by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band
  FROM scored
  WHERE
    -- Radius filter, three cases, mirroring useDashboardFilters.ts so the two
    -- browse surfaces agree. An unevaluable radius KEEPS the row: a filter
    -- that silently empties the feed, or that hides a poster whose geocode
    -- failed, is worse than one extra card.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term is applied HERE and nowhere else. It orders the feed
  -- and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unmeasurable, NOT far. This arm covers two different situations and
       -- both want the same answer. If the VIEWER has no position, every row
       -- gets this and the ranking is simply unchanged — correct. If the JOB
       -- has no geocode, the failure is the platform's (backfill-job-geocode
       -- has not caught up, or geocoding failed), never the poster's, and
       -- scoring it 0 would tie it with genuinely-distant work and sink it to
       -- the bottom of the feed. That is the same harm the radius filter
       -- refuses to do above, applied more quietly. So unknown distance is
       -- treated as NEUTRAL — the middle band — not as evidence of far.
       -- Not gameable: geocoding is automatic at post time, not a poster
       -- choice, and this still ranks below both nearer bands.
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

COMMENT ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) IS
  'Public /jobs feed, ranked. The distance term is applied in ORDER BY only and '
  'is deliberately absent from the returned rank_score: every other term is '
  'derivable from fields in the same row, so returning it would hand back the '
  'exact distance by subtraction. Distance is measured against the job''s '
  '2dp-rounded coordinates — the same masked pair open_jobs_browse already '
  'publishes — so probing p_lat/p_lng for band boundaries cannot resolve a job '
  'more precisely than the app already discloses. distance_band is a band, '
  'never a number.';

-- Callable by guests: /jobs is the public board. Naming anon explicitly, and
-- dropping the implicit PUBLIC grant that Supabase's ALTER DEFAULT PRIVILEGES
-- leaves behind — `proacl` carried a leading `=X/postgres` (PUBLIC) alongside
-- the three role grants. Revoking PUBLIC changes no caller's access here; it
-- just stops the function reading as world-executable in an audit.
REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;
