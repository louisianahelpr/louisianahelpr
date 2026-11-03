-- BUY-17 (Declutter buying audit 10-30 #17; owner decision 11-03 ~2:45 PM, OWNER-DECISIONS.md): on a porch pickup
-- the buyer's "I got it" waits until the seller's porch photo is in. Until now only the client waited, and only until
-- the pickup day (A1-C2), so a tap on the day finished the sale and started the seller's pay on an item nobody had
-- put out. declutter_confirm_handover is restated from 20261031004529 with one new refusal (porch_photo_not_in) after
-- the side check; every other line is unchanged. declutter_porch_photo is restated from 20261102113853 with the same
-- refusal for the BUYER's "Picked up" photo, which also finishes the sale (lead call 11-03, owner may reverse); the
-- seller's own photo is unchanged. Replay-safe (CREATE OR REPLACE), grants restated.

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
  -- BUY-17 (owner 11-03): on a porch pickup the buyer's "I got it" waits for the seller's porch photo
  -- (declutter_handovers.set_out_at), whatever the day: before it, nobody has said the item is out, and the tap
  -- pays the seller. The buyer can still report a problem (declutter_report_problem is not gated here).
  IF o.handover = 'porch' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'porch_photo_not_in' USING ERRCODE = '22023',
      HINT = 'You can tap I got it once the seller posts the porch photo.';
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
  -- CHANGED (owner 10-30): the buyer's tap is enough, even on a sale held 60 days: that problem is nobody's report, and
  -- the buyer has just spoken. Any other open problem still holds it (declutter_complete_handover refuses).
  UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now()
   WHERE order_id = o.id AND status = 'open' AND reporter_side = 'system';
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
  v_day date;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Audit 1a #4 (20261029201542): the seller puts it out ON the buyer's booked day, never before, so the buyer is
  -- not told to come early and the payout clock does not start early. The day is the booking's porch day, else the
  -- Louisiana date of an older timed booking's slot.
  IF v_side = 'seller' THEN
    SELECT COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date) INTO v_day
      FROM public.declutter_bookings b WHERE b.order_id = o.id;
    -- Fail closed: no day read (not_booked_yet above should make that impossible) is refused too, never waved through.
    IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
      RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000',
        HINT = format('Put it out on %s, the day the buyer picked.', to_char(v_day, 'FMDay, Mon FMDD'));
    END IF;
  END IF;
  -- BUY-17 (owner 11-03, lead call the same hour): the buyer's "Picked up" photo finishes the sale and pays the
  -- seller like "I got it" does, so it waits for the seller's porch photo too (same refusal, same reason).
  IF v_side = 'buyer' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'porch_photo_not_in' USING ERRCODE = '22023',
      HINT = 'You can take your pickup photo once the seller posts the porch photo.';
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of the ORDER (D-NEW14, 20261030164712): the porch place frozen
  -- on it at checkout, else (an order with no place) every item's own point, as before (authz review 2.7).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out', 'distance_m', v_m);
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so Louisiana Helpr decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;
