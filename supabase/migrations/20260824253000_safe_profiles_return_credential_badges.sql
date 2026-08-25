-- The Licensed/Insured badge never had data on public profiles.
--
-- The credential workflow is complete end-to-end — upload → auto-pending
-- trigger → admin queue → review_credential() → notification promising "the
-- badge is now live on your profile" — but the public profile page reads
-- through get_safe_profiles(), which returned idv/intro-video/tier fields and
-- none of the four credential columns. CredentialBadge (ProfileHeaderCard)
-- therefore received undefined and rendered nothing, for every user, since
-- the badge shipped. Found by driving the full loop live on the audit test
-- account (2026-08-24): approve succeeded, notification fired, badge absent.
--
-- The four columns are public trust signals by design (the badge is the
-- feature); rejection reasons and reviewer identities stay private. Return
-- type changes require DROP + CREATE; grants are re-established explicitly
-- (previous ACL: anon + authenticated + service_role).

DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  intro_video_url text, intro_video_thumbnail_url text,
  intro_video_duration_seconds integer,
  is_id_verified boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text
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
    (p.idv_status = 'verified') AS is_id_verified,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;
