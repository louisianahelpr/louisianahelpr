-- Server-side rate limit for search_profiles_by_name (20260830104514).
--
-- That RPC deliberately returns only user_id/full_name/avatar_url, never
-- email — but nothing stopped a caller from invoking it directly (bypassing
-- the UI's 300ms debounce) and enumerating every approved profile's name +
-- avatar via repeated 2-character-prefix queries, 10 rows at a time. The
-- earlier profiles-RLS tightening (20260312230949) was written specifically
-- to stop profile scraping; this closes the same hole reopened by the new
-- search path. Mirrors the apply-to-job rate-limit pattern
-- (20260609130000): a rolling-window log table, checked before the search
-- and recorded on every call (including empty/short-circuited ones, so a
-- burst of sub-2-char probes still counts).
--
-- Limits: 20/minute, 200/day per caller — generous for a human typing a
-- name (each keystroke debounces to at most one call), tight enough that
-- enumerating the approved-user set 10 rows at a time is impractical.
--
-- REPLAY-SAFETY: IF NOT EXISTS / OR REPLACE / IF EXISTS throughout; nothing
-- here references an object defined by a later migration.

CREATE TABLE IF NOT EXISTS public.profile_search_rate_log (
  id bigserial PRIMARY KEY,
  searcher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_search_rate_log_searcher_recent_idx
  ON public.profile_search_rate_log (searcher_id, created_at DESC);

ALTER TABLE public.profile_search_rate_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_search_rate_log owner select" ON public.profile_search_rate_log;
CREATE POLICY "profile_search_rate_log owner select" ON public.profile_search_rate_log
  FOR SELECT TO authenticated
  USING (auth.uid() = searcher_id);

-- No INSERT policy — the SECURITY DEFINER function below is the only writer.

DROP FUNCTION IF EXISTS public.search_profiles_by_name(text);

CREATE FUNCTION public.search_profiles_by_name(query text)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _minute_count int;
  _day_count int;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  -- Log the attempt first (including short queries), then check the window
  -- — so the rate limit itself can't be bypassed by staying under the
  -- 2-character floor.
  INSERT INTO public.profile_search_rate_log (searcher_id) VALUES (_uid);

  SELECT count(*) INTO _minute_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 minute';
  IF _minute_count > 20 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many searches — try again in a minute';
  END IF;

  SELECT count(*) INTO _day_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 day';
  IF _day_count > 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily search limit reached — try again tomorrow';
  END IF;

  IF length(trim(coalesce(query, ''))) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id <> _uid
    AND p.full_name IS NOT NULL
    AND p.full_name ILIKE '%' || trim(query) || '%'
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
  ORDER BY p.full_name ASC
  LIMIT 10;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated;
