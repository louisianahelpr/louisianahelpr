-- S011 + S017 (Shops audit 11-12, Mediums): notice words that were wrong for the money or the kind of order.
-- S011: the shop's "Order picked up / finished" notice promised the whole amount "on its way", but the one-time $2 setup
--   fee comes out of the first payout (shop_payout_take_setup_fee) and a payout waits for the ID check
--   (payout_waits_on_identity, declutter-money). It now names the amount that will really be sent, says the setup fee
--   was taken out, and says "Verify your ID" while the payout waits for it. Nothing about the payout row changes.
-- S017: server notices said "ready to pick up at the shop", "handed over" and "Pickup problem reported" on services
--   and deliveries. They now follow src/lib/shops/handoverWords.ts: a service (a service line or work at the buyer's
--   place; rentals keep the goods words) is "done" with "It's done" / "Something's wrong"; a delivery is "delivered".
--   Titles the email trigger reads ('Your order is ready') are unchanged.
-- New: shop_order_is_service(order) = the client's isServiceOrder. Restated from their NEWEST CREATE (only the
--   S011/S017 lines change): shops_mark_ready 20261105190034, shops_mark_handed_over 20261112075006,
--   shops_report_not_received 20261103173728, shop_complete_handover 20261109224952.
-- MONEY: words only, plus a read of the setup fee and the ID wait (lh-money-escrow). AUTHZ: one service_role helper;
--   CREATE OR REPLACE keeps grants (lh-authz-rls). REPLAY-SAFE: CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsNoticeWords.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shop_order_is_service(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.shop_order_lines l
                  WHERE l.order_id = p_order_id AND (l.kind = 'service' OR COALESCE(l.at_buyer, false)));
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_is_service(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_is_service(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_was_ready timestamptz;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet. Mark the order ready once it is.';
  END IF;
  IF p_photo_path IS NULL AND o.handover_mode = 'in_person' THEN
    NULL;  -- in person: the photo is optional
  ELSIF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'shop-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023', HINT = 'Take a photo of the order first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  SELECT h.ready_at INTO v_was_ready FROM public.shop_handovers h WHERE h.order_id = o.id;
  -- A retake replaces the photo but keeps the first ready time (the clock never moves later) and tells nobody again.
  INSERT INTO public.shop_handovers (order_id, ready_photo_path, ready_at) VALUES (o.id, p_photo_path, now())
  ON CONFLICT (order_id) DO UPDATE
    SET ready_photo_path = COALESCE(EXCLUDED.ready_photo_path, public.shop_handovers.ready_photo_path),
        ready_at = COALESCE(public.shop_handovers.ready_at, EXCLUDED.ready_at)
   WHERE public.shop_handovers.confirmed_at IS NULL;
  IF v_was_ready IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
  END IF;
  -- H5 review note: the ready notice says the buyer's 48 hours. Left out, they run from the later of this photo and
  -- the start of the ready date (shop_handover_sweep (a)), so the notice names that exact moment, Louisiana time.
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your order is ready',
    CASE WHEN o.handover_mode = 'porch'
      THEN format('Your order for %s is left out for you. Tap "I got it" when you have it. If it isn''t there, tap "I didn''t get it" by %s; after that the shop is paid.',
                  to_char(o.ready_date, 'FMMonth FMDD'),
                  to_char((greatest(now(), (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours') AT TIME ZONE 'America/Chicago',
                          'FMDay, FMMonth FMDD at FMHH12:MI AM'))
      -- S017 (Shops audit 11-12): a service, a shop delivery or a Helpr delivery is not "ready to pick up at the shop".
      WHEN public.shop_order_is_service(o.id) THEN format('The shop is ready for your order for %s. Once the work is done, tap "It''s done". Once the shop marks it done, you have 48 hours to tap "Something''s wrong" if it isn''t; after that the shop is paid.', to_char(o.ready_date, 'FMMonth FMDD'))
      WHEN o.fulfillment = 'shop_delivers' THEN format('Your order for %s is ready, and the shop will deliver it. Tap "I got it" when you have it. Once the shop marks it delivered, you have 48 hours to tap "I didn''t get it" if you don''t have it; after that the shop is paid.', to_char(o.ready_date, 'FMMonth FMDD'))
      WHEN o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN format('Your order for %s is ready, and a Helpr will deliver it.', to_char(o.ready_date, 'FMMonth FMDD'))
      ELSE format('Your order for %s is ready to pick up at the shop. Tap "I got it" when you have it. Once the shop marks it handed over, you have 48 hours to tap "I didn''t get it" if you don''t have it; after that the shop is paid.', to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_mark_handed_over(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet, so this order cannot be handed over.';
  END IF;
  -- S015 (Shops audit 11-12): on a Helpr-delivered order the Helpr's drop-off is the handover (the buyer's or the
  -- task's confirm completes it), so the shop's own "Handed over" tap would start the 48-hour auto-pay even if the
  -- Helpr never delivered. Refused, unless no Helpr took it and it became a pickup (helpr_unfilled_at).
  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN
    RAISE EXCEPTION 'helpr_delivers_handover' USING ERRCODE = '55000',
      HINT = 'A Helpr delivers this order. It finishes when the buyer has it, so there is nothing to mark.';
  END IF;
  IF o.handover_mode = 'porch' THEN
    RAISE EXCEPTION 'porch_uses_photo' USING ERRCODE = '22023',
      HINT = 'This order is left out for pickup. Take the ready photo instead; it tells the buyer.';
  END IF;
  IF public.shop_local_today() < o.ready_date THEN
    RAISE EXCEPTION 'not_ready_date_yet' USING ERRCODE = '55000',
      HINT = 'You can mark it handed over from the ready date on.';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id;
  IF h.problem_at IS NOT NULL THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  IF h.shop_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_marked', 'order_id', o.id);
  END IF;
  INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES (o.id, now())
  ON CONFLICT (order_id) DO UPDATE SET shop_confirmed_at = now()
   WHERE public.shop_handovers.shop_confirmed_at IS NULL AND public.shop_handovers.confirmed_at IS NULL;
  -- S017 (Shops audit 11-12): a service is "done" ("It's done" / "Something's wrong"), a shop delivery "delivered".
  PERFORM public.declutter_notify(o.buyer_id, 'payment',
    CASE WHEN public.shop_order_is_service(o.id) THEN 'The shop says the work is done' ELSE 'The shop says you have your order' END,
    CASE
      WHEN public.shop_order_is_service(o.id) THEN
        format('The shop marked your order for %s as done. If it is, tap "It''s done". If something''s wrong, tap "Something''s wrong" within 48 hours; after that the shop is paid.',
               to_char(o.ready_date, 'FMMonth FMDD'))
      WHEN o.fulfillment = 'shop_delivers' THEN
        format('The shop marked your order for %s as delivered. If you have it, tap "I got it". If you didn''t get it, tap "I didn''t get it" within 48 hours; after that the shop is paid.',
               to_char(o.ready_date, 'FMMonth FMDD'))
      ELSE
        format('The shop marked your order for %s as handed over. If you have it, tap "I got it". If you didn''t get it, tap "I didn''t get it" within 48 hours; after that the shop is paid.',
               to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'marked', 'order_id', o.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.shops_report_not_received(p_order_id uuid, p_note text)
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
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES (o.id, now(), v_note)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
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
REVOKE ALL ON FUNCTION public.shops_report_not_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_not_received(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
  v_send integer;
  v_setup_fee integer := 0;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  -- CHANGED (digital, owner 11-08): a download is final 72 hours after its charge (the sweep, 'auto'), or by an admin.
  -- The buyer's "I got it" and the shop's taps do not apply to a file.
  IF o.is_digital AND p_how = 'buyer' THEN
    RAISE EXCEPTION 'digital_no_pickup' USING ERRCODE = '55000', HINT = 'A download has no pickup to confirm.';
  END IF;
  IF o.is_digital AND p_how = 'auto' AND o.captured_at + interval '72 hours' > now() THEN
    RAISE EXCEPTION 'too_soon' USING ERRCODE = '55000', HINT = 'A download is paid out 72 hours after the sale.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Our team decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- Delivery (20261106180902, 20261106194913): the shop is paid its items, and its own delivery fee only when IT
  -- delivered (shop_delivers); a Helpr's pay comes from helpr_task_payouts. shop_payouts.items_cents carries what
  -- the shop is owed, so shop_payouts_amount (amount = items - debt) is unchanged.
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END), v_debt, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt,
          CASE WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  -- S011 (Shops audit 11-12): the amount the payout will really send. The one-time setup fee comes out of the first
  -- payout (shop_payout_take_setup_fee: same amount and same "never under $1" skip), and a payout held for the ID check
  -- is not "on its way".
  v_send := (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt;
  IF v_send > 0 THEN
    v_setup_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(o.seller_id), 0);
    IF v_setup_fee <= 0 OR v_send - v_setup_fee < 100
       OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.onboarding_fee_paid IS TRUE) THEN
      v_setup_fee := 0;
    END IF;
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN o.is_digital THEN 'Download sale final' WHEN p_how = 'buyer' AND public.shop_order_is_service(o.id) THEN 'Order done' WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN v_send = 0 THEN
        format('This order paid off the $%s card cost you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((v_send - v_setup_fee) / 100.0, 'FM999990.00'))
      WHEN public.payout_waits_on_identity(o.seller_id) THEN
        format('Verify your ID in Settings to get your $%s. We send it as soon as you do.', to_char((v_send - v_setup_fee) / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account%s.', to_char((v_send - v_setup_fee) / 100.0, 'FM999990.00'),
        CASE
          WHEN v_debt > 0 AND v_setup_fee > 0 THEN format(' ($%s card cost you owed and the one-time $%s setup fee were taken out)',
                                                           to_char(v_debt / 100.0, 'FM999990.00'), to_char(v_setup_fee / 100.0, 'FM999990.00'))
          WHEN v_debt > 0 THEN format(' ($%s card cost you owed was taken out)', to_char(v_debt / 100.0, 'FM999990.00'))
          WHEN v_setup_fee > 0 THEN format(' (the one-time $%s setup fee was taken out)', to_char(v_setup_fee / 100.0, 'FM999990.00'))
          ELSE ''
        END)
    END,
    '/shops/dashboard', o.buyer_id);
  -- CHANGED (digital): the buyer already has the download (told at the charge); nothing more to say.
  IF o.is_digital THEN
    RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      -- S017 (Shops audit 11-12): a service is done, a delivery delivered; a Helpr delivery confirms 24 h after delivered_at.
      WHEN 'buyer' THEN CASE
        WHEN public.shop_order_is_service(o.id) THEN 'The work is done and the order is final. Thank you for buying local.'
        WHEN o.fulfillment IN ('shop_delivers', 'helpr_delivers') THEN 'The delivery is done and the order is final. Thank you for buying local.'
        ELSE 'The pickup is done and the order is final. Thank you for buying local.' END
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN CASE
        WHEN public.shop_order_is_service(o.id) THEN 'Nobody reported a problem in the 48 hours after the shop marked the work done, so the order is final and the shop is paid.'
        WHEN o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN 'Nobody reported a problem in the 24 hours after your Helpr delivered the order, so the order is final and the shop is paid.'
        WHEN o.fulfillment = 'shop_delivers' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was delivered, so the order is final and the shop is paid.'
        ELSE 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.' END
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$function$;
