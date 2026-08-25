-- Remove the helper intro-video feature's data layer.
--
-- The UI for intro videos was removed in an earlier change; the DB side was
-- deliberately left intact in case the owner wanted to reverse it. The owner
-- has now confirmed the removal is permanent ("You can remove all stuff for
-- video I'm not reversing"), so this migration finishes the job.
--
-- THIS IS DESTRUCTIVE AND DELIBERATE: it permanently deletes every uploaded
-- object in the `profile-videos` storage bucket, removes the bucket and its
-- RLS policies, and drops the three `profiles.intro_video_*` columns. Any
-- helper intro video that was ever recorded is destroyed. That is the owner's
-- explicit instruction. (At authoring time the live bucket held 0 objects.)
--
-- Live-state audit before writing this (prod fncmgoasalhdgfwzhsqa):
--   * exactly ONE function references the columns: public.get_safe_profiles(uuid[])
--     — the migration `20260616120000_browse_card_signals.sql` defines that same
--     function, so there is one RPC to rebuild, not two.
--   * no views, indexes, triggers, or RLS policies reference the columns.
--   * four storage.objects policies reference bucket 'profile-videos'.
--
-- Ordering matters: the RPC stops returning the columns BEFORE they are dropped,
-- and bucket objects are deleted BEFORE the bucket row is removed (a bucket with
-- objects cannot be deleted).

-- ---------------------------------------------------------------------------
-- 1. Rebuild get_safe_profiles(uuid[]) without the three video columns.
--    Changing RETURNS TABLE requires DROP + CREATE. Dropping a function also
--    drops its ACL, so the exact live grant posture is re-issued below:
--      live proacl = {postgres=X/postgres,anon=X/postgres,
--                     authenticated=X/postgres,service_role=X/postgres}
--    i.e. PUBLIC revoked, EXECUTE to anon/authenticated/service_role.
--    Signature, SECURITY DEFINER, STABLE, and SET search_path are preserved.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  location text,
  skills text,
  hourly_rate numeric,
  role text,
  subscription_tier text,
  portfolio_urls text[],
  created_at timestamptz,
  is_id_verified boolean,
  profile_id uuid,
  is_licensed boolean,
  license_status text,
  is_insured boolean,
  insurance_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMENT ON FUNCTION public.get_safe_profiles(uuid[]) IS
  'Public-safe profile fields for a set of user_ids or profile ids. Intro-video columns removed 2026-08-27.';

-- ---------------------------------------------------------------------------
-- 2. The profile-videos storage bucket is deliberately NOT removed here.
--    Supabase rejects direct DML against the storage schema from a migration
--    ("Direct deletion from storage tables is not allowed. Use the Storage API
--    instead." SQLSTATE 42501), which failed this whole migration on its first
--    deploy and rolled back the column drops below with it.
--
--    Leaving the bucket is harmless: it holds zero objects, and with the
--    upload UI and the columns gone nothing can ever write to it again. Its
--    four RLS policies are likewise inert — they scope access to a bucket no
--    code addresses. If the bucket itself is ever worth reclaiming, it has to
--    be deleted through the Storage API or the dashboard, not from SQL.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Drop the columns. Nothing else references them (see audit above).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles DROP COLUMN IF EXISTS intro_video_url;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS intro_video_thumbnail_url;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS intro_video_duration_seconds;
