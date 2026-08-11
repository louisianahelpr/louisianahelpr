-- Fix: resolve_auto_tip() returned NULL, not 0, when no profile row matched.
--
-- The previous definition put COALESCE inside the SELECT list. That handles a
-- NULL *column*, but not a missing *row* — with no matching profile the query
-- returns zero rows and a SQL function with no rows returns NULL. The comment
-- on it promised "returns 0 when there is nothing to tip, so callers can treat
-- 0 as skip without null handling", which was simply not true.
--
-- Not currently dangerous: `NULL > 0` is false in SQL and `null > 0` is false
-- in JS, so both would skip the tip rather than charge a wrong amount. But the
-- money path is the last place to leave a documented contract broken, waiting
-- for someone to write `if (tip !== 0)` or SUM() over it and get a surprise.
--
-- Wrapping the whole subquery makes the promise true. A user with no profile
-- row now resolves to 0, the same as a user who has auto-tip off.

CREATE OR REPLACE FUNCTION public.resolve_auto_tip(_user uuid, _budget numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE p.auto_tip_mode
             WHEN 'fixed'   THEN p.auto_tip_value
             -- Rounded to whole dollars: "$8.10" reads as a billing error on
             -- a gratuity. LEAST applies the cap, when one is set.
             WHEN 'percent' THEN LEAST(
                                   round(_budget * p.auto_tip_value / 100.0),
                                   COALESCE(p.auto_tip_cap, 1e9)
                                 )
             ELSE 0
           END
    FROM public.profiles p
    WHERE p.user_id = _user
    LIMIT 1
  ), 0);
$$;

REVOKE ALL ON FUNCTION public.resolve_auto_tip(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_auto_tip(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_auto_tip(uuid, numeric) TO authenticated;
