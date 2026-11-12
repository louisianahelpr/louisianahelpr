-- Shops audit 11-12 (~/.lh-shots/shops-audit-1112/FINDINGS.tsv), the launch-blocking Highs S002-S006 (S001 is its own
-- migration). Owner 11-12 1:20 AM: Shops opens to everyone once these are done. Builder 1, by recommendation.
--   S002 "I got it" (shops_confirm_pickup) is refused before the ready day starts unless the shop marked it ready or
--        handed over: not_ready_yet, "You can confirm once it's ready." The button is hidden until then.
--   S003 a preorder's hold (shop_mark_order_held) runs shops_accept_order's checks: hidden shop, sell block, banned
--        buyer, and the home-food yearly limit WITH this order (Act 801 of 2026 $100,000 cap). Any miss: no charge.
--   S004 shops_report_no_show refuses a Helpr-delivered order (unless it fell back to pickup: helpr_unfilled_at).
--   S005 every buyer Shops notice that says money is coming back is emailed (owner rule L85: receipts and refunds).
--   S006 the notices no longer promise "add your side on the order" (no such screen); they point to support.
-- Each function is RESTATED VERBATIM from its newest CREATE (named per section) plus only the lines marked S00n.
-- MONEY: S002/S003/S004 decide who is paid (lh-money-escrow). AUTHZ: no grant, RLS or new function; CREATE OR REPLACE
-- keeps every grant (lh-authz-rls). REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/shopsAuditHighs.pglite.mjs (3x; NEW_MIGRATION=skip red; planted defects red).

