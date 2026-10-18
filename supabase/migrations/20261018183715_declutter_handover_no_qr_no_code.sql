-- Declutter handover with NO QR code and NO 4-digit code anywhere (owner
-- 2026-10-17 late: "NO QR CODES anywhere"; owner 2026-10-18 pop-ups: Declutter
-- is porch pickup, buyer and seller never meet, "NO QR and NO 4-digit code at
-- all"; big items keep the door pickup without a code; Helpr delivery drops
-- its code too).
--
-- What a handover is now:
--   porch ('porch' orders): the seller's "Left on porch" WITH a photo
--     (declutter_porch_photo, unchanged: photo_not_uploaded without one), then
--     the buyer's "I got it" ('buyer') or "Picked up" photo ('porch'); with
--     neither, the 24 h auto-pay ('auto'), which now NEEDS the set-out photo.
--   door pickup for big items ('pickup_home', porch_ok OFF): the buyer's
--     "I got it" or the seller's "Picked up" (declutter_seller_picked_up, new,
--     photo optional, 'seller'); else the 24 h auto-pay.
--   Helpr delivery: the Helpr's door photo, then the buyer's "I got it"
--     ('customer') or the 24 h auto-pay. No drop-off code.
--   Admin decisions ('admin') unchanged.
--
-- Changes:
--   1. declutter_my_handover: no 'qr', 'code' or 'code_locked'.
--   2. declutter_confirm_handover: only 'buyer'; 'code'/'scan' invalid_method;
--      p_code kept in the signature (an old build still sends it), ignored.
--   3. declutter_seller_picked_up (new): the seller's "Picked up", door
--      pickups only, from the booked pickup time.
--   4. declutter_handovers.confirmed_by: 'scan' gone, 'seller' added. 'code'
--      stays valid for HISTORICAL rows only (measured on prod 2026-10-18
--      18:40Z: 1 order, a test one, is_seed, confirmed_by 'code'); a trigger
--      refuses any NEW 'code' (declutter_no_new_code_confirmation; the
--      next migration puts it on helpr_tasks too).
--   5. declutter_handover_sweep: a porch order is auto-paid only with the
--      seller's set-out photo.
--   6. Helpr delivery without its code is the next migration,
--      20261018184535_declutter_delivery_no_dropoff_code.sql
--      (proven in the delivery PGlite world, which has helpr_tasks).
--   The rows still DRAW codes (declutter_handovers.code, helpr_tasks.dropoff_code,
--   both NOT NULL): nothing reads them any more; left so this migration
--   restates no more money functions than it must.
--
-- Bodies are their newest definitions (20261015042253; the sweep 20261017055505),
-- unchanged except for the lines above. Replay safe: CREATE OR REPLACE, DROP
-- CONSTRAINT / TRIGGER IF EXISTS, grants restated.

CREATE OR REPLACE FUNCTION public.declutter_my_handover(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL OR o.status NOT IN ('paid', 'handed_over') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- No code and no QR reach either side (owner 2026-10-18: porch pickup only).
  RETURN jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'side', v_side,
    'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at,
    'set_out_at', h.set_out_at, 'set_out_photo_path', h.set_out_photo_path,
    'picked_up_at', h.picked_up_at, 'picked_up_photo_path', h.picked_up_photo_path);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_handover(uuid) TO authenticated, service_role;

-- The BUYER confirms by "I got it" ('buyer'). There is no seller-typed code
-- any more; p_code is ignored (kept so an old build's call still parses).
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
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated, service_role;

UPDATE public.declutter_handovers SET confirmed_by = 'code' WHERE confirmed_by = 'scan';
ALTER TABLE public.declutter_handovers DROP CONSTRAINT IF EXISTS declutter_handovers_confirmed_by_check;
ALTER TABLE public.declutter_handovers ADD CONSTRAINT declutter_handovers_confirmed_by_check
  CHECK (confirmed_by IS NULL OR confirmed_by IN ('code', 'buyer', 'seller', 'porch', 'auto', 'admin'));

-- 'code' stays valid in both CHECKs for HISTORICAL rows only (owner
-- 2026-10-18). No new write may record it: these triggers refuse a row that
-- BECOMES 'code' (an existing 'code' row is left alone).
CREATE OR REPLACE FUNCTION public.declutter_no_new_code_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.confirmed_by = 'code' AND (TG_OP = 'INSERT' OR OLD.confirmed_by IS DISTINCT FROM 'code') THEN
    RAISE EXCEPTION 'code_handover_removed' USING ERRCODE = '22023',
      HINT = 'Declutter has no handover code any more (owner 2026-10-18).';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_no_new_code_confirmation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_handovers_no_new_code ON public.declutter_handovers;
CREATE TRIGGER trg_declutter_handovers_no_new_code
  BEFORE INSERT OR UPDATE OF confirmed_by ON public.declutter_handovers
  FOR EACH ROW EXECUTE FUNCTION public.declutter_no_new_code_confirmation();

-- Big items (owner 2026-10-18): an item the seller marked not-for-the-porch
-- (porch_ok OFF) is picked up at the door ('pickup_home'), still with no code.
-- The SELLER may tap "Picked up" (a photo is optional) and that completes it,
-- the same as the buyer's "I got it"; with neither, the 24 h auto-pay. Never
-- for a porch or delivery order, and never over an open problem
-- (declutter_complete_handover refuses problem_open).
CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text)
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
  IF o.handover <> 'pickup_home' THEN
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
  END IF;
  -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
  v_out := public.declutter_complete_handover(o.id, 'seller');
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now()
     WHERE order_id = o.id AND picked_up_photo_path IS NULL;
  END IF;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_picked_up(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_picked_up(uuid, text) TO authenticated, service_role;

-- 5. Porch auto-pay needs the seller's "Left on porch" photo. Restated from
--    its NEWEST definition, 20261017055505, with only that added to the
--    auto-pay loop (its query and its re-check under the lock). No photo, no
--    auto-pay: the buyer's "They didn't show" / "Report a problem" decide it.
CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND b.slot_start IS NOT NULL AND b.slot_start + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover <> 'delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND b.slot_start + interval '24 hours' <= now())
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL)) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover <> 'delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded; the buyer''s fee was not.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;
