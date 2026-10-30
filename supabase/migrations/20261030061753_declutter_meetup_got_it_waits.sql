-- A meeting-spot or door-pickup "I got it" waits for the booked time (Declutter audit 1030, buying DB-3).
--
-- What was broken: at a safe meeting spot the buyer could tap "I got it" days before the booked meeting time
-- (live run B: booked for later, "I got it" accepted at once). That marks the order handed over and starts the
-- seller's 24-hour payout clock before the two people ever met, and leaves the buyer's refund window running out
-- before they have the item. "I'm here" at the same spot already waits until an hour before the meeting time
-- (declutter_meetup_here, 20261027204500: here_from_minutes_before = 60).
--
-- The fix: declutter_confirm_handover refuses a meetup's "I got it" until a meeting time is booked
-- (not_booked_yet) and until an hour before it (got_it_too_early), the same hour "I'm here" uses (it reads the
-- same rule, declutter_meetup_rules()).
--
-- A door pickup (pickup_home) gets the same gate (lead decision 2026-10-30: the same payout-clock risk). Measured
-- first that door orders use declutter_bookings the same way: declutter_book_pickup writes slot_start for any
-- handover, and prod's declutter_seller_picked_up already reads declutter_bookings.slot_start for BOTH
-- 'pickup_home' and 'meetup' (not_booked_yet, before_pickup_time). Prod held no paid or handed-over door or meetup
-- order on 2026-10-30 (read-only count), so no waiting order is caught by the new gate.
--
-- Every other handover is unchanged: a porch pickup, a seller delivery (its own delivery-day rule, 20261028202844)
-- and a shipped order (USPS delivered scan, 20261030000030).
--
-- Restated from PROD's effective definition (pg_get_functiondef on fncmgoasalhdgfwzhsqa, read-only, 2026-10-30;
-- it equals 20261030000030's body). Only the meetup/door block is new. Grants restated as prod has them
-- (authenticated, service_role; never PUBLIC or anon).
--
-- Replay-safe: CREATE OR REPLACE only; the body reads declutter_bookings and declutter_meetup_rules(), both
-- defined by earlier migrations (20261015042253, 20261027204500), and only when it runs.

CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_slot timestamptz;
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
  -- A safe meeting spot or a door pickup (audit 1030 DB-3): only with a time booked, and from the hour before it
  -- that "I'm here" opens (declutter_meetup_rules().here_from_minutes_before).
  IF o.handover IN ('meetup', 'pickup_home') THEN
    SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time first.';
    END IF;
    IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN
      RAISE EXCEPTION 'got_it_too_early' USING ERRCODE = '55000',
        HINT = 'You can tap I got it from an hour before the booked time.';
    END IF;
  END IF;
  -- Shipping S2 (review fix 10): a shipped order only after the USPS delivered scan.
  IF o.handover = 'ship' AND NOT EXISTS (
       SELECT 1 FROM public.shipments s
        WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it once the post office scans it as delivered.';
  END IF;
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated, service_role;
