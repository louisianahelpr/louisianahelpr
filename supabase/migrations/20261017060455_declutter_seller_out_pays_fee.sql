-- Declutter: a buyer who pays just as the SELLER can no longer sell gets every
-- cent back, and the card fee becomes the SELLER's debt (owner answer 7,
-- 2026-10-17, docs/specs/owner-questions-hub-1015.md "OWNER ANSWERS").
--
-- Before this, the payment webhook (declutter_mark_order_paid) answered such a
-- payment with reason 'order_closed' (or 'sold_elsewhere' on a late payment it
-- could not honour), policy full_platform_absorbs: the buyer was refunded in
-- full and the platform paid the card fee Stripe kept. "Can no longer sell" is
-- declutter_seller_out(): banned, suspended, 3 Declutter strikes, under 18 or
-- flagged business-like. Three paths reached it:
--   (a) the deadline sweep had closed the checkout with close_reason
--       'seller_out' and the buyer paid on the still-open Stripe page;
--   (b) a late but in-time payment (missed_checkout, B41) could not be
--       honoured while the seller was out;
--   (c) the order was still awaiting payment and the seller was out when the
--       payment landed.
-- Each now records reason 'seller_out', policy full_seller_pays_fee: the same
-- full refund, and declutter_record_refund books the card fee as a
-- declutter_seller_fee_debts row that declutter_consume_fee_debt takes from the
-- seller's next Declutter payout (slice 4). A seller who BLOCKED the buyer still
-- reads 'seller_backed_out' (it comes first); a seller who is out wins over a
-- buyer who blocked them (the buyer still gets every cent, per the answer).
-- The seller is told once, in-app, what they owe (declutter_seller_out_fee_notice).
-- Only when the seller being out is the one thing that stopped the sale (an
-- item that went elsewhere stays our mistake; lh-money-escrow review of
-- 1da32feffe #3). Every seller who is out is billed, an under-18 birthday
-- included (owner, 2026-10-17: every member ticked "I am 18 or older" to sign
-- up; review #4).
--
-- Nothing else changes: the refund amount rule (declutter_refunds_amount) is
-- untouched, and existing rows keep their reason. Restated from the NEWEST
-- definitions: declutter_record_refund from 20261017052705 (slice 5, Helpr
-- delivery: the paid amount counts delivery_cents less what a delivery
-- reserved), the two refund CHECKs from 20261017052705 (its 'delivery_damage'
-- reason kept), declutter_mark_order_paid from 20261014224914 (no later
-- migration defines it).
--
-- Re-cut 2026-10-17 from 20261017045215 (wip/declutter-5 0d3f77d50, built on
-- main without the Declutter stack) to land inside the stack after
-- 20261017052706: cut verbatim, it restated declutter_record_refund and the
-- two CHECKs from slice 4 and would have erased delivery's amount rule and the
-- 'delivery_damage' reason. The only change from that file is that merge.
--
-- REPLAY-SAFETY: every object here exists from 20261014224914/20261015042253/
-- 20261017052705, which run first; CREATE OR REPLACE throughout; the constraint swaps are
-- DROP IF EXISTS + ADD in one DO block, so a re-run ends in the same state.

-- 1. The reason list and the reason -> policy rule (the amount rule is unchanged).
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_reason_check
  -- ACK-REASON: re-added on the next line with every reason it allowed plus 'seller_out'; the column is never unchecked once this block commits.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's reason is still in the new list.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage'));   -- slice 5 (20261017052705): full refund, the platform absorbs (row 43)
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_policy
  -- ACK-REASON: re-added on the next line with the same mapping plus 'seller_out' -> full_seller_pays_fee; no existing reason changes policy.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and no existing row has reason 'seller_out', so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      ELSE 'full_platform_absorbs' END);
END
$do$;

-- 2. Record a refund: 'seller_out' is the seller's fault (restated from 20261017052705).
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
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   ELSE 'full_platform_absorbs' END;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id) THEN
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
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;
-- 3. Tell a seller who can no longer sell what the refunded payment costs them.
-- Reads the debt declutter_record_refund booked for this refund and the order
-- that refund belongs to; no debt (a zero card fee) or no seller means nothing to tell.
CREATE OR REPLACE FUNCTION public.declutter_seller_out_fee_notice(p_refund_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_debt integer;
BEGIN
  SELECT d.amount_cents INTO v_debt FROM public.declutter_seller_fee_debts d WHERE d.refund_id = p_refund_id;
  SELECT x.seller_id, x.buyer_id INTO o
    FROM public.declutter_refunds r JOIN public.declutter_orders x ON x.id = r.order_id
   WHERE r.id = p_refund_id;
  IF o.seller_id IS NULL OR v_debt IS NULL OR v_debt <= 0 THEN
    RETURN;
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Card fee owed',
    format('A buyer paid for your items while your account can''t sell on Declutter, so they get every cent back. The $%s card fee for that payment comes out of your future Declutter payouts.',
           to_char(v_debt / 100.0, 'FM999990.00')),
    '/declutter?view=sales', o.buyer_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_out_fee_notice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_out_fee_notice(uuid) TO service_role;

-- 4. The webhook's call, with the three seller-out paths (restated from 20261014224914).
CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_honour boolean := false;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_sale_ok boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.status IN ('paid', 'refunded') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  IF p_amount_cents IS DISTINCT FROM o.total_cents THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes; the sale stands if
      -- every item is still unsold and the seller can still sell to them.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      v_sale_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status <> 'live')
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'))
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      v_honour := v_sale_ok AND NOT v_cant;
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
        -- thing that stops the sale, the seller (not us) owes the card fee; the
        -- buyer still gets every cent. An item that went elsewhere is ours.
        v_reason := CASE WHEN v_sale_ok AND v_cant THEN 'seller_out' ELSE 'sold_elsewhere' END;
        v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
        IF v_reason = 'seller_out' THEN
          PERFORM public.declutter_seller_out_fee_notice(v_refund);
        END IF;
        RETURN public.declutter_refund_answer(v_refund);
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'live';
        FOR v_void IN
          UPDATE public.declutter_offers SET status = 'voided', closed_at = now(), updated_at = now()
           WHERE item_id = r.item_id AND status = 'open'
          RETURNING id, buyer_id
        LOOP
          INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (v_void.id, 'system', 'void');
          PERFORM public.declutter_notify(v_void.buyer_id, 'new_offers', 'Item no longer available',
            format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', r.title),
            '/declutter/item/' || r.item_id::text, o.seller_id);
        END LOOP;
      END LOOP;
      UPDATE public.declutter_cart_items SET status = 'paid', closed_at = now()
       WHERE order_id = p_order_id AND status = 'missed';
      UPDATE public.declutter_orders
         SET status = 'paid', close_reason = NULL, closed_at = NULL, paid_at = now(), stripe_paid_at = p_paid_at,
             stripe_payment_intent_id = p_payment_intent_id,
             card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
       WHERE id = p_order_id AND status = 'expired';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
        format('You paid $%s in time, so the sale stands and there is no strike. Next: pick up your items at the time you chose.',
               to_char(o.total_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for $%s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               to_char(o.items_cents / 100.0, 'FM999990.00')),
        '/declutter?view=offers', o.buyer_id);
      RETURN jsonb_build_object('result', 'paid');
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid $%s. Next: pick up your items at the time you chose.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for $%s of your items. You get paid when the buyer has them.', to_char(o.items_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', o.buyer_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;
