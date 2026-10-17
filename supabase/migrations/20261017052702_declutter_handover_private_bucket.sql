-- Declutter porch and problem photos move to a PRIVATE bucket (lh-authz-rls
-- review of slice 4, should-fix (a); docs/specs/declutter-auctions.md "Open
-- after slice 4").
--
-- WHAT WAS WRONG: the seller's porch "Set out" photo (a picture of their home),
-- the buyer's "Picked up" photo and problem photos were stored in job-photos,
-- which is a PUBLIC bucket (storage.buckets.public = true on prod, measured
-- 2026-10-15). declutter_my_handover hands the path to the other side, and a
-- public URL never expires: a refunded buyer, or anyone the link reaches, keeps
-- a working link to a photo of the seller's porch.
--
-- WHAT THIS DOES:
-- 1. A private bucket, declutter-handover (public = false, images only, 10 MB).
--    Objects live at <uid>/declutter/handover/<order id>/<file> and
--    <uid>/declutter/problem/<order id>/<file>, the paths the RPCs already
--    require. Served only by signed URL (createSignedUrl), never a public URL.
-- 2. storage.objects policies for that bucket, decided by
--    declutter_handover_photo_access(name, write):
--      INSERT  a party of the order (buyer or seller), into their OWN <uid>
--              folder only, while the order is 'paid' (the seller's "Set out",
--              the buyer's "Picked up", either side's problem photos); the path
--              must be exactly 5 segments;
--      SELECT  the two parties of the order, and admins;
--      no UPDATE or DELETE for members (evidence stays put, as in slice 4's
--      job-photos rule); account deletion purges with the service role.
-- 3. declutter_porch_photo and declutter_report_problem (restated from their
--    NEWEST bodies, 20261015042253, verbatim) accept a photo only when it is
--    in declutter-handover (was job-photos).
--
-- Existing objects: none to move. Measured read-only on prod 2026-10-15
-- ~09:30Z: storage.objects in job-photos under */declutter/handover/* or
-- */declutter/problem/* = 0, any */declutter/* object = 0, and the Declutter
-- tables are not on prod yet (to_regclass('public.declutter_handovers') NULL).
--
-- Replay-safe: ON CONFLICT on the bucket, DROP POLICY IF EXISTS, CREATE OR
-- REPLACE. The helper is EXECUTE for authenticated (storage policies run as the
-- caller) and revoked from PUBLIC and anon.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('declutter-handover', 'declutter-handover', false, 10 * 1024 * 1024, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Who may write (p_write) or read an object of the bucket, from its path alone.
CREATE OR REPLACE FUNCTION public.declutter_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/declutter/<handover|problem>/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_name, '/', 3) NOT IN ('handover', 'problem')
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = ''
     OR split_part(p_name, '/', 6) <> '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  IF p_write THEN
    -- Only into your own folder, only for an order you are a party of, and
    -- only while it is paid (both RPCs take a photo only then; lh-authz-rls
    -- review of lane J, should-fix 2: no uploads to a refunded or closed order).
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_order AND o.status = 'paid' AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_handover_photo_access(text, boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS "declutter-handover: a party uploads into their own folder" ON storage.objects;
CREATE POLICY "declutter-handover: a party uploads into their own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'declutter-handover' AND public.declutter_handover_photo_access(name, true));

DROP POLICY IF EXISTS "declutter-handover: the two parties and admins read" ON storage.objects;
CREATE POLICY "declutter-handover: the two parties and admins read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'declutter-handover' AND public.declutter_handover_photo_access(name, false));

-- The two RPCs that take a photo path: restated from 20261015042253 verbatim,
-- the object must now be in declutter-handover.

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
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on the porch',
      'The seller set your item out. Take a photo when you pick it up.', '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out');
  END IF;
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

CREATE OR REPLACE FUNCTION public.declutter_report_problem(p_order_id uuid, p_reason text, p_note text, p_photo_paths text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_id uuid;
  v_path text;
  a record;
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
    RAISE EXCEPTION 'sale_final' USING ERRCODE = '55000', HINT = 'The seller was paid, so this sale is final.';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT p.id INTO v_id FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received', 'no_show', 'safety', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 6 THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
       OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(v_path, '/', 5) = ''
       OR split_part(v_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
  VALUES (o.id, v_uid, v_side, p_reason, btrim(p_note), COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'warning',
    'A problem was reported on your sale',
    'The money stays held until Louisiana Helpr looks at it. We may ask you for photos.',
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
      'A buyer or seller reported a problem on a paid sale. The money is held until you decide it.', '/admin');
  END LOOP;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) TO authenticated, service_role;
