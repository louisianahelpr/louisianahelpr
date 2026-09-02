-- The map and /jobs showed you your own posts. Now they do not.
--
-- WHY
-- The dashboard browse list has always excluded the viewer's own jobs
-- (useDashboardFilters.ts:211, useDashboardData.ts:459). The map and the /jobs
-- feed never did. So a poster browsing either one saw their own listing, with
-- an apply affordance, and got "You can't apply to your own post." when they
-- tapped it -- an error raised for a state that should not have been reachable.
--
-- BrowseMap.tsx documented the workaround in a comment rather than fixing it:
--   "The RPC doesn't expose customer_id (PII concern), so we can't filter
--    'my own posts' client-side -- that's fine since handleApplyRequest
--    already bails out with a 'you can't apply to your own post' toast."
--
-- It is not fine: the filter simply belonged on the server. A WHERE clause can
-- read customer_id without the function returning it, so the PII argument was
-- never a reason to leave the row visible.
--
-- ALSO REMOVED: the early-access arm `OR j.customer_id = auth.uid()` in both
-- functions. It existed so a poster could see their own job immediately,
-- skipping the Early Access delay -- their confirmation the post went live.
-- With own jobs excluded outright that arm can never be true, and the owner's
-- decision is that posters confirm in My Posts / Activity instead. Leaving a
-- dead arm behind is how the next reader concludes the surface still supports
-- something it does not.
--
-- NOT CHANGED: get_public_open_jobs (the anon landing teaser). A logged-out
-- visitor has no own jobs, and a poster seeing their listing on the marketing
-- page is not the same defect. Deliberate scope, per the owner.
--
-- REPLAY-SAFE: CREATE OR REPLACE, no dependency on rows or prior state.
-- SECURITY DEFINER and `SET search_path` are carried verbatim from the
-- 20260902161042 definitions, not restated from memory.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  -- Evaluated once per call, not once per row: neither value depends on j.
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden
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
    -- Poster's membership row. LEFT so a job whose poster has no profile row
    -- still ranks (it simply earns no placement points).
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      -- Ownership. A job whose poster deleted their account keeps `status =
      -- 'open'` and its funded escrow, but nobody remains to answer a question,
      -- accept an application or release the money — so it must not be offered
      -- as work. Mirrors open_jobs_browse (20260902152714).
      AND j.customer_id IS NOT NULL
    -- NEW: never show a person their OWN post on a surface whose purpose is
    -- finding work to take. The dashboard list has always filtered these
    -- client-side; the map and /jobs never did, so a poster saw their own
    -- listing with an apply affordance and got "You can't apply to your own
    -- post." on tap. BrowseMap.tsx even documented the workaround: the RPC
    -- deliberately withholds customer_id (PII), so the client could not
    -- filter and leaned on the error toast instead. Filtering HERE needs no
    -- new column exposed — the predicate reads customer_id without
    -- returning it.
    -- auth.uid() IS NULL for a guest, and `x <> NULL` is NULL, not TRUE —
    -- without the null arm every row would drop for logged-out visitors.
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Fixture rows. The SERVER decides. `p_include_seed` may only NARROW —
      -- a caller can still ask not to be sent fixtures, and can no longer ask
      -- to be sent them once the operator flag is on.
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      -- Early Access (20260901022522). auth.uid() IS NULL for a guest, which
      -- lands on the free 20-minute delay — the free experience, by design.
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden
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
  CROSS JOIN cutoff
  WHERE j.status = 'open'
    -- Ownership. Redundant today only because anonymisation also nulls the
    -- coordinates the filter below requires; stated explicitly so the map does
    -- not depend on that coincidence. See the header.
    AND j.customer_id IS NOT NULL
    -- NEW: never show a person their OWN post on a surface whose purpose is
    -- finding work to take. The dashboard list has always filtered these
    -- client-side; the map and /jobs never did, so a poster saw their own
    -- listing with an apply affordance and got "You can't apply to your own
    -- post." on tap. BrowseMap.tsx even documented the workaround: the RPC
    -- deliberately withholds customer_id (PII), so the client could not
    -- filter and leaned on the error toast instead. Filtering HERE needs no
    -- new column exposed — the predicate reads customer_id without
    -- returning it.
    -- auth.uid() IS NULL for a guest, and `x <> NULL` is NULL, not TRUE —
    -- without the null arm every row would drop for logged-out visitors.
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
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
    -- The paid perk, on the shared authority.
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    -- Fixture rows, on the shared authority. The map could not exclude them
    -- at all before today — the RPC takes no arguments.
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;
