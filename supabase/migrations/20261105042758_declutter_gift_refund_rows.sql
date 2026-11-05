-- Q2106 S3b step 1 (Builder 3, 11-04; lead-approved plan 9:4x PM): a Declutter refund row says how much of it goes
-- back to the buyer's GIFT balance, and a gift-only order's refund has no card payment.
--
-- Found on the S3 schema read: declutter_refunds.stripe_payment_intent_id was NOT NULL + '^pi_', so every close path
-- of a gift-only paid order (stripe_payment_intent_id NULL on the order) raised inside declutter_record_refund, and a
-- gift+card order's paths would ask Stripe to refund the whole price from a charge that covered only the card part.
--
-- refund_cents stays the TOTAL given back (card + gift), so every existing amount and policy CHECK holds unchanged;
-- gift_refund_cents (0..refund_cents) is the part restored to the gift balance (restore_gift_card_for_declutter_order,
-- key 'declutter_refund:'||id), and the card refund is refund_cents - gift_refund_cents. A row with no payment intent is
-- allowed ONLY when all of it goes to the gift balance, and then at most one per order (the PI's UNIQUE no longer
-- dedupes it). Not "AND order_id IS NOT NULL" (the plan's first wording): order_id is ON DELETE SET NULL, so that
-- CHECK would make any cascade that deletes an order with a gift-only refund fail; the row keeps its money record
-- instead. Replay-safe: every step is guarded.
ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS gift_refund_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_gift_share;
ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_gift_share
  CHECK (gift_refund_cents >= 0 AND gift_refund_cents <= refund_cents);

ALTER TABLE public.declutter_refunds ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_gift_only_no_card;
ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_gift_only_no_card
  CHECK (stripe_payment_intent_id IS NOT NULL OR gift_refund_cents = refund_cents);

CREATE UNIQUE INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order
  ON public.declutter_refunds (order_id) WHERE stripe_payment_intent_id IS NULL;

-- Q2106 S3b step 2: declutter_record_refund (restated from its newest definition, 20261103203204_shipping_lost_sweep)
-- records the gift share. Changes are marked "CHANGED (Q2106 S3b)"; everything else is verbatim.
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
  v_own boolean;
  v_gift integer := 0;
  v_card_paid integer;
  v_refund integer;
  v_card_refund integer;
BEGIN
  -- CHANGED (Q2106 S3b): a gift-only order's payment has no payment intent; its one refund row is found by order.
  IF p_payment_intent_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r
     WHERE r.order_id = p_order_id AND r.stripe_payment_intent_id IS NULL;
  ELSE
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  END IF;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault', 'ship_lost') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   WHEN p_reason = 'refund_request_part' THEN 'agreed_part'
                   ELSE 'full_platform_absorbs' END;
  IF v_policy = 'agreed_part' THEN
    -- Only the offered amount is right for a part refund; this function cannot know it.
    RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
  END IF;
  -- CHANGED (Q2106 S3b): the gift share. Only the order's OWN payment carries the gift (a duplicate or mismatched card
  -- payment is card only). Of what was paid, the gift part is the order's gift net of earlier give-backs; the card
  -- part is the rest. Stripe's fee is on the CARD part only (lead 11-04), so the fee, estimated or passed, is capped at
  -- the card part, and a gift-only payment has none.
  v_own := p_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.declutter_orders o
     WHERE o.id = p_order_id AND o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id);
  IF p_payment_intent_id IS NULL AND NOT v_own THEN
    -- No payment intent is only right for the order's own gift-only payment; anything else is a bug, never a guess.
    RAISE EXCEPTION 'refund_payment_unknown' USING ERRCODE = '55000';
  END IF;
  IF v_own THEN
    v_gift := least(p_paid_cents, greatest(0, COALESCE(public.declutter_order_gift_net_cents(p_order_id), 0)));
  END IF;
  v_card_paid := p_paid_cents - v_gift;
  IF p_payment_intent_id IS NULL AND v_card_paid <> 0 THEN
    RAISE EXCEPTION 'refund_payment_unknown' USING ERRCODE = '55000';
  END IF;
  v_fee := CASE WHEN v_card_paid <= 0 THEN 0
                ELSE least(v_card_paid, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(v_card_paid)))) END;
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
    -- (Q2106 S3b: v_fee is already within the card part, so the kept fee never comes out of the gift.)
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
  v_refund := CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
                   WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
                   ELSE p_paid_cents END;
  -- CHANGED (Q2106 S3b): what is kept (the card fee, the buyer's fee) comes out of the CARD part first; the gift goes
  -- back whole unless the card part cannot cover what is kept.
  v_card_refund := greatest(0, v_card_paid - (p_paid_cents - v_refund));
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents, gift_refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept, v_refund,
          v_refund - v_card_refund)
  -- No conflict target: the payment intent's UNIQUE or, with no payment intent, one gift-only row per order.
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    IF p_payment_intent_id IS NULL THEN
      SELECT r.id INTO v_id FROM public.declutter_refunds r
       WHERE r.order_id = p_order_id AND r.stripe_payment_intent_id IS NULL;
    ELSE
      SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    END IF;
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

-- Q2106 S3b step 3: the refund queue hands declutter-money each row's gift share, so the cron restores the gift
-- FIRST (restore_gift_card_for_declutter_order, key 'declutter_refund:'||id: a retry never restores it twice) and
-- refunds at Stripe only the card part: the queue's refund_cents is r.refund_cents - r.gift_refund_cents (so the
-- amount sent stays decided in SQL, as refundsKeepTheCardFee requires). A gift-only row (no payment intent) is executed with no
-- Stripe ref (declutter_refund_executed already keeps a NULL ref). Restated from its newest definition
-- (20261103225232_declutter_damage_refund_stops_waiting_on_seller); the only changes (the card-part refund_cents and
-- the gift_refund_cents column) are marked CHANGED. The return type changes, so the function is dropped first (inside this one migration).
DROP FUNCTION IF EXISTS public.declutter_refunds_due(integer);
CREATE OR REPLACE FUNCTION public.declutter_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text,
               gift_refund_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- buyer/seller pick the Stripe mode (test accounts on the test key) in declutter-money.
  -- CHANGED (Q2106 S3b): refund_cents here is the CARD part (what Stripe refunds), decided here in SQL, never in the
  -- edge function; gift_refund_cents is the part that goes back to the gift balance. Their sum is the row's total.
  SELECT r.id, r.reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id,
         r.refund_cents - r.gift_refund_cents, r.attempts,
         r.payment_livemode, o.stripe_checkout_session_id,
         r.gift_refund_cents
    FROM public.declutter_refunds r
    LEFT JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE ((r.status = 'pending' AND r.created_at <= now() - interval '2 minutes' AND r.next_attempt_at <= now())
          OR (r.status = 'failed' AND r.next_attempt_at <= now()))
     AND r.attempts < 12
     AND (r.reason <> 'delivery_damage'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = r.order_id
                       AND p.status IN ('succeeded', 'nothing_due', 'settled_by_hand'))
          OR r.created_at <= now() - interval '3 days'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p
                       JOIN public.payout_payee_waits w ON w.payout_kind = 'declutter' AND w.payout_id = p.id
                      WHERE p.order_id = r.order_id AND w.category IN ('held', 'rejected', 'unusable'))
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p
                       JOIN public.payout_holds ph ON ph.helper_id = p.seller_id
                      WHERE p.order_id = r.order_id))
   ORDER BY r.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refunds_due(integer) TO service_role;
