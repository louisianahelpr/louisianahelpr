-- Shipping lost sweep (Q2259; docs/specs/shipping-draft.md 5.3 row "ship_lost"; owner decision 5 "lost or broken in
-- the mail = the seller"). Money: lead PASS (lh-money-escrow) 11-03.
--
-- Before: a parcel the carrier took (acceptance scan) and never delivered left the order 'paid' forever: no payout
-- (the ship sweep pays only after a delivered scan) and no refund for the buyer.
--
-- Now: declutter_ship_sweep closes, under the order lock, every 'paid' + 'ship' + captured order whose bought label was
-- accepted 10+ days ago with no delivered scan and no open problem, as declutter_close_paid_order(o, 'ship_lost', NULL
-- strike side): the buyer gets everything back (items, fee, shipping, tax), the item is withdrawn, the order
-- cancelled_by_seller, NO strike (the carrier lost it). The card fee is the seller's debt (full_seller_pays_fee) and
-- the spent label becomes a ship_label debt (declutter_ship_no_fault_label now also acts on 'ship_lost').
-- 'available_for_pickup' is EXCLUDED (lead 11-03, owner away; reversible): a parcel waiting at the post office is the
-- buyer's to collect and follows the carrier's return-to-sender path.
--
-- Restated objects, each from its NEWEST definition, whose body md5 equals prod's (pg_proc.prosrc / constraint def,
-- read 2026-11-03 ~2:32 PM CT); the only change in each is marked:
--   declutter_refunds_reason_check / _policy  20261102031000  reason 0dc9c6920dea7bd7356f39e0ba010ec0, policy 032bbbf07f201dbcd4763dd127bff81e (md5 of pg_get_constraintdef)
--   declutter_record_refund        20261102080936  ffe25aeb807d4f6ece91e8ae0d4fbc04  ('ship_lost' -> full_seller_pays_fee)
--   declutter_close_paid_order     20261102084222  58bfd6570bc4368642d4b12d802e9a1e  ('ship_lost' joins v_seller_fault)
--   declutter_ship_no_fault_label  20261102055653  01518c414c428196e68b84a092fcb3dc  (acts on 'ship_lost' too)
--   declutter_ship_sweep           20261102045035  ef420ab11c6199556885da2a90be070c  (third loop + 'lost_closed')
-- Replay-safe: the CHECKs are dropped and re-added in one DO block; CREATE OR REPLACE; grants restated as on prod.

DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_reason_check
  -- ACK-REASON: re-added on the next line with every reason it allowed (newest: 20261102031000, = prod's constraint def read 2026-11-03) plus 'ship_lost'; the column is never unchecked once this block commits.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's reason is still in the new list.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage', 'refund_request_full', 'refund_request_part',
    'helpr_fault',
    'delivery_never_booked',
    'ship_lost'));   -- Shipping lost sweep: everything back; the seller pays the card fee and the spent label
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_policy
  -- ACK-REASON: re-added on the next line with the same mapping as 20261102031000 (= prod) plus 'ship_lost' in the full_seller_pays_fee list, as declutter_record_refund's own CASE gives it below.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and no existing row has reason 'ship_lost', so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault', 'ship_lost') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      WHEN reason = 'refund_request_part' THEN 'agreed_part'
                      ELSE 'full_platform_absorbs' END);
END
$do$;

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
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault', 'ship_lost') THEN 'full_seller_pays_fee'
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
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out', 'ship_lost');
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
         -- CHANGED (A3-72): a seller delivery nobody set a time for in 7 days: everything back.
         WHEN p_reason = 'delivery_never_booked'
         THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
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
         -- CHANGED (A3-72)
         WHEN p_reason = 'delivery_never_booked'
         THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_no_fault_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
  v_label record;
  v_kind text;
  v_title text;
  v_id uuid;
