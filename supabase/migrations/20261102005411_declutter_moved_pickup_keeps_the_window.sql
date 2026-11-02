-- A3-63 follow-up (lead 11-01, the owner's porch rule of 1:14 PM): "Move the pickup" offers 2-hour porch windows,
-- and a moved porch pickup stays a 2-hour window.
--
-- Before: declutter_book_pickup booked or moved only declutter_bookings (a 30-minute slot); declutter_orders'
-- pickup_slot_start / _end (the checkout's chosen time, B110 20261101191500, which the order cards and notices read)
-- kept the OLD time. So after a move the cards fell back to "<time> (30 minutes)" for a porch order, and the
-- next-step line and pickup notices described the old time.
-- Now (restated from the newest definition, 20261031145652, verbatim but for the lines marked A3-63):
--   * every booking or move of a porch / door / meetup order also sets the order's pickup_slot_start / _end: a porch
--     window = 2 hours from the start, cut at the end of the seller's hours (declutter_checkout_pickup_end, the
--     checkout's own rule); a door pickup or meetup = 30 minutes; a start outside every window = 30 minutes;
--   * the other side's "Pickup booked / Pickup time changed" notice says a porch window ("Pickup is Sat 11/7, 3–5 PM.").
-- The client's porch picker offers the same 2-hour windows (porchWindowDays, as checkout does).
-- MONEY: none. AUTHZ: unchanged (same caller checks, same grants: authenticated + service_role, never anon).
-- REPLAY-SAFE: CREATE OR REPLACE. Proof: src/test/pglite/declutterMovedPickupKeepsTheWindow.pglite.mjs (3x;
-- NEW_MIGRATION=skip red; planted defects red).

CREATE OR REPLACE FUNCTION public.declutter_book_pickup(p_order_id uuid, p_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_slot_start IS NULL OR p_slot_start <= now() OR p_slot_start + interval '30 minutes' > o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, before the 7-day pickup deadline.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF v_side = 'buyer' THEN
    IF NOT public.declutter_order_slot_in_windows(o.id, o.seller_id, p_slot_start) THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer books the pickup first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, p_slot_start, p_slot_start + interval '30 minutes');
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = p_slot_start, slot_end = p_slot_start + interval '30 minutes', updated_at = now(),
           -- a moved porch slot asks the seller again (row 97)
           porch_mode = NULL, porch_until = NULL,
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  -- A3-63 follow-up (lead 11-01): the order's chosen time follows the booking, so a moved (or later-booked) pickup
  -- keeps the checkout's shape: a porch pickup is the 2-hour window the seller leaves it out for, cut at the end of
  -- the seller's hours (declutter_checkout_pickup_end, 20261101191500); a door pickup or a meetup is the 30-minute
  -- time. A start outside every window (the seller's free-typed move) keeps 30 minutes.
  IF o.handover IN ('porch', 'pickup_home', 'meetup') THEN
    UPDATE public.declutter_orders
       SET pickup_slot_start = p_slot_start,
           pickup_slot_end = COALESCE(public.declutter_checkout_pickup_end(o.id, o.seller_id, o.handover, p_slot_start),
                                      p_slot_start + interval '30 minutes')
     WHERE id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    CASE v_kind WHEN 'booked' THEN 'Pickup booked' ELSE 'Pickup time changed' END,
    -- A porch pickup says its window ("Sat 11/7, 3–5 PM", declutter_pickup_when); the others say the time as before.
    format('Pickup is %s.', CASE WHEN o.handover = 'porch' THEN COALESCE(public.declutter_pickup_when(o.id),
                                   to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM'))
                                 ELSE to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM') END),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'slot_start', p_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) TO authenticated, service_role;
