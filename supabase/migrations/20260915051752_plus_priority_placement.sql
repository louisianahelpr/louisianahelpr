-- Plus gets the Priority Placement it is sold — in the browse feed's rank_score.
--
-- WHAT WAS BROKEN. `TIER_PERK_MATRIX.plus.priorityPlacement` is true (Plus is
-- "Everything in Pro"), and the client already scores it: `posterPlacementBonus`
-- in src/lib/smartSort.ts and `priorityPlacementPoints` in
-- src/lib/applicantScoring.ts both ask `hasPerk(tier, "priorityPlacement")`
-- (CC-019). The server did not. The live `get_ranked_open_jobs` — read with
-- pg_get_functiondef on prod fncmgoasalhdgfwzhsqa on 2026-09-14, and
-- byte-identical (md5 of prosrc and of the full definition) to the body in
-- 20260907194734_remove_helper_preferred_parishes, the newest migration that
-- defines it — bumped only 'elite' (5) and 'pro' (2.5). A Plus poster fell to
-- the ELSE 0 arm, so on the public /jobs board and in the RPC page order the
-- perk did nothing, and the signed-in dashboard (which re-sorts with the
-- client scorer) moved the same job a different distance than /jobs did.
--
-- THE DECISION: Plus = 2.5, the same half step as Pro — not a new value
-- between Pro and Elite. The placement ladder on every surface is "top rung
-- full, every other entitled rung half" (posterPlacementBonus, priorityPlacementPoints),
-- on a 10% / 5%-of-the-recency-span scale (20260901031421, pinned by
-- smartSort.test.ts). A 3.75 here would disagree with the client scorer that
-- re-sorts this same feed, which is the inconsistency 20260901031421 removed.
-- Changing Plus's weight is a matrix-and-ladder change on both sides, not an
-- edit to this CASE.
--
-- EXPIRY: unchanged. The first arm already zeroes any tier whose
-- subscription_expires_at has passed, and it precedes every tier arm, so a
-- lapsed Plus scores 0 like a lapsed Pro or Elite.
--
-- OTHER TIER LADDERS CHECKED LIVE (every public function whose definition
-- names 'elite' or 'pro' or subscription_tier; there are no views or
-- materialized views that do): early_access_cutoff already has Plus (15 min);
-- admin_support_queue admits Plus (20260915043200); helper_has_advanced_analytics
-- lists ('pro','plus','elite'); get_safe_profiles only folds expiry;
-- get_top_helpers_by_parish, get_helper_tiers and get_helper_analytics do not
-- rank by subscription tier; apply_job_denial_consequence is the Elite-only
-- reliability shield, not placement. Applicant ordering is client-side
-- (applicantScoring.ts) and already matrix-driven. So this is the only
-- placement ladder that needed Plus.
--
-- Guarded by src/test/perkEnforcementParity.test.ts ("Priority Placement"):
-- every numeric subscription-tier CASE ladder in the newest definition of any
-- public function must be registered to a perk, must score exactly the tiers
-- holding that perk, and — for placement — must match posterPlacementBonus.
--
-- Every other line of the function is byte-identical to the live definition.
-- REPLAY-SAFETY: CREATE OR REPLACE with an unchanged signature and return
-- type; every object it references (early_access_cutoff,
-- seed_jobs_hidden_publicly, get_user_credential_tier, miles_between,
-- mask_job_location) is defined by earlier migrations. Grants are restated
-- exactly as live: EXECUTE for anon (guest browse), authenticated, service_role.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text)
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
        -- Plus holds the perk (TIER_PERK_MATRIX.plus.priorityPlacement) and takes
        -- the same half step as Pro: top rung full, every other entitled rung
        -- half, exactly as posterPlacementBonus() does client-side
        -- (20260915051752_plus_priority_placement).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'plus'  THEN 2.5
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

REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;
