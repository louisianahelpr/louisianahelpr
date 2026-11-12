-- Shops audit 11-12, Builder 1 (Shops DB lane): three owner/admin-side fixes.
--   S007 shops_admin_pending_items: DROP + CREATE (one new output column, so the return type changes), VERBATIM from
--        20261030015205 plus is_seed = the item, its shop or its owner (is_test_subject) is test. The owner's new-items
--        card (ShopItemsReviewCard) drops those rows with withoutTestRows, as the paperwork card does. Test data never
--        shows to the owner (owner 10-25 / 10-27 / 11-04).
--   S008 shops_admin_review_item: VERBATIM from 20261104175521 plus a notice to the seller on approve ("Your item is
--        live") and on reject ("Your item wasn't approved", with the admin's note and the 30-day line). The link is
--        /shops/mine, so declutter_notice_type files both as shops_updates (the seller's Shops updates switch).
--   S048 shops_report_not_received: VERBATIM from 20261112090512 (newest) plus the explicit test skip on the admin
--        alert, same predicate as the download-problem alert (20261108185110).
-- Notice words are English, like every other server-written Shops notice (no server path translates in-app notices yet).
-- MONEY: none. AUTHZ: lh-authz-rls (admin-only read gains a column; definer notice to the item's owner only).
-- REPLAY-SAFE: DROP FUNCTION IF EXISTS + CREATE, CREATE OR REPLACE; REVOKE/GRANT restated as before.
-- Proof: src/test/pglite/shopsOwnerReviewNotices.pglite.mjs (3x; NEW_MIGRATION=skip red).

DROP FUNCTION IF EXISTS public.shops_admin_pending_items();
CREATE OR REPLACE FUNCTION public.shops_admin_pending_items()
 RETURNS TABLE(item_id uuid, shop_id uuid, shop_name text, owner_id uuid, kind text, subtype text, title text, description text, price_cents integer, submitted_at timestamptz, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text, approved_items integer, photo_paths text[], owner_last_rejected_at timestamptz, owner_last_rejection_note text, is_seed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('shops');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Test data never counts (b62): "approved items" drops test items. The
  -- pending list keeps every item and says which are test (is_seed, S007), so
  -- the owner's card drops them while a test admin's run can still see its own.
  RETURN QUERY
    SELECT i.id, i.shop_id, s.name, i.owner_id, i.kind, i.subtype, i.title, i.description, i.price_cents,
           i.submitted_at, p.ai_checked_at, p.ai_flag_reason, p.text_flag_reason,
           (SELECT count(*)::integer FROM public.shop_items a
             WHERE a.shop_id = i.shop_id AND a.admin_approved_at IS NOT NULL AND a.is_seed IS NOT TRUE),
           (SELECT COALESCE(array_agg(ph.storage_path ORDER BY ph.position), ARRAY[]::text[])
              FROM public.shop_item_photos ph WHERE ph.item_id = i.id),
           rj.created_at, rj.details->>'note',
           -- NEW (S007): a test item, a test shop or a test owner; the card drops it (withoutTestRows).
           (i.is_seed OR s.is_seed OR public.is_test_subject(i.owner_id))
      FROM public.shop_items i
      JOIN public.shops s ON s.id = i.shop_id
      LEFT JOIN public.shop_item_private p ON p.item_id = i.id
      LEFT JOIN LATERAL (
        SELECT l.created_at, l.details FROM public.admin_audit_log l
         WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = i.owner_id::text
           AND l.created_at > now() - interval '30 days'
         ORDER BY l.created_at DESC LIMIT 1) rj ON true
     WHERE i.status = 'pending_review'
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_pending_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_pending_items() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_shop uuid;
  v_kind text;
  v_submitted timestamptz;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_title text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023',
      HINT = 'Say why the item is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id, shop_id, kind, submitted_at, title INTO v_owner, v_shop, v_kind, v_submitted, v_title
    FROM public.shop_items WHERE id = p_item_id AND status = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  IF v_submitted IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'item_changed' USING ERRCODE = '22023',
      HINT = 'The owner changed this item after you opened it. Reload and review it again.';
  END IF;
  -- An admin never reviews their own item.
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '42501', HINT = 'Another admin must review your own item.';
  END IF;
  -- Approval puts the item in front of members NOW, so the owner must still
  -- be allowed to sell now (not banned, under 3 marketplace strikes, 18+,
  -- payouts set up), the shop must not be hidden, and a home-food item's
  -- owner must not be at the yearly limit.
  IF p_approve AND (
       public.shop_owner_sell_block_reason(v_owner) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v_shop AND s.hidden_at IS NULL AND s.offers_selling)
       OR (v_kind = 'home_food' AND public.shop_cottage_cap_reached(v_owner))) THEN
    RAISE EXCEPTION 'owner_not_eligible' USING ERRCODE = '22023',
      HINT = 'The shop cannot sell right now (restricted, strikes, age, payouts, hidden or at the home-food limit). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.shop_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_item_private
     SET review_note = v_note,
         admin_rejected_at = CASE WHEN p_approve THEN NULL ELSE now() END,
         updated_at = now()
   WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'shop_item_approved' ELSE 'shop_item_rejected' END,
          'shop_item', p_item_id::text,
          -- owner_id is what shops_publish_item's 30-day hold reads.
          jsonb_build_object('note', v_note, 'owner_id', v_owner, 'shop_id', v_shop));
  -- NEW (S008): the seller hears the decision (the editor promised "It shows on your shop once approved").
  IF p_approve THEN
    PERFORM public.declutter_notify(v_owner, 'info', 'Your item is live',
      left(format('"%s" is live on your shop. Buyers can order it now.', v_title), 1000), '/shops/mine');
  ELSE
    PERFORM public.declutter_notify(v_owner, 'warning', 'Your item wasn''t approved',
      left(format('We didn''t approve "%s". Why: %s. For the next 30 days, your new items get a quick check before they show.',
                  v_title, rtrim(v_note, '.')), 1000), '/shops/mine');
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamp with time zone) TO authenticated, service_role;

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
  -- NEW (S048): test data never reaches one (owner rule), the same explicit skip as the download alert (20261108185110).
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops pickup problem reported',
        'A buyer says they did not get a paid Shops order. The shop''s payout is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_report_not_received(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_not_received(uuid, text, text) TO authenticated, service_role;
