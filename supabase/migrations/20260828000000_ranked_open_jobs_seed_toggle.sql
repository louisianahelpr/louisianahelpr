-- get_ranked_open_jobs: let the public feed exclude fixture rows.
--
-- WHY: production is mostly test data — of 13 open jobs, 12 are fixtures and
-- ONE is real (measured 2026-08-25). Guests browsing /jobs are therefore
-- reading almost entirely fake listings, and anyone who applies to one hits a
-- dead end.
--
-- The owner's call is to KEEP them visible for now ("should we keep them now
-- for testing purposes?" — yes, while testing): hiding them today would leave
-- the public marketplace showing a single job and would make most guest flows
-- untestable.
--
-- So this migration does NOT change what anyone sees. It exists so that the
-- launch decision is a one-line flip of SHOW_SEED_JOBS_PUBLICLY in
-- src/config/showSeedJobs.ts instead of a schema change under time pressure.
-- The parameter DEFAULTS to true, so every existing caller — including any
-- that still calls the two-argument form — behaves exactly as before.
--
-- Deliberately NOT a client-side filter: the RPC paginates (p_limit/p_offset),
-- so dropping rows after the fetch would return short, uneven pages and break
-- the infinite feed's "did I get a full page?" check. The filter belongs where
-- the pagination happens.
--
-- Admin aggregates are untouched by this flag on purpose — they exclude
-- is_seed unconditionally (20260825184500), because a money figure that counts
-- fixtures is wrong at every stage, testing included.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_include_seed boolean DEFAULT true
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
  rank_score numeric, pricing_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      )::numeric AS rank_score
    FROM public.jobs j
    WHERE j.status = 'open'
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Hide abandoned-payment jobs — mirrors useDashboardData.
      AND j.payment_status IS DISTINCT FROM 'abandoned'
      -- Fixture rows, gated by the caller. Default true = unchanged behaviour.
      AND (p_include_seed OR NOT j.is_seed)
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- Same grants the function already carried (guests read this feed).
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean) TO anon, authenticated;

-- Drop the old 2-argument overload.
--
-- Adding a DEFAULTed parameter does not replace a function, it OVERLOADS it:
-- without this, prod would carry BOTH get_ranked_open_jobs(int,int) and
-- (int,int,boolean). Postgres would resolve a 2-argument call to the old body,
-- so every future edit to the ranking would have to be written twice or the
-- two would silently diverge — with guests served by whichever one their
-- client happened to call.
--
-- Dropping it is safe: the new function's defaults make it callable with two
-- arguments, and PostgREST resolves a 2-argument request to it by filling
-- p_include_seed from the default. Guarded so a from-scratch replay (where the
-- 2-arg form may already be gone) doesn't abort the rebuild.
DROP FUNCTION IF EXISTS public.get_ranked_open_jobs(integer, integer);
