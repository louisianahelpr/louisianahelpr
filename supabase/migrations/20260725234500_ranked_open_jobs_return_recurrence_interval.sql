-- Guest job cards said "Recurring" where signed-in cards said "Weekly".
--
-- `JobCard` renders `job.recurrence_interval || "Recurring"`, and the guest
-- feed's TypeScript already carries the field end to end — `PublicJob` declares
-- it and `toEnrichedJob` maps it. The only missing link was the RPC:
-- `get_ranked_open_jobs` never selected `recurrence_interval`, so the value
-- arrived undefined on every guest card and always fell through to the generic
-- label. `open_jobs_browse` (the signed-in source) does return it, which is why
-- only the public board was affected.
--
-- WHY DROP + CREATE RATHER THAN CREATE OR REPLACE.
-- Adding a column to a RETURNS TABLE changes the function's result type, and
-- Postgres rejects that under CREATE OR REPLACE ("cannot change return type of
-- existing function"). A drop is unavoidable here.
--
-- That is safe in this file specifically: DDL is transactional in Postgres and
-- each migration runs in one transaction, so the DROP, the CREATE and the
-- GRANTs commit atomically. There is no window in which the RPC is missing —
-- concurrent callers either see the old definition or the new one. The one real
-- hazard of a drop is losing privileges, since they do NOT survive it, so the
-- GRANTs below are mandatory rather than defensive.
--
-- Privileges captured from prod before writing this (pg_proc.proacl):
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
-- i.e. EXECUTE for anon / authenticated / service_role, plus the PUBLIC default.
-- `anon` is the load-bearing one — without it the signed-out /jobs board 500s.
--
-- Everything else is carried over verbatim from
-- 20260725204500_ranked_open_jobs_match_authed_visibility.sql, including the
-- direct-offer and abandoned-payment filters added there. Only the
-- `recurrence_interval` column is new.
--
-- Replay-safe: DROP ... IF EXISTS, so a from-scratch rebuild and an incremental
-- deploy both land on the same definition.

DROP FUNCTION IF EXISTS public.get_ranked_open_jobs(integer, integer);

CREATE FUNCTION public.get_ranked_open_jobs(
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
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

-- Mandatory: privileges do not survive DROP FUNCTION. `anon` is what the
-- signed-out /jobs board authenticates as.
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer)
  TO anon, authenticated, service_role;
