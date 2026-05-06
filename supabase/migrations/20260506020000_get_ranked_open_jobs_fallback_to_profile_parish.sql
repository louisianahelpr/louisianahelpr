-- Updated get_ranked_open_jobs: parish-match bonus now falls back to
-- profiles.parish when helper_preferred_parishes is empty for the
-- viewer. Previously only customized helpers got any location-based
-- ranking signal — new helpers (the most common case) saw jobs in
-- pure boost-then-recency order.
--
-- Score breakdown unchanged otherwise:
--   +1000  active boost
--   +500   parish match (preferred-parishes OR profile.parish fallback)
--   +100   urgent flag
--   +0-50  recency (linear decay over ~50 hours)

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer_parishes AS (
    -- Preferred parishes the helper opted into.
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    -- Fallback: helper's own profile parish (NULL-safe; no row when empty).
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
    location, parish, is_urgent, urgent_fee, is_flexible_schedule,
    is_recurring, is_group_job, helpers_needed, estimated_hours, photos,
    special_requirements, created_at, expires_at, boosted_at, boost_expires_at,
    parish_match, rank_score
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
