-- Privacy (lead 11-07, Builder 5): "last active" answers a coarse band, never a sign-in time; the seller badges skip
-- blocked, suspended and removed sellers.
--
-- 1. get_user_last_active(user_ids uuid[]) (20260609090000) returned the EXACT newest sign-in time (MAX(login_history
--    .created_at)) for ANY list of user ids to any signed-in member: no block filter, no test-account filter, no cap on
--    the list, and search_path without pg_temp. Polling it told a member to the second when someone signed in.
--    Restated (the result columns change, so DROP + CREATE; CREATE OR REPLACE cannot change a RETURNS TABLE):
--      RETURNS TABLE(user_id uuid, active_band text), active_band one of
--        'today'     the newest sign-in falls on today's date in Louisiana (America/Chicago),
--        'this_week' otherwise within the last 7 days;
--      a user with no sign-in in the last 7 days gets NO row (never "last seen 3 weeks ago").
--    No row either (indistinguishable from "not active") for: a user the caller has a block with, either direction
--    (user_blocks); a suspended or removed user (no profiles row; ban_status banned / permanently_banned, or
--    temp_banned with the suspension still running, as is_caller_banned reads it; under_13_blocked_at set); a test
--    (is_seed) user when test accounts are hidden from the caller (seed_hidden_for, Q137).
--    More than 200 ids raises too_many_ids (22023); the inbox asks in pages of 200 (src/lib/activeBand.ts).
--    No caller (auth.uid() null) raises not_authenticated (42501). search_path public, pg_temp.
-- 2. declutter_seller_sold_count (20261028202132) and declutter_seller_on_time_handovers (20261107235110) gain the same
--    block and suspended/removed checks: 0 / false for a seller the caller has a block with, or one who is suspended
--    or removed. Bodies otherwise restated verbatim from those migrations.
--
-- Prod shape read 11-07 (information_schema / pg_proc, read-only): profiles(user_id, is_seed, ban_status,
-- auto_suspended_until, under_13_blocked_at); ban_status values active / temp_banned / permanently_banned;
-- user_blocks(blocker_id, blocked_id); login_history(user_id, created_at); seed_hidden_for(uuid) exists.
-- Proof: src/test/pglite/lastActiveBand.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: DROP FUNCTION IF EXISTS + CREATE; the other two CREATE OR REPLACE; REVOKE/GRANT restated.

DROP FUNCTION IF EXISTS public.get_user_last_active(uuid[]);
CREATE FUNCTION public.get_user_last_active(user_ids uuid[])
RETURNS TABLE(user_id uuid, active_band text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seed_hidden boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(user_ids), 0) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(user_ids) > 200 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_seed_hidden := public.seed_hidden_for(v_uid);
  RETURN QUERY
  SELECT p.user_id,
         CASE WHEN (MAX(lh.created_at) AT TIME ZONE 'America/Chicago')::date
                   = (now() AT TIME ZONE 'America/Chicago')::date
              THEN 'today' ELSE 'this_week' END::text
    FROM public.profiles p
    JOIN public.login_history lh ON lh.user_id = p.user_id
   WHERE p.user_id = ANY(user_ids)
     AND lh.created_at > now() - interval '7 days'
     AND lh.created_at <= now()
     AND NOT (COALESCE(p.is_seed, false) AND v_seed_hidden)
     AND NOT (COALESCE(p.ban_status, 'active') IN ('banned', 'permanently_banned')
              OR (COALESCE(p.ban_status, 'active') = 'temp_banned' AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())))
     AND p.under_13_blocked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = v_uid AND b.blocked_id = p.user_id)
                         OR (b.blocker_id = p.user_id AND b.blocked_id = v_uid))
   GROUP BY p.user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_user_last_active(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_last_active(uuid[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_user_last_active(uuid[]) IS
  'Coarse activity band (today / this_week, else no row) for up to 200 users; skips blocked, suspended, removed and hidden test users. Never a timestamp.';

CREATE OR REPLACE FUNCTION public.declutter_seller_sold_count(p_seller_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_seller_id IS NULL THEN
    RETURN 0;
  END IF;
  IF COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = p_seller_id), false)
     AND public.seed_hidden_for(v_uid) THEN
    RETURN 0;
  END IF;
  -- 11-07: a seller the caller has a block with (either way), or who is suspended or removed, reads 0.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = p_seller_id
                    AND NOT (COALESCE(p.ban_status, 'active') IN ('banned', 'permanently_banned')
                             OR (COALESCE(p.ban_status, 'active') = 'temp_banned' AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())))
                    AND p.under_13_blocked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = v_uid AND b.blocked_id = p_seller_id)
                    OR (b.blocker_id = p_seller_id AND b.blocked_id = v_uid)) THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(*)::integer
            FROM public.declutter_orders o
            JOIN public.declutter_cart_items c ON c.order_id = o.id
           WHERE o.seller_id = p_seller_id AND o.status = 'handed_over' AND c.price_cents > 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_sold_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_sold_count(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_on_time_handovers(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  IF COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = p_seller_id), false)
     AND public.seed_hidden_for(v_uid) THEN
    RETURN false;
  END IF;
  -- 11-07: a seller the caller has a block with (either way), or who is suspended or removed, reads false.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = p_seller_id
                    AND NOT (COALESCE(p.ban_status, 'active') IN ('banned', 'permanently_banned')
                             OR (COALESCE(p.ban_status, 'active') = 'temp_banned' AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())))
                    AND p.under_13_blocked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = v_uid AND b.blocked_id = p_seller_id)
                    OR (b.blocker_id = p_seller_id AND b.blocked_id = v_uid)) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.declutter_strikes s
     WHERE s.user_id = p_seller_id
       AND s.offender_side = 'seller'
       AND s.reason IN ('seller_no_show', 'item_gone_after_sale', 'not_as_described')
       AND s.removed_at IS NULL
       AND s.given_at > now() - interval '365 days'
  ) THEN
    RETURN false;
  END IF;
  RETURN (SELECT count(*) >= 5
            FROM public.declutter_orders o
           WHERE o.seller_id = p_seller_id
             AND o.status = 'handed_over'
             AND o.closed_at > now() - interval '365 days');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_on_time_handovers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_on_time_handovers(uuid) TO authenticated, service_role;
