-- Q2556 (builder 156's PGlite measure, src/test/pglite/declutterBlockedOutSellerNotice.pglite.mjs case (d)): a
-- Declutter seller who is out (declutter_seller_out) when a buyer's payment lands was told twice about the one debt
-- booked for it: 'You owe from a refund' (declutter_record_refund, since D2-6 20261029232103) AND 'Amount owed'
-- (declutter_seller_out_fee_notice, which declutter_mark_order_paid calls after record_refund on all three of its
-- seller_out paths). Before D2-6 it was one (spec owner answer 7: the seller is told once).
--
-- Now record_refund does not send its own notice for a seller_out refund of a payment the order never took as its
-- own (mark_order_paid refuses it before stamping stripe_payment_intent_id, so the order's PaymentIntent is not
-- this one): mark_order_paid's declutter_seller_out_fee_notice is the one notice. A seller_out refund of the
-- order's OWN payment (Q1928 gap 3: declutter_close_paid_order / declutter_refund_after_handover pass the order's
-- stripe_payment_intent_id and send no debt notice of their own) is still told here. The debt itself, its amount
-- and every other reason are unchanged.
--
-- declutter_record_refund is restated VERBATIM from its newest definition, 20261102061022_declutter_card_fee_setup_share
-- (Q2404's setup-fee share, Shipping S6 2d's keep_buyer_fee shipping check, Q1928 gap 2's fee_estimated, BUY-36,
-- BUY-30, D2-6 all kept) with the one CHANGED block marked Q2556.
-- LAND ORDER: AFTER 20261102061022 (wip/b152-open, in this stack). CREATE OR REPLACE keeps its grants; they are
-- restated anyway. Replay-safe: CREATE OR REPLACE and REVOKE/GRANT only.
-- Proof: src/test/pglite/declutterBlockedOutSellerNotice.pglite.mjs (case (d) asserts one notice; NEW_MIGRATION=skip
-- red; MUTANT=<name> red, including a restate that drops the 2d shipping hunk or the Q2404 setup-share hunk).

CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_kept integer := 0;
  v_seller uuid;
  v_order record;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   WHEN p_reason = 'refund_request_part' THEN 'agreed_part'
                   ELSE 'full_platform_absorbs' END;
  IF v_policy = 'agreed_part' THEN
    -- Only the offered amount is right for a part refund; this function cannot know it.
    RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
  END IF;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  -- CHANGED (Q2404): the card fee is Stripe's fee on the WHOLE charge, and a charge that carried the one-time setup
  -- fee was total + setup fee. Whoever is billed for a refund of the SALE (the seller, or the buyer when the fee is
  -- kept) pays only the sale's share; the setup fee's share is the platform's own cost, as the setup fee is its own.
  -- The charge carried the fee when the payment being refunded is total + setup fee (a payment refused when it
  -- landed), or when the sale stood and the fee was charged with it (claimed, refund_due, refunded). A sale paid
  -- without it (not_charged, or no state yet and a payment of the sale alone) keeps the whole fee.
  IF v_policy IN ('full_seller_pays_fee', 'keep_card_fee') AND p_order_id IS NOT NULL THEN
    SELECT o.total_cents, o.setup_fee_cents, o.setup_fee_state INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF COALESCE(v_order.setup_fee_cents, 0) > 0 AND COALESCE(v_order.total_cents, 0) > 0
       AND (p_paid_cents = v_order.total_cents + v_order.setup_fee_cents
            OR v_order.setup_fee_state IN ('claimed', 'refund_due', 'refunded')) THEN
      v_fee := round(v_fee::numeric * v_order.total_cents / (v_order.total_cents + v_order.setup_fee_cents))::integer;
    END IF;
  END IF;
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    -- CHANGED (Shipping S6 2d): a shipped order's shipping is in its total; a bought label's shipping is split out of
    -- this refund (declutter_shipping_reserved_cents) and goes back on its own once the label is voided.
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents, o.shipping_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id)
                                        + v_order.shipping_cents - public.declutter_shipping_reserved_cents(p_order_id) THEN
      -- Only a whole paid order can keep its fee; anything else is a bug, never a guess.
      RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
    END IF;
    v_kept := v_order.premium_cents;
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
               WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
               ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    -- CHANGED (BUY-36): on the Helpr's fault the Helpr owes it (owner 10-30), out of their next delivery or Declutter payout.
    IF p_reason = 'helpr_fault' THEN
      SELECT t.helpr_id INTO v_seller FROM public.helpr_tasks t WHERE t.source_kind = 'declutter_delivery' AND t.source_id = p_order_id;
    END IF;
    IF v_seller IS NOT NULL THEN
      -- CHANGED (Q1928 gap 2): a debt booked from an ESTIMATED fee (Stripe's balance transaction was not read, so no
      -- fee was passed) says so.
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents, fee_estimated)
      VALUES (v_seller, v_id, v_fee, v_fee, p_card_fee_cents IS NULL)
      ON CONFLICT (refund_id) DO NOTHING;
      -- D2-6 (audit 1b #6): the seller is told when a refund leaves them owing money, and where it comes from.
      -- In words, never a fee name (the owner's rule: members see no fee words); the amount is what they owe.
      -- CHANGED (BUY-30): the notice names the item (no other party is passed, so the writer could not) and
      -- opens Selling by its tab address.
      -- CHANGED (Q2556): a payment that lands while the seller can't sell (reason seller_out, refused by
      -- declutter_mark_order_paid, so the order never took this payment as its own) is told by
      -- declutter_seller_out_fee_notice, which mark_order_paid calls right after on all three of its seller_out
      -- paths; telling it here too gave the seller two notices for one debt (spec owner answer 7: told once). A
      -- seller_out refund of the order's OWN payment (Q1928 gap 3: declutter_close_paid_order,
      -- declutter_refund_after_handover) has no other notice of the debt, so it is still told here.
      IF FOUND AND NOT (p_reason = 'seller_out'
                        AND NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                                         WHERE o.id = p_order_id AND o.stripe_payment_intent_id = p_payment_intent_id)) THEN
        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',
          -- BUY-36 (CHANGED): a Helpr's own fault comes out of their next payout, and opens their deliveries.
          CASE WHEN p_reason = 'helpr_fault'
               THEN format('This refund on %s leaves you owing $%s. It comes out of your next Declutter payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00'))
               ELSE format('This refund on %s leaves you owing $%s. It comes out of your next Declutter sale''s payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00')) END,
          CASE WHEN p_reason = 'helpr_fault' THEN '/declutter?tab=deliver' ELSE '/declutter?tab=selling' END, NULL);
      END IF;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;