BEGIN
  IF NEW.reason IS NULL OR NEW.reason NOT IN ('admin_no_fault', 'ship_lost') OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'ship';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT s.id, s.label_state, s.label_mode, s.accepted_at, s.delivered_at, s.label_cost_cents INTO v_label
    FROM public.shipments s WHERE s.declutter_order_id = NEW.order_id FOR UPDATE;
  IF v_label.id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT i.title INTO v_title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = NEW.order_id ORDER BY c.id LIMIT 1;
  IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL AND v_label.delivered_at IS NULL THEN
    IF v_label.label_mode = 'test' THEN
      UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
       WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL AND delivered_at IS NULL;
      IF v_seller IS NOT NULL THEN
        PERFORM public.declutter_notify(v_seller, 'info', 'Don''t ship it',
          format('The sale of %s was called off, so its shipping label is being cancelled. Don''t put it in the mail.',
                 COALESCE('"' || v_title || '"', 'your item')),
          '/declutter?tab=selling');
      END IF;
    ELSE
      PERFORM public.log_cron_defect('declutter_ship_no_fault_label-live-void', NEW.order_id::text,
        format('order %s was refunded with no one at fault; its LIVE label must be voided by hand (a rejected void is the seller''s debt)', NEW.order_id));
    END IF;
    RETURN NEW;
  END IF;
  v_kind := CASE WHEN v_label.label_state = 'bought' THEN 'ship_label'
                 WHEN v_label.label_state = 'void_rejected' THEN 'ship_void_rejected' END;
  IF v_kind IS NULL OR COALESCE(v_label.label_cost_cents, 0) <= 0 OR v_seller IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_seller) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES (v_seller, v_kind, v_label.id, v_label.label_cost_cents, v_label.label_cost_cents)
  ON CONFLICT (source_kind, source_ref) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.declutter_notify(v_seller, 'info', 'Shipping label added to what you owe',
      format('The shipping label for %s was already used when the buyer was refunded, so its $%s comes out of your next Declutter payout.',
             COALESCE('"' || v_title || '"', 'your sale'), to_char(v_label.label_cost_cents / 100.0, 'FM999999990.00')),
      '/declutter?tab=selling');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_no_fault_label() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_ship_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_done integer := 0;
  v_never integer := 0;
  v_mode text;
  v_lost integer := 0;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
       AND s.delivered_at + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND EXISTS (SELECT 1 FROM public.shipments s
                      WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
                        AND s.delivered_at + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- S6 2b: never shipped by ship-by.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.label_state = 'bought' AND s.accepted_at IS NULL
       AND now() >= public.declutter_ship_by(o2.paid_at)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      SELECT s.label_mode INTO v_mode FROM public.shipments s
       WHERE s.declutter_order_id = o.id AND s.label_state = 'bought' AND s.accepted_at IS NULL
       FOR UPDATE;
      IF FOUND AND o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND now() >= public.declutter_ship_by(o.paid_at)
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        IF v_mode = 'test' THEN
          UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
           WHERE declutter_order_id = o.id AND label_state = 'bought' AND accepted_at IS NULL;
        ELSE
          PERFORM public.log_cron_defect('declutter_ship_sweep-live-void', o.id::text,
            format('order %s was never shipped by its ship-by and was refunded; its LIVE label must be voided by hand', o.id));
        END IF;
        PERFORM public.declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale',
          'You did not ship a paid Declutter order by its ship-by date. The buyer got everything back, shipping included; the cost of that refund comes out of your next Declutter payout.');
        v_never := v_never + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- Shipping lost sweep (20261103203204): handed to the carrier 10 days ago and still no delivered scan.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.label_state = 'bought' AND s.accepted_at IS NOT NULL AND s.accepted_at + interval '10 days' <= now()
       AND s.delivered_at IS NULL AND s.tracking_status IS DISTINCT FROM 'delivered'
       AND s.tracking_status IS DISTINCT FROM 'available_for_pickup'
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      PERFORM 1 FROM public.shipments s
       WHERE s.declutter_order_id = o.id AND s.label_state = 'bought' AND s.accepted_at IS NOT NULL
         AND s.accepted_at + interval '10 days' <= now() AND s.delivered_at IS NULL
         AND s.tracking_status IS DISTINCT FROM 'delivered' AND s.tracking_status IS DISTINCT FROM 'available_for_pickup'
       FOR UPDATE;
      IF FOUND AND o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_close_paid_order(o.id, 'ship_lost', NULL, NULL,
          'Your package was never delivered, 10 days after the carrier took it. The buyer got everything back, shipping included; the label and the card fee come out of your next Declutter payout.');
        v_lost := v_lost + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('delivered_handed_over', v_done, 'never_shipped_closed', v_never, 'lost_closed', v_lost);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_ship_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_sweep() TO service_role;
