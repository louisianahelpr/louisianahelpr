-- get_safe_profiles: resolve a person by EITHER of their two ids.
--
-- `profiles` carries two distinct uuids: `id` (a standalone PK, defaulted from
-- gen_random_uuid()) and `user_id` (the auth user id). They are different
-- values for the same person. Until now this function matched `user_id` only,
-- so any caller holding a `profiles.id` got an empty result -- and, because a
-- missing row is indistinguishable from "no such person", the UI degraded to a
-- literal "User" placeholder with no avatar.
--
-- That is not hypothetical. `public.messages.sender_id` / `receiver_id` have NO
-- foreign key (only job_id and reply_to_id are constrained), so nothing stops a
-- writer from persisting a `profiles.id` where an auth id belongs -- and prod
-- has exactly that: the thread on job a5eed000-0000-4000-8000-000000000008
-- stores Marie Hebert's profile id (9de6198d-...) instead of her auth id
-- (11111111-...-103). The Messages inbox rendered that thread as "User".
--
-- The client cannot recover on its own: `profiles` RLS only admits
-- `auth.uid() = user_id` (plus admins/service_role), so a direct
-- `.in("id", ...)` read returns zero rows for anyone else. This SECURITY
-- DEFINER function is the only lever, so it learns to accept either key.
--
-- Matching on `id` as well as `user_id` widens nothing meaningfully: both are
-- gen_random_uuid()-space values, the approved/not-banned filters are unchanged,
-- and the returned column set is the same safe projection as before. The new
-- `profile_id` output column is appended (never reordered) so callers can key a
-- lookup map by whichever id they happen to hold; every existing caller reads
-- fields by name and is untouched.
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
  is_id_verified           boolean,
  profile_id               uuid
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
    p.id AS profile_id
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

-- Re-grant execute to authenticated (SECURITY DEFINER revokes public by default).
-- anon keeps the implicit PUBLIC grant a fresh CREATE restores, which is
-- deliberate: this is one of the public read RPCs the landing/browse surfaces
-- call (see 20260618150000_sec_revoke_anon_mutation_rpcs.sql).
DO $$
BEGIN
  IF to_regprocedure('public.get_safe_profiles(uuid[])') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO authenticated;
  END IF;
END
$$;
