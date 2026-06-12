-- Add intro video fields to profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS intro_video_url         text,
  ADD COLUMN IF NOT EXISTS intro_video_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS intro_video_duration_seconds integer;

-- Extend get_safe_profiles to expose the intro video URL so applicant
-- cards and public profiles can render the play button without a
-- separate profiles read.
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
  intro_video_duration_seconds integer
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
    p.intro_video_url, p.intro_video_thumbnail_url, p.intro_video_duration_seconds
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
