-- Q2390 packet 32 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   declutter_add_handover (seller; raises at the locked item read, before the
--        item UPDATE, the cart UPDATE and the notices. handoverTalk.ts maps by
--        message.)
--   declutter_refund_paid_order (service_role only; raises at the locked order
--        read, before declutter_record_refund and every UPDATE. The item lock
--        before it writes nothing. No app or edge caller: only the test scripts
--        race-accept.mjs and declutterPayoutProof.mjs, which read no code.)
--   shops_shop_cancel_order (shop; raises at the locked order read, before the
--        lock helper, the UPDATE, the refund row, stock, strike and notices.
--        shop-checkout rpcRefusal already answers PT404 as 404.)
--   declutter_remove_item_photo (seller; both raises come before the DELETE and
--        UPDATEs. The second covers a missing item or one whose photos cannot be
--        removed, with the same 'photo_not_found' message. api.ts maps by message.)
--   shops_report_no_show (shop; raises at the locked order read, before the
--        UPDATE, shop_owe_shop, the strike and notices. shop-checkout rpcRefusal
--        already answers PT404 as 404.)
--   declutter_decline_listed_for_me (seller; raises when its guarded UPDATE
--        matched no row, so nothing was written, before the photo DELETE, the
--        listed-for UPDATE and the Helpr notice. listForSeller.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_add_handover                 20261028235249 26476eaee9c7d5bcc13736aa72bb85ad
--   declutter_refund_paid_order            20261014224914 23ff19078167d577698bd93adca665b1
--   shops_shop_cancel_order                20261019071055 b84fbde740fd6760ca8a0b3fdcf3bddf
--   declutter_remove_item_photo            20261030061927 2561771a8543df13cd300a3cffa1b995
--   shops_report_no_show                   20261019071055 49a9b6969f882dbe6893db384222c070
--   declutter_decline_listed_for_me        20261101054258 e9140cf08d5b64b4f6cab3ad9ddad573
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (7 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod (declutter_refund_paid_order service_role only; the rest
-- authenticated, service_role).

CREATE OR REPLACE FUNCTION public.declutter_add_handover(p_item_id uuid, p_way text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_ways text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_way IS NULL OR p_way NOT IN ('porch', 'seller_delivery', 'meetup', 'delivery') THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
      HINT = 'Add porch pickup, you deliver, a safe meeting spot or Helpr delivery.';
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('live', 'reserved', 'paused') OR v_item.handovers IS NULL THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- A free item is claimed through the free checkout, which takes porch pickup only.
  IF v_item.price_cents = 0 AND p_way <> 'porch' THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023', HINT = 'A free item is picked up from your porch.';
  END IF;
  IF p_way = ANY (v_item.handovers) THEN
    RETURN v_item.handovers;
  END IF;
  SELECT array_agg(DISTINCT w ORDER BY w) INTO v_ways FROM unnest(v_item.handovers || ARRAY[p_way]) AS w;
  UPDATE public.declutter_items
     SET handovers = v_ways, porch_ok = ('porch' = ANY (v_ways)), updated_at = now()
   WHERE id = p_item_id;
  -- The buyer gets at least a day to check out with the new way, and is told.
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET checkout_by = GREATEST(c.checkout_by, now() + interval '24 hours'), reminded_24h_at = NULL, reminded_2h_at = NULL
     WHERE c.item_id = p_item_id AND c.status = 'in_cart'
    RETURNING c.buyer_id
  LOOP
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'The seller added a way to get it',
      format('The seller added %s for "%s". You have at least 24 hours to check out.',
             CASE p_way WHEN 'porch' THEN 'porch pickup' WHEN 'seller_delivery' THEN 'delivery by the seller'
                        WHEN 'meetup' THEN 'a safe meeting spot' ELSE 'Helpr delivery' END, v_item.title),
      '/declutter?view=cart', v_uid);
  END LOOP;
  RETURN v_ways;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_add_handover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_handover(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_paid_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_refund uuid;
  r record;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('seller_backed_out', 'buyer_cancelled') THEN
    RAISE EXCEPTION 'invalid_refund_reason' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'refunded' THEN
    SELECT rf.id INTO v_refund FROM public.declutter_refunds rf WHERE rf.stripe_payment_intent_id = o.stripe_payment_intent_id;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF o.status <> 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN p_reason = 'seller_backed_out' THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN p_reason = 'seller_backed_out' THEN 'withdrawn' ELSE 'live' END,
           updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    IF p_reason = 'seller_backed_out' THEN
      PERFORM public.declutter_give_strike(o.seller_id, 'seller', 'item_gone_after_sale', r.item_id,
        'You backed out of a sale after the buyer paid. The cost of refunding that payment comes out of your next Declutter payout.', r.id);
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN p_reason = 'seller_backed_out'
         THEN format('The seller backed out, so all $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_refund_paid_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_paid_order(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_shop_cancel_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023', HINT = 'Keep the reason under 200 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_reason);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the reason. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'shop_cancelled', decline_reason = v_reason, closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, 'shop_cancelled', v_reason);
  PERFORM public.shop_return_stock(o.id);
  PERFORM public.shop_give_strike(o.seller_id, 'shop', 'shop_cancelled', o.id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled by the shop',
    format('The shop cancelled your order for %s. All $%s is on its way back to your card; card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'))
      || CASE WHEN v_reason IS NOT NULL THEN ' Their note: ' || v_reason ELSE '' END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
    format('You cancelled an accepted order. The buyer gets everything back, the $%s card fee comes out of your next payout, and it counts as a Shops strike.',
           to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_shop_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_cancel_order(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_path text;
  v_item public.declutter_items%ROWTYPE;
  v_listed boolean;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT ph.storage_path INTO v_path
    FROM public.declutter_item_photos ph
    JOIN public.declutter_items i ON i.id = ph.item_id
   WHERE ph.id = p_photo_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT i.* INTO v_item
    FROM public.declutter_items i
   WHERE i.id = (SELECT ph.item_id FROM public.declutter_item_photos ph WHERE ph.id = p_photo_id)
   FOR UPDATE;
  v_listed := v_item.status = 'live'
    OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.declutter_item_private pv
           WHERE pv.item_id = v_item.id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));
  IF v_item.id IS NULL OR (v_item.status <> 'draft' AND NOT v_listed) THEN
    -- As before: only a draft's photo (and now a live listing's) can be removed.
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- A listing on sale keeps at least one photo (declutter_publish_item asks for 1..12).
  IF v_listed AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = v_item.id) <= 1 THEN
    RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023', HINT = 'A listing needs at least one photo.';
  END IF;

  DELETE FROM public.declutter_item_photos WHERE id = p_photo_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = v_item.id;

  IF v_item.status = 'live' THEN
    FOR r IN
      SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
       WHERE o.item_id = v_item.id AND o.status = 'open'
    LOOP
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
        format('The seller updated "%s". Check it before your offer is answered.', v_item.title),
        '/declutter/item/' || v_item.id::text, v_uid);
    END LOOP;
    UPDATE public.declutter_items
       SET status = 'pending_review', submitted_at = now(), updated_at = now()
     WHERE id = v_item.id;
  END IF;
  RETURN v_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_item_photo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_owed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  IF o.handover_mode <> 'in_person' THEN
    RAISE EXCEPTION 'not_in_person' USING ERRCODE = '55000',
      HINT = 'A left-out order cannot be a no-show; it finishes on its own after the ready date.';
  END IF;
  -- Only an order the shop marked ready (/code-review of shops-m3-v1 #2): a shop
  -- that never said "it's ready" cannot say the buyer failed to come for it.
  IF NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_ready' USING ERRCODE = '55000',
      HINT = 'Mark the order ready first. A no-show can only be reported for an order you had ready.';
  END IF;
  IF now() < ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') THEN
    RAISE EXCEPTION 'too_early_for_no_show' USING ERRCODE = '55000',
      HINT = 'You can report a no-show once the ready date is over.';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.shop_give_strike(o.buyer_id, 'buyer', 'buyer_no_show', o.id);
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Missed pickup',
    format('The shop says you did not pick up your order for %s. A missed pickup counts as a late cancel: nothing is refunded and the shop is paid. If you did pick it up, contact Louisiana Helpr support.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'No-show recorded',
    format('You are paid for the order ($%s).', to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'no_show', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_no_show(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_decline_listed_for_me(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_link record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_items i SET status = 'withdrawn', updated_at = now()
    FROM public.declutter_listed_for_seller l
   WHERE i.id = p_item_id AND l.item_id = i.id AND i.seller_id = v_uid AND l.seller_id = v_uid
     AND i.status = 'pending_seller_approval';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- B63: a declined listing is never shown again, so its photos are detached like a withdraw's; the AFTER DELETE
  -- trigger queues their objects (they sit in the HELPR's folder, which the seller's app cannot delete).
  DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
  UPDATE public.declutter_listed_for_seller l SET decided_at = now() WHERE l.item_id = p_item_id
  RETURNING l.job_id, l.helpr_id, (SELECT i.title FROM public.declutter_items i WHERE i.id = l.item_id) AS title,
            (SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = l.seller_id) AS seller_name
    INTO v_link;
  -- Tell the Helpr who wrote it (B55 open item e). In-app only, on their job. Test data never reaches a real member:
  -- a seed seller's decline is not sent to a Helpr who is not seed.
  IF v_link.helpr_id IS NOT NULL
     AND NOT (EXISTS (SELECT 1 FROM public.profiles s WHERE s.user_id = v_uid AND s.is_seed)
              AND NOT EXISTS (SELECT 1 FROM public.profiles h WHERE h.user_id = v_link.helpr_id AND h.is_seed)) THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_link.helpr_id, 'A listing wasn''t used',
              format('%s chose not to put "%s" on sale. Nothing else changes for your job.',
                     COALESCE(v_link.seller_name, 'The seller'), v_link.title),
              'job_update', '/jobs?job=' || v_link.job_id::text, v_link.job_id);
    EXCEPTION WHEN OTHERS THEN
      -- The decline already happened; a lost notice must not undo it. Logged where ops reads.
      PERFORM public.log_cron_defect('declutter_decline_listed_for_me', p_item_id::text, SQLERRM,
        jsonb_build_object('helpr_id', v_link.helpr_id, 'job_id', v_link.job_id));
    END;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_decline_listed_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_decline_listed_for_me(uuid) TO authenticated, service_role;
