-- The buyer's "I got it" on a SELLER delivery waits for the delivery (deep audit 2026-10-28, Broken #7, server
-- half; builder 2's client gate is 532251e2a7).
--
-- WHAT WAS WRONG: declutter_confirm_handover (newest 20261018183715) let the buyer confirm a seller-delivered
-- order at any time once it was paid. On a delivery booked for tomorrow, one tap marked the order handed over
-- and started the seller's payout clock before anything had arrived.
--
-- WHAT THIS DOES (restated verbatim but one block): for handover 'seller_delivery' the buyer's confirm is
-- refused with not_delivered_yet (55000) unless the seller has marked it delivered (delivered_at), or a time is
-- booked and today, on the Louisiana calendar (America/Chicago, not UTC), is the slot's day or later. No time
-- booked and not delivered: refused. Every other handover is unchanged. Money: this only ever refuses a
-- confirm that the old body accepted; it never pays anyone or moves a timer earlier. Needs lh-money-escrow.
-- Proof: src/test/pglite/declutterSdConfirmDeliveryDay.pglite.mjs (applied 3x; the 11 PM / 12:30 AM
-- Chicago-vs-UTC edge both ways). Prod's body before this was 20261018183715's (pg_get_functiondef, 2026-10-28).

CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_method IS NULL OR p_method <> 'buyer' THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    -- the seller cannot tap "I got it" for the buyer
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- A seller delivery (20261028202844, #7): only once the seller marked it delivered, or from the delivery
  -- day on the Louisiana calendar. No time booked and not delivered: not yet.
  IF o.handover = 'seller_delivery' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_seller_deliveries d
        WHERE d.order_id = o.id
          AND (d.delivered_at IS NOT NULL
               OR (d.status = 'booked' AND d.slot_start IS NOT NULL
                   AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date))) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it from the delivery day, or once the seller marks it delivered.';
  END IF;
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated, service_role;
