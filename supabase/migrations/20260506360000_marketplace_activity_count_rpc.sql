-- Public read-only RPC for the hero status pill. Returns count of
-- currently-open jobs posted in the last 7 days — a meaningful
-- "marketplace is alive" signal at any traffic level.
--
-- SECURITY DEFINER + grant to anon so the homepage can call it
-- without an authenticated session. Bounded query (single COUNT)
-- on public open jobs only — no user data exposure.

CREATE OR REPLACE FUNCTION public.get_marketplace_activity_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::integer
  FROM public.jobs
  WHERE status = 'open'
    AND created_at > NOW() - INTERVAL '7 days';
$$;

REVOKE ALL ON FUNCTION public.get_marketplace_activity_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketplace_activity_count() TO anon, authenticated;
