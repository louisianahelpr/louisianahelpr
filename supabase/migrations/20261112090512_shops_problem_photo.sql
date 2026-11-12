-- S018 (Shops audit 11-12, Medium): the buyer's problem report ("I didn't get it" / "Something's wrong") takes an
-- optional PHOTO, as L43 ("a problem is reported with a photo") and Declutter's problem report do. An admin sees it
-- beside the note in Admin -> Shops; the shop never sees it.
--
-- Reused, not new (the F389 order-chat photo's conventions, 20261112060000): the PRIVATE shop-handover bucket
-- (image/jpeg, 10 MB, signed URLs only; the app cleans the photo with cleanListingPhoto: metadata/GPS stripped) and its
-- one access helper, with a new folder 'problem': <buyer>/shops/problem/<order>/<file>. The column
-- shop_handovers.problem_photo_path already exists (20261107035259, not granted to authenticated: neither side reads
-- the path) and shops_admin_queue already returns it.
--
--   1. shop_handover_photo_access, restated from 20261018211820 (only the 'problem' arms are new):
--      WRITE 'problem': the caller's own folder, the order's BUYER, while the report is possible (the very rule of
--        shops_report_not_received: charged, accepted, due or marked ready) and no problem is open yet; not banned.
--      READ 'problem': the uploader and an admin. NOT the shop (a buyer's evidence is for the admin who decides).
--      'handover' (the shop's ready photo) is unchanged.
--   2. A DELETE policy: the buyer removes their own UNSENT problem photo (one not on any handover row), so a refused
--      report removes its upload (the client deletes it on refusal, as F389's chat photo).
--   3. shops_report_not_received(order, note, photo_path DEFAULT NULL), restated from 20261112081213 (the newest
--      CREATE): the photo must be the caller's own uploaded 'problem' object for THIS order; it goes on the row only
--      when this report opens the problem (never a photo beside someone else's earlier words, as
--      shop_helpr_answer_no_show). The old 2-arg form is dropped; 2-arg calls resolve through the default.
-- No money moves (the hold is unchanged). AUTHZ: lh-authz-rls. REPLAY-SAFE: CREATE OR REPLACE, DROP ... IF EXISTS,
-- policies dropped and re-created, grants restated.
-- Proof: src/test/pglite/shopsProblemPhoto.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shop_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  v_folder text;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/shops/<handover|problem>/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_name, '/', 3) NOT IN ('handover', 'problem')
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  v_folder := split_part(p_name, '/', 3);
  -- NEW (S018): the buyer's problem photo.
  IF v_folder = 'problem' THEN
    IF p_write THEN
      -- Only the buyer, into their own folder, while shops_report_not_received would take a report.
      RETURN split_part(p_name, '/', 1) = v_uid::text
         AND NOT public.is_caller_banned()
         AND EXISTS (SELECT 1 FROM public.shop_orders o
                       LEFT JOIN public.shop_handovers h ON h.order_id = o.id
                      WHERE o.id = v_order AND o.buyer_id = v_uid
                        AND o.status = 'accepted' AND o.captured_at IS NOT NULL
                        AND (public.shop_local_today() >= o.ready_date OR h.ready_at IS NOT NULL)
                        AND h.problem_at IS NULL);
    END IF;
    -- Read: the uploader and an admin; never the shop.
    RETURN split_part(p_name, '/', 1) = v_uid::text OR public.has_role(v_uid, 'admin');
  END IF;
  IF p_write THEN
    -- Only the shop, into its own folder, for its own charged order not yet handed over.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.shop_orders o
                    WHERE o.id = v_order AND o.seller_id = v_uid AND o.status = 'accepted' AND o.captured_at IS NOT NULL);
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.shop_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_handover_photo_access(text, boolean) TO authenticated, service_role;

-- 2. The buyer's own unsent problem photo may be removed (a refused report cleans up after itself).
CREATE OR REPLACE FUNCTION public.shop_problem_photo_unattached(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_name IS NOT NULL
     AND (SELECT auth.uid()) IS NOT NULL
     AND split_part(p_name, '/', 1) = (SELECT auth.uid())::text
     AND split_part(p_name, '/', 2) = 'shops'
     AND split_part(p_name, '/', 3) = 'problem'
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.problem_photo_path = p_name);
$fn$;
REVOKE ALL ON FUNCTION public.shop_problem_photo_unattached(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_problem_photo_unattached(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "shop-handover: the buyer removes an unsent problem photo" ON storage.objects;
CREATE POLICY "shop-handover: the buyer removes an unsent problem photo" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'shop-handover' AND public.shop_problem_photo_unattached(name));

-- 3. The report takes the photo.
DROP FUNCTION IF EXISTS public.shops_report_not_received(uuid, text);
CREATE OR REPLACE FUNCTION public.shops_report_not_received(p_order_id uuid, p_note text, p_photo_path text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what happened, in under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id FOR UPDATE;
  -- Open: a charged order not handed over yet, from its ready date (or the
  -- shop's ready tap). Once the buyer said "I got it" or the clock finished it,
  -- the order is final.
  IF (o.status = 'accepted' AND o.captured_at IS NOT NULL
      AND (public.shop_local_today() >= o.ready_date OR h.ready_at IS NOT NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000',
      HINT = 'Only a paid order that is due and not picked up can be reported here.';
  END IF;
  -- NEW (S018): the photo, when given, is the caller's own uploaded problem photo for THIS order (exactly
  -- <buyer>/shops/problem/<order>/<file>, the shop-handover bucket).
  IF p_photo_path IS NOT NULL AND NOT (array_length(string_to_array(p_photo_path, '/'), 1) = 5
       AND split_part(p_photo_path, '/', 1) = v_uid::text
       AND split_part(p_photo_path, '/', 2) = 'shops'
       AND split_part(p_photo_path, '/', 3) = 'problem'
       AND split_part(p_photo_path, '/', 4) = o.id::text
       AND split_part(p_photo_path, '/', 5) <> ''
       AND char_length(p_photo_path) <= 300
       AND EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'shop-handover' AND so.name = p_photo_path)) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023', HINT = 'That photo didn''t finish uploading. Try again.';
  END IF;
  -- The photo goes on the row only when this report opens the problem (an open problem keeps its own note and photo).
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note, problem_photo_path) VALUES (o.id, now(), v_note, p_photo_path)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note),
                                       problem_photo_path = CASE WHEN public.shop_handovers.problem_at IS NULL
                                                                 THEN EXCLUDED.problem_photo_path
                                                                 ELSE public.shop_handovers.problem_photo_path END;
  -- S017 (Shops audit 11-12): a service has no pickup, and a delivery is not picked up.
  PERFORM public.declutter_notify(o.seller_id, 'warning',
    CASE WHEN public.shop_order_is_service(o.id) THEN 'Problem reported'
         WHEN o.fulfillment IN ('shop_delivers', 'helpr_delivers') THEN 'Delivery problem reported'
         ELSE 'Pickup problem reported' END,
    CASE WHEN public.shop_order_is_service(o.id) THEN
      format('The buyer says something is wrong with the order for %s. Louisiana Helpr will look at it before anyone is paid.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    ELSE
      format('The buyer says they did not get the order for %s. Louisiana Helpr will look at it before anyone is paid.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/dashboard', o.buyer_id);
  -- Every admin is told (as Declutter's problem reports, 20261017055502): the money waits for them.
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops pickup problem reported',
      'A buyer says they did not get a paid Shops order. The shop''s payout is held until you decide it.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_report_not_received(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_not_received(uuid, text, text) TO authenticated, service_role;

-- lh-authz-rls note: the column now holds a path from one of two buckets, told apart by the second segment
-- (isShopProblemPhotoPath in src/lib/shops/handover.ts).
COMMENT ON COLUMN public.shop_handovers.problem_photo_path IS
  'The problem''s photo: <helpr>/task/<task>/<file> in helpr-tasks (a Helpr''s no-show answer, 20261107035259) or <buyer>/shops/problem/<order>/<file> in shop-handover (the buyer''s report, S018 20261112090512). Admin-only (no member column grant).';
