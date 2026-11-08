-- Owner 11-07 (after reviewing Vinted): the item page's seller card shows trust badges computed from real data, with
-- honest thresholds and no badge when the data is thin. One of them, "On-time handovers", needs the seller's order
-- and strike rows, which no buyer can read (they are the seller's private records).
--
-- declutter_seller_on_time_handovers(p_seller_id): ONE boolean, never a count, a date or an order:
--   true only when, in the last 365 days, the seller handed over at least 5 orders (declutter_orders status
--   'handed_over', closed in that window) AND has no seller-side strike for a missed or failed handover in that
--   window that still stands (declutter_strikes offender_side 'seller', reason seller_no_show, item_gone_after_sale or
--   not_as_described, not removed). Fewer than 5 handovers is thin data: false, so no badge.
-- A test (seed) seller reads false for a caller from whom test accounts are hidden (seed_hidden_for), as
-- declutter_seller_sold_count does. Members only, while Declutter is on for them (require_feature first); a guest
-- never sees the seller card.
--
-- Helpers named below exist on prod (pg_proc, 11-07): require_feature(text), seed_hidden_for(uuid).
-- Tables read (prod information_schema, 11-07): declutter_orders(seller_id, status, closed_at), declutter_strikes
-- (user_id, offender_side, reason, given_at, removed_at), profiles(user_id, is_seed).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; REVOKE/GRANT restated.
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
COMMENT ON FUNCTION public.declutter_seller_on_time_handovers(uuid) IS
  'Owner 11-07: true when the seller handed over 5+ orders in the last year with no standing missed-handover strike; one boolean, never counts.';
