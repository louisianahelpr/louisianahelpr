-- Q1928 gap 3 (docs/specs/declutter-auctions.md, owner answer 7's open list; lead decision 11-02): a paid Declutter
-- sale whose seller goes OUT after payment (declutter_seller_out: banned, suspended, 3 strikes, under 18, flagged
-- business-like) could still close as buyer_no_show or admin_no_fault, so the buyer bore the card fee (keep_buyer_fee
-- kept the buyer fee; keep_card_fee kept the card fee). Lead 11-02: when declutter_seller_out(seller) is true at refund
-- time, those two reasons are recorded as seller_out: the buyer gets every cent (less a Helpr's delivery reserve) and
-- the card fee is the seller's debt (declutter_record_refund's full_seller_pays_fee). Strikes, item status, payouts and
-- every other reason are unchanged. The two callers that pass those reasons change:
--   * declutter_close_paid_order (buyer_no_show from the sweeps, admin_no_fault from the admin decision), restated
--     from Shipping S6 2d (20261102051521, wip/b126-ship);
--   * declutter_refund_after_handover (admin_no_fault after the handover), restated from Shipping S6 2g
--     (20261102060324, wip/b150-ship).
-- An out seller's close also refunds the shipping at once (no label hold: that hold is for the buyer's fault).
--
-- ALSO RESTORED (Q1935): 2d and 2g were restated from bases older than 20261102040952 (wip/b148-open) and passed
-- o.card_fee_cents whole again; both calls pass declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved)
-- once more.
--
-- LAND ORDER (~/.lh-shots/LANDING-ORDER-1102.md): AFTER wip/b148-open AND wip/b150-ship (which contains wip/b126-ship).
-- On this branch alone the functions read declutter_shipping_reserved_cents / shipments before they exist.
-- Everything else is verbatim (diffed against 2d / 2g). Replay-safe: CREATE OR REPLACE and REVOKE/GRANT only.
-- Proof: src/test/pglite/declutterSellerOutAfterPayment.pglite.mjs (applied 3x; NEW_MIGRATION=skip and MUTANT=<name> red).

CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
  -- Shipping S6 2d: the shipping held back from a buyer-fault refund until the label is voided.
  v_ship integer := 0;
  v_label record;
  -- CHANGED (Q1928 gap 3): the reason the refund is recorded under.
  v_fee_reason text := p_reason;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- A free claim (20261027170717) has no payment to refund: it closes, the strike rules still apply.
  IF o.status IS NOT DISTINCT FROM 'paid' AND o.paid_with = 'free' THEN
    UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
    FOR r IN
      UPDATE public.declutter_cart_items c
         SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
       WHERE c.order_id = o.id AND c.status = 'paid'
      RETURNING c.item_id, c.id
    LOOP
      UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
       WHERE id = r.item_id AND status = 'sold';
      IF p_strike_side IS NOT NULL AND NOT v_struck THEN
        -- The callers' words speak of refunds and card fees; a free pickup has neither.
        PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
          p_strike_side, p_strike_reason, r.item_id,
          CASE WHEN p_strike_side = 'seller' THEN 'You did not show up for a booked free Declutter pickup.'
               ELSE 'You missed a booked free Declutter pickup.' END, r.id);
        v_struck := true;
      END IF;
    END LOOP;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Free pickup cancelled',
      'This free pickup was cancelled. Nothing was charged.', '/declutter?view=cart', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Free pickup cancelled',
      CASE WHEN v_seller_fault THEN 'This free pickup was cancelled.'
           ELSE 'This free pickup was cancelled. Your item is back up.' END,
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'cancelled', 'free', true);
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  -- CHANGED (Q1928 gap 3, lead 11-02): a seller who can no longer sell (declutter_seller_out: banned, suspended, 3
  -- strikes, under 18, flagged business-like) when a paid sale is closed as the buyer's no-show or nobody's fault owes
  -- the card fee, as at payment (owner answer 7): the refund is recorded as seller_out, so the buyer gets every cent
  -- (less a Helpr's delivery reserve) and the fee is the seller's debt. Strikes and the item's status are unchanged.
  IF p_reason IN ('buyer_no_show', 'admin_no_fault') AND public.declutter_seller_out(o.seller_id) THEN
    v_fee_reason := 'seller_out';
  END IF;
  -- CHANGED (Shipping S6 2d, spec 5.3 / section 11 fix 5): a buyer-fault close of a shipped order whose label was bought
  -- refunds everything else now and the SHIPPING only once the label is voided (declutter_ship_refund_after_void). A
  -- seller-fault close still refunds everything now (a rejected void is the seller's debt: 20261102045553).
  IF v_fee_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN  -- CHANGED (Q1928 gap 3)
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  -- CHANGED (Q1935, restored: 2d was restated from a base before 20261102040952): the card fee prorated to the part
  -- refunded. CHANGED (Q1928 gap 3): recorded under v_fee_reason.
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, o.total_cents - v_reserved - v_ship,
    public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  -- S6 2d: the held-back shipping. A test label not yet handed to the carrier is sent to be voided (the label worker
  -- voids it; the same compare-and-set as requestShipVoid); a live one is paged, never voided by itself. A label
  -- already voided gives the shipping back at once. A rejected void or a parcel already scanned: the buyer keeps no
  -- shipping (spec 5.3).
  IF v_ship > 0 THEN
    SELECT s.id, s.label_state, s.label_mode, s.accepted_at INTO v_label
      FROM public.shipments s WHERE s.declutter_order_id = o.id FOR UPDATE;
    IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL THEN
      IF v_label.label_mode = 'test' THEN
        UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
         WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL;
      ELSE
        PERFORM public.log_cron_defect('declutter_close_paid_order-live-void', o.id::text,
          format('order %s was cancelled on the buyer (%s); its LIVE label must be voided by hand, then the shipping refunded', o.id, p_reason));
      END IF;
    ELSIF v_label.label_state = 'voided' THEN
      PERFORM public.declutter_ship_refund_after_void(o.id);
    END IF;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. What you paid for delivery went to the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the Helpr's fault refunds everything, delivery included (the task failed,
         -- so nothing is reserved); it said "The card fee is not refunded".
         WHEN p_reason = 'helpr_fault'
         THEN format('All $%s is coming back to your card, delivery included.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         -- S6 2d: the shipping is said apart: it comes back once the label is cancelled.
         -- CHANGED (Q1928 gap 3): an out seller's close gives every cent back (less a Helpr's delivery reserve).
         WHEN v_fee_reason = 'seller_out'
         THEN format('$%s is coming back to your card.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') AND v_ship > 0
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.'
                          ELSE 'The item price, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.' END,
                     to_char((o.total_cents - v_reserved - v_ship - o.premium_cents) / 100.0, 'FM999990.00'), to_char(v_ship / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         WHEN v_ship > 0
         THEN format('Your refund is on its way. The $%s for shipping comes back once the shipping label is cancelled.', to_char(v_ship / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         -- S6 2d: a shipped sale cancelled before the parcel left: the label is cancelled, so nothing goes in the mail.
         WHEN v_ship > 0 THEN 'This sale was cancelled and the buyer refunded. Don''t ship it: its label is being cancelled. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_after_handover(p_order_id uuid, p_reason text, p_part_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  v_reserved integer;
  v_paid integer;
  v_refund uuid;
  v_refunded integer;
  v_cents integer;
  v_title text;
  v_policy text;
  v_never_got_it boolean;
  -- Shipping S6 2g: the shipping a buyer-fault refund of a delivered parcel keeps back (the label was spent).
  v_ship integer := 0;
  -- CHANGED (Q1928 gap 3): the reason the refund is recorded under.
  v_fee_reason text := p_reason;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('refund_request_full', 'refund_request_part', 'not_as_described', 'admin_no_fault', 'admin_buyer_fault', 'seller_no_show') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF o.status <> 'handed_over' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_handed_over' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = o.stripe_payment_intent_id) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
      HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
  END IF;
  -- CHANGED (BUY-25, owner 10-30): only declutter_answer_refund's "never got it" sends this reason here.
  v_never_got_it := p_reason = 'seller_no_show';
  -- A delivery fee that paid a Helpr for the trip stays with the Helpr (owner #5, B69).
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  -- CHANGED (Shipping S6 2g): an admin buyer-fault refund of a shipped order leaves its bought label's shipping out
  -- (spec 5.3: a spent label is whoever caused it; declutter_record_refund's keep_buyer_fee check counts shipping -
  -- shipping reserved, so passing the whole total raised refund_amount_unknown). Every other reason is unchanged.
  IF p_reason = 'admin_buyer_fault' THEN
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  v_paid := o.total_cents - v_reserved - v_ship;
  -- CHANGED (Q1928 gap 3, lead 11-02): a nobody's-fault refund while the seller can no longer sell is the seller's
  -- card fee (seller_out), as at payment (owner answer 7). The buyer's notice reads the policy, so it drops the
  -- card-network sentence by itself.
  IF p_reason = 'admin_no_fault' AND public.declutter_seller_out(o.seller_id) THEN
    v_fee_reason := 'seller_out';
  END IF;
  IF p_reason = 'refund_request_part' THEN
    -- Q1998: tax on a part refund is never guessed. Declutter charges no tax today (declutter-checkout refuses it).
    IF o.tax_cents <> 0 THEN
      RAISE EXCEPTION 'part_refund_unavailable' USING ERRCODE = '55000';
    END IF;
    IF p_part_cents IS NULL OR p_part_cents <= 0 OR p_part_cents >= o.items_cents THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                          kept_cents, refund_cents)
    VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents)
    RETURNING id INTO v_refund;
    v_refunded := p_part_cents;
  ELSE
    -- CHANGED (Q1935, restored: 2g was restated from a base before 20261102040952): the card fee prorated to the part
    -- refunded. CHANGED (Q1928 gap 3): recorded under v_fee_reason.
    v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, v_paid,
      public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));
    -- The whole sale is undone for the seller: nothing of the item price is theirs, and the item goes back.
    -- A seller delivery's rate went back to the buyer with it (no Helpr was paid for the trip), so it
    -- leaves the seller's payout too: their payout for this sale is 0 (20261027153244).
    v_refunded := o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
    UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
     WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
       AND status = 'completed';
  END IF;
  PERFORM public.declutter_rebook_payout(o.id, v_refunded);
  SELECT r.refund_cents, r.fee_policy INTO v_cents, v_policy FROM public.declutter_refunds r WHERE r.id = v_refund;
  SELECT string_agg(i.title, ', ' ORDER BY i.title) INTO v_title
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('$%s is coming back to your card for "%s". Keep the item.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN v_never_got_it
         THEN format('$%s is coming back to your card for "%s". The seller agreed you never got it.%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
         WHEN p_reason = 'refund_request_full'
         THEN format('$%s is coming back to your card for "%s". The seller confirmed they have the item back.%s%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.' ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
         ELSE format('$%s is coming back to your card for "%s".%s%s Please give the item back to the seller; message the seller from your order.',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN p_reason = 'admin_buyer_fault' AND v_ship > 0
                          THEN format(' The $%s for shipping is not refunded: the parcel was sent.', to_char(v_ship / 100.0, 'FM999990.00'))
                          WHEN p_reason = 'admin_buyer_fault' THEN ''
                          WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.'
                          ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
    END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer refunded',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('The buyer got $%s back for "%s". It comes out of your payout for this sale.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN v_never_got_it
         THEN format('You agreed the buyer never got "%s" and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('You have "%s" back and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; message the buyer from your order.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=selling', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) TO service_role;
