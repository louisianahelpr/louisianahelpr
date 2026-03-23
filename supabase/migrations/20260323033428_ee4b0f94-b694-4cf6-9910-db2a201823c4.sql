CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate, p.role, p.subscription_tier,
    p.portfolio_urls, p.created_at
  FROM public.profiles p
  WHERE p.user_id = ANY(user_ids)
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status IN ('active', 'warned'));
$$;