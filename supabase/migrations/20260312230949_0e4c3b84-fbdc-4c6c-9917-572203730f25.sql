
-- ============================================================
-- 1. Tighten profiles SELECT: only owner, admin, or service role
-- ============================================================

DROP POLICY IF EXISTS "Anyone can view approved profiles" ON public.profiles;

-- Owner can see their own full profile
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Service role (edge functions) can read all profiles  
CREATE POLICY "Service role can view all profiles"
ON public.profiles
FOR SELECT
TO public
USING (auth.role() = 'service_role');

-- NOTE: "Admins can view all profiles" policy already exists

-- ============================================================
-- 2. Create a security definer function for safe profile lookups
-- This bypasses RLS but only returns non-sensitive columns
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
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
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate, p.role, p.subscription_tier,
    p.portfolio_urls, p.created_at
  FROM public.profiles p
  WHERE p.user_id = ANY(user_ids)
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status = 'active');
$$;

-- For landing page: count all profiles (no PII exposed)
CREATE OR REPLACE FUNCTION public.count_profiles()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.profiles;
$$;

-- For landing page: get approved helpers with safe fields only
CREATE OR REPLACE FUNCTION public.get_approved_helpers(max_count integer DEFAULT 20)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  location text,
  skills text,
  subscription_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.subscription_tier
  FROM public.profiles p
  WHERE p.role = 'helper'
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status = 'active')
  LIMIT max_count;
$$;
