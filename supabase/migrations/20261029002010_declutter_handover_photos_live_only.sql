-- Anti-lying #2, "Live camera only" (owner 2026-10-28, ~/.lh-wt/declutter-next-queue-1028.md item 2): a handover
-- photo comes from the camera at that moment, and the server's own clock says so; an older photo is refused in plain
-- words.
--
-- WHY: a handover photo (the seller's "Left on porch" / "left at your door" / "Picked up", the buyer's porch "Picked
-- up", a Helpr's pickup, drop-off and seller-away photos) was accepted however old it was: a photo uploaded days
-- before, or one from the camera roll, proved nothing about the handover.
--
-- WHAT CHANGES:
--   * handover_photo_is_fresh(bucket, path): true only when that storage object was uploaded in the last 10
--     minutes, by storage.objects.created_at (set by the storage server at upload, not by the app). Internal: no
--     member may call it (REVOKE FROM PUBLIC, anon, authenticated).
--   * Every handover photo RPC refuses a photo uploaded more than 10 minutes before the step with photo_too_old
--     (22023, plain words in the app): declutter_porch_photo (both sides), declutter_seller_delivered and
--     declutter_seller_picked_up (when a photo is sent), each restated from 20261028235709 with only that check
--     added; and the Helpr's helpr_task_picked_up, helpr_task_delivered and helpr_task_pickup_no_show through the
--     one path check they all call, helpr_task_photo_ok (restated from 20261017055505: it now raises photo_too_old
--     for a stale object of the caller's own task folder; a wrong path still answers false -> photo_not_uploaded).
--   * The step's own time is the server's (now(): set_out_at, picked_up_at, delivered_at), so the photo time the
--     app shows is the server's, within 10 minutes of the upload.
-- The app checks the same on the device first (the photo file's own time, src/lib/declutter/livePhoto.ts) and
-- opens the camera, never the photo library (capture="environment" on every handover photo input).
-- REPLAY-SAFETY: CREATE OR REPLACE only.
-- Proof: src/test/pglite/declutterHandoverPhotosLive.pglite.mjs. Guard: src/test/handoverPhotosAreLive.test.ts.

CREATE OR REPLACE FUNCTION public.handover_photo_is_fresh(p_bucket text, p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- NULL in, false out; no object, false.
  SELECT COALESCE((SELECT so.created_at > now() - interval '10 minutes'
                     FROM storage.objects so WHERE so.bucket_id = p_bucket AND so.name = p_path LIMIT 1), false);
$fn$;
REVOKE ALL ON FUNCTION public.handover_photo_is_fresh(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handover_photo_is_fresh(text, text) TO service_role;

-- The Helpr's task photos (pickup, drop-off, seller away): the one path check they all call.
CREATE OR REPLACE FUNCTION public.helpr_task_photo_ok(p_task uuid, p_uid uuid, p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_task IS NULL OR p_uid IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;
  IF NOT (split_part(p_path, '/', 1) = p_uid::text
     AND split_part(p_path, '/', 2) = 'task'
     AND split_part(p_path, '/', 3) = p_task::text
     AND split_part(p_path, '/', 4) <> ''
     AND split_part(p_path, '/', 5) = ''
     AND EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'helpr-tasks' AND so.name = p_path)) THEN
    RETURN false;
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('helpr-tasks', p_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_photo_ok(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_photo_ok(uuid, uuid, text) TO service_role;

-- 1. The porch photo, both sides.
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

-- 2. The seller-delivery photo.
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
    -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
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

-- 3. The seller's door / meeting-spot photo.
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
    -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
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
