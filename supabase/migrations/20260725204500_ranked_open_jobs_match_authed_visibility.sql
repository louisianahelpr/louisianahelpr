-- The public /jobs board showed jobs the signed-in board hides.
--
-- `get_ranked_open_jobs` powers the signed-out browse feed. Its WHERE clause
-- was only:
--
--     status = 'open' AND (date_needed IS NULL OR date_needed >= CURRENT_DATE)
--
-- while the two signed-in paths each narrow further:
--
--   * `open_jobs_browse` (the view the authed feed reads) excludes a job that
--     is currently offered to one specific helper —
--       offered_to_helper_id IS NULL
--       OR direct_offer_status IN ('declined','expired')
--       OR offered_to_helper_id = auth.uid()
--   * `useDashboardData` additionally drops `payment_status = 'abandoned'`.
--
-- So a job privately offered to a single helper, or one whose payment was
-- abandoned, was hidden from every logged-in user while still being listed —
-- and indexable — on the public board. A direct offer is a private
-- arrangement between a poster and one helper; publishing it to anonymous
-- visitors leaks the poster's intent and invites applications to a job nobody
-- can actually take.
--
-- Verified against prod before writing (2026-07-25): 0 open jobs currently
-- match either condition, so this changes no row today. It is a correctness
-- fix closing a latent divergence, not an incident response.
--
-- NOTE on the payment test: `IS DISTINCT FROM` deliberately, NOT `<>`.
-- `payment_status <> 'abandoned'` evaluates to NULL for a NULL payment_status
-- and the row is dropped — which would silently hide every job with no payment
-- row yet. (The authed path uses PostgREST `.neq()`, which has exactly that
-- NULL-dropping behaviour; matching its INTENT is right, matching its bug is
-- not.) `IS DISTINCT FROM` keeps NULLs and excludes only rows explicitly
-- marked abandoned. All 12 currently-open jobs are 'unpaid', so neither form
-- changes today's result — this only matters the first time a NULL appears.
--
-- The `offered_to_helper_id = auth.uid()` arm is kept even though this RPC is
-- called by signed-out visitors (where auth.uid() is NULL, so the arm is never
-- true). It costs nothing and keeps the predicate identical to
-- `open_jobs_browse`, so the two can't drift again if this RPC is ever called
-- from an authenticated context.
--
-- Replay-safe: CREATE OR REPLACE with an unchanged signature and return type,
-- so this applies cleanly on a from-scratch rebuild and on an incremental
-- deploy. No DROP, so dependent grants survive.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, title text, description text, category job_category, budget numeric,
  date_needed date, start_time time without time zone, location text, parish text,
  is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean,
  is_recurring boolean, is_group_job boolean, helpers_needed integer,
  estimated_hours numeric, photos text[], special_requirements text,
  created_at timestamp with time zone, expires_at timestamp with time zone,
  boosted_at timestamp with time zone, boost_expires_at timestamp with time zone,
  parish_match boolean, rank_score numeric, pricing_mode text
)
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
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.is_group_job,
      j.helpers_needed, j.estimated_hours, j.photos, j.special_requirements,
      j.created_at, j.expires_at, j.boosted_at, j.boost_expires_at,
      j.pricing_mode,
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
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, is_group_job, helpers_needed,
    estimated_hours, photos, special_requirements, created_at, expires_at,
    boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
