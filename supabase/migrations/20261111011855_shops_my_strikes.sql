-- Q2110 (NOT-LAUNCHED Shops; lh-authz-rls finding on the per-section strikes change): a member can see their own
-- Shops strikes and when each one ends. Shops stays behind its switch (testers).
-- Before: public.shop_strikes (20261018164444) is service_role only (RLS on, no policy), so a member who got
-- "You have 3 Shops strikes, so Shops is paused for you" (shop_strikes_blocked) could not see which strikes they had
-- or when Shops opens again.
-- What this adds: shops_my_strikes() -> the caller's OWN active Shops strikes (not removed, not ended), soonest to end
-- first: (id, offender_side, reason, given_at, expires_at).
--   - Only rows where user_id = the caller; there is no argument, so nobody can ask about another member.
--   - Never removed_by (which admin removed a strike) and never removed or ended strikes.
--   - The table keeps no member grant and no policy: this read is the only door.
-- AUTHZ: one new SECURITY DEFINER read (lh-authz-rls). MONEY: no.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated.
-- Proof: src/test/pglite/shopsMyStrikes.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shops_my_strikes()
RETURNS TABLE (id uuid, offender_side text, reason text, given_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.offender_side, s.reason, s.given_at, s.expires_at
      FROM public.shop_strikes s
     WHERE s.user_id = v_uid
       AND s.removed_at IS NULL
       AND s.expires_at > now()
     ORDER BY s.expires_at ASC, s.id ASC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_strikes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_strikes() TO authenticated, service_role;
