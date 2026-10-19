-- Shops O2: THE SHOP DECIDES what an early "ready" tap does to the buyer's free
-- cancel (owner pop-up 2026-10-19: "LET THE SHOPS DECIDE THIS."; Q2155).
--
-- Under the "Free to cancel until your order is ready" preset ('until_handover')
-- a shop may tap "ready" days before the ready date (shops_mark_ready has no
-- date check). shops.ready_tap_cancel, set by shops_set_ready_tap_cancel (the
-- caller's OWN shop only), says what that tap does:
--   'ends_at_tap'      the ready tap ends free cancel at once (never later than
--                      the ready date's start);
--   'from_day_before'  DEFAULT, the behaviour built by 20261019013802: a ready
--                      tap counts only from the start of the day before the
--                      ready date (Louisiana time);
--   'never_shortens'   the ready tap never shortens it: free cancel runs to the
--                      ready date's start.
-- The other presets never read the ready tap, so the choice changes nothing
-- under them.
--
-- Frozen on each order at insert (trigger, as handover_mode in 20261018211820),
-- and never changed after: the buyer pays under the terms they read
-- (shops_order_terms returns the choice), and a later switch of the shop's
-- setting never moves an order already asked for. Every order placed before
-- this migration gets the default, i.e. the rule it was placed under.
--
-- shop_order_free_cancel_until reads the ORDER's frozen copy (restated below;
-- M3 still locks the order row first, see 20261019013802's header).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints added only when missing
-- (validated, never NOT VALID: both tables' new column is filled by its
-- default), CREATE OR REPLACE with unchanged signatures, DROP TRIGGER IF
-- EXISTS. Grants restated by role name; REVOKE ... FROM PUBLIC, anon (and
-- authenticated for the service-only function). No new index. Applied 3x by
-- src/test/pglite/shopsHandoverPayout.pglite.mjs (section 9).

-- ---------------------------------------------------------------------------
-- 1. The shop's choice, and the order's frozen copy of it.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS ready_tap_cancel text NOT NULL DEFAULT 'from_day_before';
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS ready_tap_cancel text NOT NULL DEFAULT 'from_day_before';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_ready_tap_cancel_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_ready_tap_cancel_check
      CHECK (ready_tap_cancel IN ('ends_at_tap', 'from_day_before', 'never_shortens'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_ready_tap_cancel_check') THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_ready_tap_cancel_check
      CHECK (ready_tap_cancel IN ('ends_at_tap', 'from_day_before', 'never_shortens'));
  END IF;
END
$do$;
GRANT SELECT (ready_tap_cancel) ON TABLE public.shops TO authenticated;
GRANT SELECT (ready_tap_cancel) ON TABLE public.shop_orders TO authenticated;
GRANT ALL ON TABLE public.shops TO service_role;
GRANT ALL ON TABLE public.shop_orders TO service_role;

-- Frozen at birth from the shop (whoever inserts: shops_request_order is not
-- restated), and never changed after.
CREATE OR REPLACE FUNCTION public.shop_orders_ready_tap_cancel_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ready_tap_cancel := COALESCE((SELECT s.ready_tap_cancel FROM public.shops s WHERE s.id = NEW.shop_id), 'from_day_before');
  ELSIF NEW.ready_tap_cancel IS DISTINCT FROM OLD.ready_tap_cancel THEN
    RAISE EXCEPTION 'ready_tap_cancel_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_ready_tap_cancel_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_ready_tap_cancel ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_ready_tap_cancel BEFORE INSERT OR UPDATE OF ready_tap_cancel ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_ready_tap_cancel_frozen();

-- ---------------------------------------------------------------------------
-- 2. The shop picks (the same gates as shops_set_cancel_policy): its OWN shop
--    only (WHERE owner_id = the caller); a member without a shop gets
--    shop_not_found (or the owner-eligibility refusal) and changes nothing.
CREATE OR REPLACE FUNCTION public.shops_set_ready_tap_cancel(p_choice text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_choice IS NULL OR p_choice NOT IN ('ends_at_tap', 'from_day_before', 'never_shortens') THEN
    RAISE EXCEPTION 'invalid_ready_tap_cancel' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET ready_tap_cancel = p_choice, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_choice;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_ready_tap_cancel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_ready_tap_cancel(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. What a buyer sees before ordering: the same terms plus the shop's
--    ready-tap choice (restated from 20261018164442 with one key added).
CREATE OR REPLACE FUNCTION public.shops_order_terms(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id;
  -- A member the owner blocked (or who blocked the owner) sees no terms, as
  -- shops_request_order refuses them (lh-authz-rls review, 2026-10-18).
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'cancel_policy', s.cancel_policy,
    'ready_tap_cancel', s.ready_tap_cancel,
    'paused', s.paused,
    'open_weekdays', (SELECT COALESCE(jsonb_agg(DISTINCT h.weekday ORDER BY h.weekday), '[]'::jsonb)
                        FROM public.shop_hours h WHERE h.shop_id = s.id),
    'daily_order_cap', s.daily_order_cap,
    'today', v_today,
    'last_day', v_today + 90,
    'full_days', CASE WHEN s.daily_order_cap IS NULL THEN '[]'::jsonb ELSE (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb) FROM (
        SELECT o.ready_date AS d FROM public.shop_orders o
         WHERE o.seller_id = s.owner_id AND o.ready_date BETWEEN v_today AND v_today + 90
           AND o.status IN ('held', 'accepted', 'handed_over')
         GROUP BY o.ready_date HAVING count(*) >= s.daily_order_cap) f) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_terms(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Until when a buyer may cancel for free: 'until_handover' follows the
--    ORDER's frozen choice. An unknown choice is NULL (closed), as an unknown
--    preset. Everything else as 20261019013802.
CREATE OR REPLACE FUNCTION public.shop_order_free_cancel_until(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN o.status IS DISTINCT FROM 'accepted' OR o.handed_over_at IS NOT NULL THEN '-infinity'::timestamptz
           ELSE CASE o.cancel_policy
                  WHEN 'until_accept' THEN o.accepted_at
                  WHEN 'until_24h_before_ready' THEN (o.ready_date::timestamp AT TIME ZONE 'America/Chicago') - interval '24 hours'
                  WHEN 'until_handover' THEN CASE o.ready_tap_cancel
                    WHEN 'ends_at_tap' THEN least((o.ready_date::timestamp AT TIME ZONE 'America/Chicago'),
                                                  COALESCE(h.ready_at, 'infinity'::timestamptz))
                    WHEN 'from_day_before' THEN least((o.ready_date::timestamp AT TIME ZONE 'America/Chicago'),
                                                      greatest(COALESCE(h.ready_at, 'infinity'::timestamptz),
                                                               ((o.ready_date - 1)::timestamp AT TIME ZONE 'America/Chicago')))
                    WHEN 'never_shortens' THEN (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')
                  END
                END
         END
    FROM public.shop_orders o
    LEFT JOIN public.shop_handovers h ON h.order_id = o.id
   WHERE o.id = p_order_id
$fn$;
COMMENT ON FUNCTION public.shop_order_free_cancel_until(uuid) IS
  'Until when a buyer may cancel an accepted shop order for free (O2). until_handover follows the order''s frozen ready_tap_cancel (the shop''s choice): ends_at_tap = the ready tap or the ready date''s start, whichever is first. from_day_before = the ready date''s start, or the ready tap counted only from the day before (Louisiana time). never_shortens = the ready date''s start. Call it inside the transaction that holds the order row lock (FOR UPDATE) before refunding, and record free/late on the order (out of accepted) before that commit; call Stripe only after it.';
REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_free_cancel_until(uuid) TO service_role;