-- 1. S004: shops_report_no_show RESTATED from 20261106180902_shops_delivery.sql (only the helpr_delivers refusal is new).
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
  -- S004 (Shops audit 11-12, High): a Helpr-delivered order's handover is the Helpr's drop-off, not the buyer coming
  -- to the shop, so the shop can never call it the buyer's no-show (a Helpr who never came would strike the buyer and
  -- pay the shop). Only an order that fell back to pickup (no Helpr took it: helpr_unfilled_at) can be one.
  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN
    RAISE EXCEPTION 'helpr_delivery_no_show' USING ERRCODE = '55000',
      HINT = 'A Helpr delivers this order, so it can''t be a buyer no-show. If the Helpr didn''t come, report it on the order.';
  END IF;
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
  -- Delivery (20261106180902): a shop-delivered order was not received, not "not picked up".
  PERFORM public.declutter_notify(o.buyer_id, 'warning', CASE WHEN o.fulfillment = 'shop_delivers' THEN 'Missed delivery' ELSE 'Missed pickup' END,
    CASE WHEN o.fulfillment = 'shop_delivers' THEN
      format('The shop says you didn''t receive the delivery of your order for %s. A missed delivery counts as a late cancel: nothing is refunded and the shop is paid. If you did receive it, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    ELSE
      format('The shop says you did not pick up your order for %s. A missed pickup counts as a late cancel: nothing is refunded and the shop is paid. If you did pick it up, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'No-show recorded',
    format('You are paid for the order ($%s).', to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'no_show', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;

-- 2. S002: shops_confirm_pickup RESTATED from 20261103083559_shops_declutter_owner_actions_not_found_is_404.sql (only the
--    not_ready_yet refusal is new).
CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  -- S002 (Shops audit 11-12, High): "I got it" pays the shop and makes the order final, so it waits until the ready
  -- day has started (Louisiana time), or the shop marked it ready, or the shop marked it handed over. Before that the
  -- buyer cannot have it, and one early tap would end every refund and problem path.
  IF o.status = 'accepted' AND o.ready_date IS NOT NULL
     AND public.shop_local_today() < o.ready_date
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h
                      WHERE h.order_id = o.id AND (h.ready_at IS NOT NULL OR h.shop_confirmed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'not_ready_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm once it''s ready.';
  END IF;
  RETURN public.shop_complete_handover(o.id, 'buyer');
END;
$fn$;

-- 3. S003: shop_mark_order_held RESTATED from 20261111025213_shops_gift_hold_steps.sql (only the preorder accept checks and
--    v_pre_home_food are new).
CREATE OR REPLACE FUNCTION public.shop_mark_order_held(p_session_id text, p_payment_intent_id text,
  p_amount_total integer, p_tax_cents integer, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_cap smallint;
  v_shop_name text;
  v_shop uuid;
  v_fee_charged boolean;
  v_won boolean;
  v_pre public.shop_items;
  v_pre_units integer;
  v_pre_home_food bigint;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  -- Lock order: the SHOP row first, then the order, the same order as
  -- shops_request_order (shop FOR SHARE, then the buyer's unpaid order), so a
  -- buyer asking again while their old page's payment lands cannot deadlock
  -- (lh-money-escrow re-review, 2026-10-18).
  SELECT shop_id INTO v_shop FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id;
  IF v_shop IS NOT NULL THEN
    PERFORM 1 FROM public.shops WHERE id = v_shop FOR UPDATE;
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    -- No row to record the hold on: the webhook cancels it now, and a failure
    -- there throws so Stripe redelivers the event.
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_missing');
  END IF;
  IF o.status IN ('held', 'accepted', 'handed_over', 'refunded') AND o.stripe_payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('result', 'already_held', 'order_id', o.id);
  END IF;
  IF o.status <> 'awaiting_hold' THEN
    -- The order closed while the buyer was on the page (asked again, withdrew,
    -- or the 2-hour unpaid sweep ran before a late webhook). The hold is
    -- recorded on the closed row, so shop_holds_to_release retries the cancel
    -- if the webhook's own cancel fails, and the buyer is told.
    IF o.stripe_payment_intent_id IS NULL AND o.status IN ('declined', 'expired', 'cancelled', 'superseded') THEN
      UPDATE public.shop_orders SET stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order already closed',
        'This order had already closed when your payment went through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
    END IF;
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
  END IF;
  -- Delivery (20261106180902): the page also carries the order's frozen delivery fee (0 for a pickup).
  -- H4-fee: the page carries the frozen setup fee on top of total (items + fee + tax), or, for a page opened
  -- before shop-checkout learned the fee, total alone (then nothing is claimed: not_charged).
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total + o.gift_cents IS NOT DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents + o.setup_fee_cents;
  -- Q2105 step 2: the gift was sized on the tax shop-checkout worked out and wrote (tax_cents); a page that
  -- names any other tax does not add up.
  IF (o.gift_cents > 0 AND p_tax_cents IS DISTINCT FROM o.tax_cents)
     OR p_tax_cents IS NULL OR p_tax_cents < 0
     OR (NOT v_fee_charged AND p_amount_total + o.gift_cents IS DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents) THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order could not go through',
      'Something did not add up with the payment for this order, so nothing was charged and the hold on your card is released. Please order again.',
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'amount_mismatch', 'order_id', o.id);
  END IF;
  -- The day may have filled while the buyer was on the page. The shop row is
  -- locked so two holds landing at once cannot both take the last slot.
  SELECT daily_order_cap, name INTO v_cap, v_shop_name FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- Preorders (20261108184654): a preorder is never counted against the day (shop_day_count skips them), so its
  -- own ready-by date is never "full".
  IF o.preorder_item_id IS NULL AND v_cap IS NOT NULL
     AND public.shop_day_count(o.seller_id, o.ready_date, ARRAY['held', 'accepted', 'handed_over']) >= v_cap THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'day_full', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'That day filled up',
      'Another order took the last spot that day, so nothing was charged and the hold on your card was released. Pick another day.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'day_full', 'order_id', o.id);
  END IF;
  -- Preorders: the item row is locked (every preorder hold of this item queues here), then the preorder must still be
  -- open (not missed, not past its goal deadline or ready-by) and the cap must still fit this order. Otherwise the hold
  -- goes back at no cost.
  IF o.preorder_item_id IS NOT NULL THEN
    SELECT * INTO v_pre FROM public.shop_items WHERE id = o.preorder_item_id FOR UPDATE;
    v_pre_units := public.shop_preorder_units(o.preorder_item_id, false);
    IF v_pre.id IS NULL OR v_pre.preorder_ready_by IS DISTINCT FROM o.ready_date OR v_pre.preorder_goal_missed_at IS NOT NULL
       OR v_pre.preorder_ready_by < public.shop_local_today()
       OR (v_pre.preorder_goal_by IS NOT NULL AND v_pre.preorder_goal_by < public.shop_local_today())
       OR (v_pre.preorder_cap IS NOT NULL
           AND v_pre_units + (SELECT COALESCE(sum(l.quantity), 0)::integer FROM public.shop_order_lines l WHERE l.order_id = o.id) > v_pre.preorder_cap) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder filled up or closed while you were paying, so nothing was charged and the hold on your card is released.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'preorder_closed', 'order_id', o.id);
    END IF;
    -- Q345: a block between the buyer and the shop since the preorder was asked for: never accepted (accepting it is
    -- the shop's yes), the hold goes back at no cost, and the words say nothing of who blocked whom. A refusal, not a
    -- RAISE: this runs in the webhook, where the hold must still be released (hireRefusedAcrossBlock: CANCEL_HOLD_HIRES).
    IF public.are_users_blocked(o.buyer_id, o.seller_id) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder can''t go through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
    END IF;
    -- S003 (Shops audit 11-12, High): the hold IS the shop's yes for a preorder, so it runs shops_accept_order's
    -- checks here: the shop not hidden, the owner able to sell (shop_owner_sell_block_reason), the buyer not banned,
    -- and the home-food yearly limit with THIS order in it (sales so far + accepted orders not yet charged + this
    -- order's home-food lines <= the cap; the shop row is locked above, so two holds cannot both fit). Any miss: the
    -- hold goes back at no cost, in words that never say which check failed.
    SELECT COALESCE(sum(l.line_cents), 0) INTO v_pre_home_food FROM public.shop_order_lines l
     WHERE l.order_id = o.id AND l.kind = 'home_food';
    IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = o.shop_id AND s.hidden_at IS NOT NULL)
       OR public.shop_owner_sell_block_reason(o.seller_id) IS NOT NULL
       OR o.buyer_id IS NULL
       OR EXISTS (SELECT 1 FROM public.profiles pr
                   WHERE pr.user_id = o.buyer_id
                     AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                     AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR (v_pre_home_food > 0 AND (
             (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id) IS NULL
             OR public.shop_cottage_sales_cents(o.seller_id)
                + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
                     JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
                    WHERE x.seller_id = o.seller_id AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
                + v_pre_home_food > (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id))) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder can''t go through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
    END IF;
  END IF;
  -- H4-fee: the one-winner claim. Lost (the account paid the fee elsewhere while the buyer was on the page): the hold
  -- goes back at no cost and the buyer orders again without it, so the fee is never charged twice.
  IF v_fee_charged THEN
    UPDATE public.profiles
       SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
     WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE
    RETURNING onboarding_fee_paid INTO v_won;
    IF v_won IS NOT TRUE THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                    setup_fee_state = 'paid_elsewhere',
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Please order again',
        'You already paid the one-time account setup fee, so this order''s page should not have included it. Nothing was charged and the hold on your card is released. Order again and the fee will not be on it.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'setup_fee_paid_elsewhere', 'order_id', o.id);
    END IF;
  END IF;
  UPDATE public.shop_orders
     SET status = 'held', stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode,
         tax_cents = p_tax_cents,
         -- H4-fee: total_cents stays the sale; the fee lives in setup_fee_cents.
         total_cents = p_amount_total + o.gift_cents - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now() + interval '24 hours'
   WHERE id = o.id;
  -- Preorders: the shop said yes when it opened the preorder, so the order is accepted at once and the webhook captures
  -- it right away (shop_captures_due picks up a capture that did not answer): the buyer pays in full at order (owner
  -- 11-08).
  IF o.preorder_item_id IS NOT NULL THEN
    UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New preorder',
      format('A new preorder for "%s" came in, ready by %s.', v_pre.title, to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    RETURN jsonb_build_object('result', 'held', 'order_id', o.id, 'preorder', true);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New order',
    format('A new order for %s is waiting. Accept or decline it within 24 hours, or it drops.', to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order sent',
    format('Your card is held, not charged. %s has 24 hours to accept; you are charged only if they do.', COALESCE(v_shop_name, 'The shop')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'held', 'order_id', o.id);
END;
$fn$;

-- 4. S006: shop_handover_sweep RESTATED from 20261109224952_notices_card_fee_and_our_team.sql and
--    shops_report_digital_problem RESTATED from 20261108185110_shops_digital_checkout.sql: only the sentence
--    "You can add your side on the order." becomes "To tell our team your side, contact Louisiana Helpr support."
CREATE OR REPLACE FUNCTION public.shop_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  a record;
  v_auto integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_test boolean;
BEGIN
  -- (a) The shop said it is done and the buyer said nothing for 48 hours: the shop is paid. In person: the
  -- "Handed over" tap. Left out: the ready photo, counted from the later of the photo and the ready date's start.
  -- CHANGED (digital, owner 11-08): a download paid 72 hours ago with no problem reported is final and its shop is
  -- paid; a shop's "handed over" tap never shortens those 72 hours. A download has no handover row until it is
  -- finished, so the join is a LEFT JOIN (a made order still needs the shop's tap, which needs the row).
  FOR r IN
    SELECT o.id FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((NOT o.is_digital
             AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL
             AND h.shop_confirmed_at + interval '48 hours' <= now())
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NOT NULL
             AND greatest(h.ready_at, (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours' <= now())))
         OR (o.is_digital AND o.captured_at + interval '72 hours' <= now()))
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      -- shop_complete_handover re-reads the row under its lock and refuses an open problem.
      IF (public.shop_complete_handover(r.id, 'auto') ->> 'result') = 'handed_over' THEN
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b) Nobody has said anything 24 hours after the ready date: the money stays held. Both sides are nudged, then
  -- weekly; at 60 days every admin is told once. No money moves here.
  FOR r IN
    SELECT o.id, o.buyer_id, o.seller_id, o.handover_mode, o.ready_date, o.is_seed,
           h.held_nudged_at, h.held_admin_at,
           ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') AS held_from
      FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NULL)
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NULL))
       -- CHANGED (digital): nobody hands a download over, so nobody is nudged about it.
       AND NOT o.is_digital
       AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '24 hours' <= now()
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR (h.held_admin_at IS NULL
                AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '60 days' <= now()))
       -- Owner rule: test data never reaches a member or admin.
       AND o.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o.buyer_id, o.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o.buyer_id, o.seller_id) AND pr.is_seed)
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      INSERT INTO public.shop_handovers (order_id) VALUES (r.id) ON CONFLICT (order_id) DO NOTHING;
      IF r.held_admin_at IS NULL AND r.held_from + interval '60 days' <= now() THEN
        -- H5 review note: like Declutter's system problem (20261102084222), the order gets an open problem, so it
        -- sits in admin > Shops orders' problems with the reason, and no tap pays or refunds it until an admin decides.
        UPDATE public.shop_handovers
           SET held_admin_at = now(), held_nudged_at = now(),
               problem_at = COALESCE(problem_at, now()),
               problem_note = COALESCE(problem_note,
                 'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.')
         WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. To tell our team your side, contact Louisiana Helpr support.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. To tell our team your side, contact Louisiana Helpr support.',
          '/shops/dashboard', r.buyer_id);
        v_test := public.is_test_subject(r.buyer_id) OR public.is_test_subject(r.seller_id);
        IF NOT v_test THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order held 60 days',
              'Nobody has confirmed a paid Shops handover for 60 days. The money is held until you decide it: pay the shop or refund the buyer.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.shop_handovers SET held_nudged_at = now() WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Did you get your order?',
          'If you have it, tap "I got it" on the order in Shops. If not, report it there. Your money stays held until one of you says.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Did the buyer get this order?',
          CASE WHEN r.handover_mode = 'porch'
            THEN 'If it''s out, take the ready photo on the order. You aren''t paid until one of you says.'
            ELSE 'If they have it, tap "Handed over" on the order. You aren''t paid until one of you says.' END,
          '/shops/dashboard', r.buyer_id);
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_handed_over', v_auto, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.shops_report_digital_problem(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_label text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_label := CASE p_reason WHEN 'broken' THEN 'The file is broken or will not open'
                           WHEN 'not_as_described' THEN 'The file is not what the listing described' END;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what is wrong, in under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR NOT o.is_digital THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL OR o.captured_at + interval '72 hours' <= now() THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000',
      HINT = 'A problem with a download can be reported in the 72 hours after you buy it. After that, contact support.';
  END IF;
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES (o.id, now(), v_label || ': ' || v_note)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Problem reported with a download',
    v_label || '. Louisiana Helpr will look at it before anyone is paid. To tell our team your side, contact Louisiana Helpr support.',
    '/shops/dashboard', o.buyer_id);
  -- Every admin is told; test data never reaches one (owner rule).
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops download problem reported',
        'A buyer says a paid Shops download is broken or not as described. The shop''s payout is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;

-- 5. S005: the Shops email trigger RESTATED from 20261108201655_shops_order_emails.sql. The title list stays, and every
--    buyer notice under /shops/orders whose words say money is coming back (refund, "back to your card", "coming back")
--    is emailed too: the buyer's own free cancel ("Order cancelled"), "Preorder refunded", "Delivery money coming back",
--    "No Helpr took your delivery" and any refund notice added later. send_notice_email keeps the email_shops_orders switch.
DROP TRIGGER IF EXISTS trg_email_shop_order_notice ON public.notifications;
CREATE TRIGGER trg_email_shop_order_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type = 'shops_orders' AND (
        (NEW.title IN ('New order', 'Payment sent') AND NEW.link LIKE '/shops/dashboard%')
     OR (NEW.title IN ('Order accepted', 'Your order is ready', 'Order refunded', 'Order cancelled by the shop')
         AND NEW.link LIKE '/shops/orders%')
     OR (NEW.link LIKE '/shops/orders%'
         AND (NEW.message ILIKE '%refund%' OR NEW.message ILIKE '%back to your card%' OR NEW.message ILIKE '%coming back%'))))
  EXECUTE FUNCTION public.email_shop_order_notice();
