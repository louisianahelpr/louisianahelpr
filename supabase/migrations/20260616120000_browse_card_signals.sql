-- Browse-card trust signals: applicant count + poster ID-verified flag.
--
-- Goal: the Browse `JobCard` wants two pieces of social proof that the
-- current feed surfaces (`open_jobs_browse` view + `get_safe_profiles`
-- RPC, both consumed in src/hooks/useDashboardData.ts) do not yet
-- expose:
--   (a) "N applied"  — how many helpers have already applied to the job.
--   (b) a verified badge — whether the *poster* has completed identity
--       verification (profiles.idv_status = 'verified', added in
--       migration 20260418200319).
--
-- Both are added as APPENDED columns so the existing PostgREST `.select`
-- lists keep working untouched until the frontend opts in. This migration
-- does NOT auto-deploy (Supabase migrations need a manual `supabase db
-- push`); the consuming code must therefore treat the new columns as
-- optional and hide the signals until they appear (PGRST202 / 42703-safe).
--
-- Replay-safe:
--   * CREATE OR REPLACE VIEW only appends `applicant_count` to the end of
--     the existing column list (Postgres forbids reorder/retype/removal),
--     reproducing the prior body verbatim from migration 20260426123151.
--   * The view's security posture is re-asserted to security_invoker=false
--     (run as owner) — same as migration 20260529115941 — because
--     CREATE OR REPLACE VIEW can reset reloptions to their default. Running
--     as owner is what lets the correlated count over `applications` (and
--     anon's masked browse access) work without granting callers direct
--     SELECT on the underlying tables.
--   * get_safe_profiles changes its RETURNS TABLE shape, so it must be
--     DROP + CREATE (CREATE OR REPLACE cannot alter the return type) — the
--     same pattern migration 20260612300000 used to add the intro-video
--     columns. EXECUTE is re-granted afterward (SECURITY DEFINER revokes
--     PUBLIC by default).

-- ── 1. open_jobs_browse: append applicant_count ──────────────────────
-- Correlated count of every application against the job. Runs under the
-- view owner (security_invoker=false below), so a browsing helper sees an
-- honest count without needing SELECT on other people's applications.
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
  )::integer AS applicant_count
FROM jobs
WHERE status = 'open'::job_status
  AND (
    offered_to_helper_id IS NULL
    OR direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
    OR offered_to_helper_id = auth.uid()
  );

-- Re-assert the owner-evaluated posture (see migration 20260529115941):
-- CREATE OR REPLACE VIEW may have reset the reloption to its default.
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  END IF;
END $$;

-- ── 2. get_safe_profiles: append is_id_verified ──────────────────────
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);
CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id                  uuid,
  full_name                text,
  avatar_url               text,
  bio                      text,
  location                 text,
  skills                   text,
  hourly_rate              numeric,
  role                     text,
  subscription_tier        text,
  portfolio_urls           text[],
  created_at               timestamp with time zone,
  intro_video_url          text,
  intro_video_thumbnail_url text,
  intro_video_duration_seconds integer,
  is_id_verified           boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE WHEN ur.role = 'admin'::app_role THEN 'admin' ELSE 'member' END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    p.intro_video_url, p.intro_video_thumbnail_url, p.intro_video_duration_seconds,
    (p.idv_status = 'verified') AS is_id_verified
  FROM public.profiles p
  WHERE p.user_id = ANY(user_ids)
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

-- Re-grant execute to authenticated (SECURITY DEFINER revokes public by default).
DO $$
BEGIN
  IF to_regprocedure('public.get_safe_profiles(uuid[])') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO authenticated;
  END IF;
END
$$;
