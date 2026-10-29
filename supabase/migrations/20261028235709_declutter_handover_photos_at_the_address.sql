-- Anti-lying #1, "Photos taken at the address" (owner 2026-10-28, ~/.lh-wt/declutter-next-queue-1028.md item 1):
-- every handover photo is checked against the right address's location, as the buyer's porch "Picked up" photo
-- (declutter_porch_photo, buyer side) and the Helpr's pickup, drop-off and seller-away photos (helpr_task_picked_up,
-- helpr_task_delivered, helpr_task_pickup_no_show) already are: the device's position, within 200 m, else refused;
-- only the distance is kept, never the position.
--
-- WHY: three handover photos were taken with no location at all, so a seller could "leave it" from anywhere:
--   1. declutter_porch_photo, SELLER side ("Left on porch"): the photo that lets the seller be paid automatically.
--   2. declutter_seller_delivered ("Delivered" / "Handed over", seller delivery): the "left at your door" photo.
--   3. declutter_seller_picked_up ("Picked up" at the door or a safe meeting spot): its optional photo.
--
-- WHAT CHANGES (each restated from its newest definition, only the lines named here added):
--   1. declutter_porch_photo (20261028225038_declutter_porch_pick_a_day.sql): the seller's photo needs a location
--      (location_required) within 200 m of the order's nearest item pickup point (the buyer side's own sum), else
--      not_at_pickup. The distance is stored (declutter_handovers.set_out_distance_m, new).
--   2. declutter_seller_delivered (20261027153244_declutter_seller_delivery.sql): takes p_lat, p_lng (DEFAULT NULL,
--      so an old build's two-argument call still resolves to it and is then refused for a photo with no place).
--      A photo needs a location within 200 m of the buyer's drop-off point (declutter_seller_deliveries.dropoff_lat
--      / dropoff_lng), else not_at_dropoff. The distance is stored (set_out_distance_m).
--   3. declutter_seller_picked_up (20261027204500_declutter_safe_meetup.sql): takes p_lat, p_lng (DEFAULT NULL).
--      A photo (still optional, owner 2026-10-18) needs a location within 200 m of the meeting spot frozen on the
--      order (declutter_order_meetups) for a meetup, else not_at_meetup; or of the nearest item pickup point for a
--      door pickup, else not_at_pickup. No photo: unchanged. The distance is stored (picked_up_distance_m).
-- The two-argument forms are DROPPED (a second overload would leave an unchecked way in, and PostgREST could not
-- choose between them with defaults). No SQL calls either; the client calls them by name.
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterHandoverPhotosAtAddress.pglite.mjs. Guard: src/test/handoverPhotosAtTheAddress.test.ts.

ALTER TABLE public.declutter_handovers ADD COLUMN IF NOT EXISTS set_out_distance_m integer
  CHECK (set_out_distance_m IS NULL OR set_out_distance_m >= 0);

-- 1. The seller's porch photo.
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
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of ANY item in the order
  -- (authz review 2.7: the exact address is per item, so a multi-item order
  -- may have more than one; the first item alone refused a buyer standing at
  -- another item's address).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - p.pickup_lat) / 2)), 2)
           + cos(radians(p.pickup_lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - p.pickup_lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = o.id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
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

-- 2. The seller's "Delivered" / "Handed over" photo on a seller delivery: at the buyer's drop-off point.
DROP FUNCTION IF EXISTS public.declutter_seller_delivered(uuid, text);
CREATE OR REPLACE FUNCTION public.declutter_seller_delivered(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
  v_m integer;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_start THEN
    RAISE EXCEPTION 'before_delivery_time' USING ERRCODE = '55000',
      HINT = 'You can mark it delivered from the booked delivery time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RETURN jsonb_build_object('result', 'delivered');
  END IF;
  IF (p_photo_path IS NULL AND d.handoff = 'leave') OR (p_photo_path IS NOT NULL AND (
        split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path))) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- A photo is taken at the buyer's drop-off point (20261028235709), as a Helpr's drop-off photo is.
  IF p_photo_path IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, d.dropoff_lat, d.dropoff_lng);
    IF v_m IS NULL OR v_m > 200 THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the buyer''s address.';
    END IF;
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id AND confirmed_at IS NULL;
  END IF;
  UPDATE public.declutter_seller_deliveries SET delivered_at = now(), proposed_start = NULL, proposed_by = NULL, proposed_at = NULL,
         updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your items were delivered',
    CASE WHEN d.handoff = 'hand' THEN 'The seller says they handed you your items. Tap "I got it". If something is wrong, report a problem within 24 hours; after that the seller is paid.'
         ELSE 'The seller left your items at your door and took a photo. Tap "I got it" when you have them. If something is wrong, report a problem within 24 hours; after that the seller is paid.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'delivered');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivered(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivered(uuid, text, numeric, numeric) TO authenticated, service_role;

-- 3. The seller's "Picked up" photo at the door or a safe meeting spot.
DROP FUNCTION IF EXISTS public.declutter_seller_picked_up(uuid, text);
CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_out jsonb;
  v_m integer;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Q2425: handing it over at a safe meeting spot is the same act as at the door.
  IF o.handover NOT IN ('pickup_home', 'meetup') THEN
    RAISE EXCEPTION 'not_a_door_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Not before the booked time (lh-money-escrow review #1): the seller cannot
  -- mark it picked up, and be paid, before the buyer could have come.
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN
    RAISE EXCEPTION 'before_pickup_time' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up from the booked pickup time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(p_photo_path, '/', 5) = ''
       OR split_part(p_photo_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    -- A photo is taken where the handover is (20261028235709): the meeting spot frozen on the order, or the
    -- nearest item pickup point of a door pickup.
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF o.handover = 'meetup' THEN
      SELECT public.helpr_task_distance_m(p_lat, p_lng, m.spot_lat, m.spot_lng) INTO v_m
        FROM public.declutter_order_meetups m WHERE m.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_meetup' USING ERRCODE = '22023', HINT = 'Take the photo at the meeting spot.';
      END IF;
    ELSE
      SELECT min(public.helpr_task_distance_m(p_lat, p_lng, p.pickup_lat, p.pickup_lng)) INTO v_m
        FROM public.declutter_cart_items c
        JOIN public.declutter_item_private p ON p.item_id = c.item_id
       WHERE c.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
      END IF;
    END IF;
  END IF;
  -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
  v_out := public.declutter_complete_handover(o.id, 'seller');
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
     WHERE order_id = o.id AND picked_up_photo_path IS NULL;
  END IF;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_picked_up(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_picked_up(uuid, text, numeric, numeric) TO authenticated, service_role;
