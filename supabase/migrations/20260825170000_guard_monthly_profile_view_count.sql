-- get_monthly_profile_view_count: stop leaking one user's traffic to anyone.
--
-- The function is SECURITY DEFINER, EXECUTE is granted to anon + authenticated,
-- and it took a caller-supplied p_user_id with NO check that the caller was
-- that user. So any visitor could read any Helpr's 30-day distinct-viewer
-- count by guessing a profile uuid -- a private engagement metric the product
-- only ever shows a Helpr about themselves (Supabase security advisor flagged
-- it as anon-executable; found by the 2026-08-25 admin audit).
--
-- The only caller is fetchAnalytics(user!.id) on /analytics, which always
-- passes the signed-in user's own id, so gating on auth.uid() preserves every
-- real call site and costs nothing.
--
-- Returns 0 rather than raising for a non-self id: the /analytics card treats
-- this as a soft metric and already renders 0 on failure, so a hard exception
-- would turn a hidden leak into a visible crash for no benefit.
--
-- Replay-safe: CREATE OR REPLACE keeps the same signature and return type, and
-- the grants below are re-asserted rather than assumed.

CREATE OR REPLACE FUNCTION public.get_monthly_profile_view_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL OR auth.uid() <> p_user_id THEN 0
    ELSE (
      SELECT COUNT(DISTINCT viewer_user_id)::integer
      FROM public.profile_views
      WHERE viewed_user_id = p_user_id
        AND viewed_at > now() - INTERVAL '30 days'
    )
  END;
$function$;

-- anon can no longer learn anything from this, so drop its EXECUTE entirely;
-- authenticated keeps it because that is the real (self-only) call path.
DO $$
BEGIN
  IF to_regprocedure('public.get_monthly_profile_view_count(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_monthly_profile_view_count(uuid) FROM anon;
    GRANT EXECUTE ON FUNCTION public.get_monthly_profile_view_count(uuid) TO authenticated;
  END IF;
END $$;
