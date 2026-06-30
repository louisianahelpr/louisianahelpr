-- Expose `pricing_mode` on the public open-jobs surfaces so the browse feed
-- can surface the bids/negotiation affordance.
--
-- Background: jobs.pricing_mode ('set_price' | 'accept_bids' | 'smart_price',
-- added in migration 20260612180000) is the structural gate for bidding. The
-- browse `JobCard` already renders an "Open bids" badge and the apply dialog
-- already collects a proposed bid price — but both read pricing_mode off the
-- feed row, and neither feed source exposes the column today:
--   * public.open_jobs_browse  — the dashboard / guest browse feed
--     (src/hooks/useDashboardData.ts, src/pages/DashboardGuest.tsx)
--   * public.get_ranked_open_jobs — the /jobs page feed (src/pages/Jobs.tsx)
--
-- This migration appends pricing_mode to both so the bid mode flows through.
-- Consuming code treats the column as optional (the selects degrade to a
-- fixed-price card if it's missing) so the feature is PGRST/42703-safe in the
-- window between merge and the manual prod apply.
--
-- Replay-safe:
--   * CREATE OR REPLACE VIEW only APPENDS pricing_mode to the existing column
--     list (Postgres forbids reorder/retype/removal), reproducing the prior
--     body verbatim from migration 20260616120000.
--   * security_invoker=false is re-asserted (CREATE OR REPLACE VIEW can reset
--     reloptions to default) — same posture as migration 20260616120000.
--   * get_ranked_open_jobs changes its RETURNS TABLE shape, so it is
--     DROP + CREATE (CREATE OR REPLACE cannot alter a function's return type).
--     EXECUTE is re-granted to anon + authenticated afterward.

-- ── 1. open_jobs_browse: append pricing_mode ─────────────────────────
CREATE OR REPLACE VIEW public.open_jobs_browse AS
SELECT
  id,
  title,
  description,
  category,
  budget,
  date_needed,
  CASE
    WHEN offered_to_helper_id = auth.uid() THEN location
    ELSE public.mask_job_location(location)
  END AS location,
  is_urgent,
  urgent_fee,
  is_flexible_schedule,
  is_recurring,
  is_group_job,
  helpers_needed,
  estimated_hours,
  start_time,
  photos,
  special_requirements,
  status,
  created_at,
  updated_at,
  boosted_at,
  boost_expires_at,
  expires_at,
  recurrence_interval,
  recurrence_end_date,
  parent_job_id,
  payment_status,
  customer_id,
  offered_to_helper_id,
  direct_offer_status,
  direct_offer_expires_at,
  (
    SELECT count(*)
    FROM public.applications a
    WHERE a.job_id = jobs.id
  )::integer AS applicant_count,
  pricing_mode
FROM jobs
WHERE status = 'open'::job_status
  AND (
    offered_to_helper_id IS NULL
    OR direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
    OR offered_to_helper_id = auth.uid()
  );

-- Re-assert the owner-evaluated posture (CREATE OR REPLACE VIEW may have
-- reset the reloption to its default).
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  END IF;
END $$;

-- ── 2. get_ranked_open_jobs: append pricing_mode ─────────────────────
DROP FUNCTION IF EXISTS public.get_ranked_open_jobs(integer, integer);
CREATE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
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
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee, is_flexible_schedule,
    is_recurring, is_group_job, helpers_needed, estimated_hours, photos,
    special_requirements, created_at, expires_at, boosted_at, boost_expires_at,
    parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer) TO anon, authenticated;
