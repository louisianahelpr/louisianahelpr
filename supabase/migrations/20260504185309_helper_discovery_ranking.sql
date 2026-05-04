-- Helper discovery: location-aware ranking on the open-jobs feed.
--
-- Today src/pages/Jobs.tsx queries the public.open_jobs_safe view and
-- sorts by created_at DESC. That means every helper sees the same
-- chronological list regardless of where they're willing to work.
-- Helpers in NOLA scroll past Shreveport jobs, customers in less-active
-- parishes wait longer for the right helper to find their post.
--
-- This RPC adds a per-caller ranking layer:
--   1. Boosted jobs (paid promotion) → top
--   2. Parish match against the caller's helper_preferred_parishes
--   3. Urgent jobs
--   4. Recency
--
-- Anon callers (logged-out browsers, marketing) get pure chronological
-- + boost ranking — no parish boost since we don't know their location.
-- That preserves the existing public Jobs page UX.
--
-- The RPC returns the same column set as open_jobs_safe plus `parish`
-- (so the UI can render a badge) and `parish_match` (boolean, lets the
-- UI optionally highlight matched cards).

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(
  p_limit  integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  category public.job_category,
  budget numeric,
  date_needed date,
  start_time time,
  location text,
  parish text,
  is_urgent boolean,
  urgent_fee numeric,
  is_flexible_schedule boolean,
  is_recurring boolean,
  is_group_job boolean,
  helpers_needed integer,
  estimated_hours numeric,
  photos text[],
  special_requirements text,
  created_at timestamptz,
  expires_at timestamptz,
  boosted_at timestamptz,
  boost_expires_at timestamptz,
  parish_match boolean,
  rank_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer_parishes AS (
    -- Caller's preferred parishes. Empty for anon callers — that's the
    -- intended fallback (no parish boost, just chronological + paid boost).
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = auth.uid()
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.is_group_job,
      j.helpers_needed, j.estimated_hours, j.photos, j.special_requirements,
      j.created_at, j.expires_at, j.boosted_at, j.boost_expires_at,
      -- Parish match flag for UI use
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Composite score: weighted to surface the most relevant jobs first
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        -- Recency: 0-50 points, decaying by hour (newer = higher)
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
      )::numeric AS rank_score
    FROM public.jobs j
    WHERE j.status = 'open'
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
  )
  SELECT
    id, title, description, category, budget, date_needed, start_time,
    location, parish, is_urgent, urgent_fee, is_flexible_schedule,
    is_recurring, is_group_job, helpers_needed, estimated_hours, photos,
    special_requirements, created_at, expires_at, boosted_at, boost_expires_at,
    parish_match, rank_score
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer) TO anon, authenticated;

COMMENT ON FUNCTION public.get_ranked_open_jobs IS
'Ranks open jobs for the calling helper. Score: boost (1000) + parish match (500) + urgent (100) + recency (0-50). Anon callers get score without parish boost.';
