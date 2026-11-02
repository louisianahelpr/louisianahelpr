-- Shipping S6 part 2g (Q2259; docs/specs/shipping-draft.md 5.3 rows "admin buyer-fault" and decision 6 "spent label =
-- whoever caused it"). TEST MODE ONLY: declutter_shipping stays testers; ship orders exist only for testers.
--
-- What was broken: a shipped order is handed over once the parcel is delivered (20261102013630). An admin's buyer-fault
-- decision on it afterwards goes to declutter_refund_after_handover(o, 'admin_buyer_fault'), which passed the whole
-- total (less a Helpr delivery reserve) to declutter_record_refund. Since 2d (20261102051521) that function's
-- keep_buyer_fee check counts shipping - declutter_shipping_reserved_cents, so the amounts disagreed and it raised
-- refund_amount_unknown: the admin could not decide the problem for the buyer at all.
-- The fix: declutter_refund_after_handover (restated from 20261031010243; only the marked parts change) leaves the
-- bought label's shipping out of an admin_buyer_fault refund (the label was spent on the buyer's account), and the
-- buyer's notice says so. Every other reason, the payout rebooking and the item status are unchanged.
-- Service role only. Proof: src/test/pglite/shippingBuyerFaultAfterDelivery.pglite.mjs (applied 3x; NEW_MIGRATION=skip
-- is red; planted defects; Supabase's default execute grant emulated). REPLAY-SAFETY: CREATE OR REPLACE.

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
    v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, v_paid, o.card_fee_cents);
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
