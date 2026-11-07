-- Shops custom orders, 50% deposit: an order paid in TWO charges (the deposit, then the rest) is paid out, refunded
-- and kept safe correctly (Builder 4, 11-07; lh-money-escrow review ~/.lh-shots/handoffs-1106/b4-money-review.md,
-- "Additional money finding" + change 1; LEAD 11-07 OK on the smallest fix, option B for refunds).
--
-- What was wrong (on the unlanded deposit stack only; shops_order_custom_quote still refuses deposit_not_ready, so no
-- member can reach any of it):
--   a. The shop's payout for a deposit order whose rest was paid sent the WHOLE items amount from the deposit charge
--      alone (declutter-money, source_transaction = the deposit). The deposit holds about half, and Stripe refuses a
--      transfer above its source charge, so every such payout would fail. Nothing read the rest's charge.
--   b. shop_refund_amounts kept only the deposit charge's card fee once the rest was paid (paid = the whole total).
--   c. A refund of such an order would be sent from the deposit charge alone (one shop_refunds row, one PaymentIntent),
--      which cannot hold it; a hand refund on the rest's charge was "not a Shops order".
--   d. A Helpr's delivery pay comes from the order's charge (20261106194913) and would draw the whole delivery price
--      from the deposit charge, which holds only half of it.
--
-- The fix:
--   1. shop_order_deposit_shop_cents(o): the shop's part INSIDE the deposit charge, from the split frozen at the hold
--      (20261106212437: the rest takes the floor half of items, premium, delivery and tax): items - items/2, plus
--      delivery - delivery/2 when the shop delivers. The rest charge holds items/2 (+ delivery/2): the two sum to
--      shop_order_shop_cents once the rest is paid. NULL for every order not paid in two charges.
--      shop_payouts_due (RESTATED from 20261106194913, newest) also returns balance_payment_intent_id and that share;
--      declutter-money sends the deposit leg = min(amount, share) from the deposit charge and the rest leg (what is
--      left) from the rest's charge, keys shop-payout-<id> and shop-payout-<id>-rest. Both legs come from frozen
--      columns, so a retry rebuilds the same amounts and keys. shop_payout_rest_sent records the rest leg's transfer.
--   2. shop_refund_amounts (RESTATED from 20261106212437, newest): once the rest is paid, the card fee is both charges'
--      fees (the rest's recorded fee, or its estimate when Stripe's was not read).
--   3. OPTION B (LEAD 11-07): no app refund is ever sent across two charges. A shop_refunds row of an order paid in two
--      charges is written straight to held_for_review (payout_held_check already logs it for ops every day and lists it
--      on the admin money page), a row already pending when the rest is paid is held then, and releasing one back to
--      the automatic queue is refused (two_charge_refund_by_hand): the admin refunds it in Stripe and settles it by hand.
--      shop_record_hand_refund (RESTATED from 20261019071055, its only body) finds the order by the rest's
--      PaymentIntent too, so a hand refund there is recorded and holds the order like one on the deposit.
--      The automatic two-leg refund is its own NOT-LAUNCHED item (option A).
--   4. A deposit order is never delivered by a Helpr (CHECK shop_orders_deposit_no_helpr_delivery).
-- MONEY: yes (lh-money-escrow). SILENT FAILURE: the held row's daily ops log (lh-silent-failure). AUTHZ: service-only
--   functions and triggers; no member grant changes.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraints added only when missing, DROP/CREATE OR REPLACE, triggers dropped
--   first, grants restated.

-- 1. The shop's share of the deposit charge, and the payout queue that carries it.
ALTER TABLE public.shop_payouts
  ADD COLUMN IF NOT EXISTS rest_transfer_id text;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_payouts_rest_transfer_id_check'
                    AND conrelid = 'public.shop_payouts'::regclass) THEN
    ALTER TABLE public.shop_payouts ADD CONSTRAINT shop_payouts_rest_transfer_id_check
      CHECK (rest_transfer_id IS NULL OR rest_transfer_id ~ '^tr_[A-Za-z0-9]+$');
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.shop_order_two_charges(o public.shop_orders)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.payment_plan = 'deposit_50' AND o.balance_captured_at IS NOT NULL AND o.balance_payment_intent_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_two_charges(public.shop_orders) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_two_charges(public.shop_orders) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_order_deposit_shop_cents(o public.shop_orders)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN public.shop_order_two_charges(o)
              THEN (o.items_cents - o.items_cents / 2)
                   + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents - o.delivery_cents / 2 ELSE 0 END
         END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_deposit_shop_cents(public.shop_orders) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_deposit_shop_cents(public.shop_orders) TO service_role;

-- RESTATED from 20261106194913_shops_helpr_delivery.sql (newest CREATE): two more columns, the WHERE unchanged.
DROP FUNCTION IF EXISTS public.shop_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.shop_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, livemode boolean, checkout_session_id text, attempts integer,
               refunds_recorded_cents integer, balance_payment_intent_id text, deposit_shop_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, o.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id,
         o.payment_livemode, o.stripe_checkout_session_id, p.attempts,
         public.shop_order_refunds_recorded_cents(o.id),
         -- 11-07: an order paid in two charges is paid out from both (one leg each), never the deposit alone.
         CASE WHEN public.shop_order_two_charges(o) THEN o.balance_payment_intent_id END,
         public.shop_order_deposit_shop_cents(o)
    FROM public.shop_payouts p
    JOIN public.shop_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = o.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND (o.status = 'handed_over'
          OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = p.order_id AND h.problem_at IS NOT NULL
                       AND h.confirmed_how IS DISTINCT FROM 'admin')
     -- A charge refunded by hand in Stripe never pays the shop from here (section 13).
     AND NOT public.shop_order_unaccounted_hand_refund(p.order_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payouts_due(integer) TO service_role;

-- The rest leg's transfer, recorded before the row is marked sent (shop_payout_executed records the deposit leg).
-- Idempotent: the same id again is a no-op; a DIFFERENT id is refused (two rest transfers would pay the shop twice).
CREATE OR REPLACE FUNCTION public.shop_payout_rest_sent(p_payout_id uuid, p_transfer_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_have text;
BEGIN
  IF p_transfer_id IS NULL OR p_transfer_id !~ '^tr_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  SELECT rest_transfer_id INTO v_have FROM public.shop_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_have IS NOT NULL AND v_have <> p_transfer_id THEN
    RAISE EXCEPTION 'rest_transfer_differs' USING ERRCODE = '55000',
      HINT = 'This payout already records a different transfer for the rest of the order.';
  END IF;
  UPDATE public.shop_payouts SET rest_transfer_id = p_transfer_id WHERE id = p_payout_id AND rest_transfer_id IS NULL;
  RETURN 'recorded';
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_payout_rest_sent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payout_rest_sent(uuid, text) TO service_role;

-- 2. RESTATED from 20261106212437_shops_custom_deposit_split.sql (newest CREATE): once the rest is paid, the card fee
--    kept is BOTH charges' fees (each the recorded one, else its estimate on that charge). Only that line changes.
CREATE OR REPLACE FUNCTION public.shop_refund_amounts(p_order_id uuid, p_reason text)
RETURNS TABLE (fee_policy text, paid_cents integer, tax_cents integer, card_fee_cents integer,
               kept_cents integer, tax_kept_cents integer, refund_cents integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH o AS (
    -- Helpr delivery (20261106194913): the delivery price already given back, or earned by the Helpr who picked
    -- the order up, is never refunded again; the card fee is prorated to the part refunded (Declutter's rule,
    -- declutter_card_fee_left).
    -- Slice 2a: "paid" is what the order's payment really took: the deposit while a deposit order's rest is unpaid
    -- (its tax share is the tax less the rest's half; its delivery share is the delivery less the rest's half, and no
    -- more of the reserved delivery than that), otherwise the whole sale, exactly as before.
    SELECT p.paid - p.reserved AS total_cents, p.tax AS tax_cents,
           public.declutter_card_fee_left(
             least(p.paid, COALESCE(p.card_fee_cents, public.declutter_card_fee_estimate(p.paid))),
             p.paid, p.reserved) AS fee,
           public.shop_refund_fee_policy(p_reason) AS policy
      FROM (SELECT CASE WHEN public.shop_order_balance_open(so) THEN so.total_cents - so.balance_cents ELSE so.total_cents END AS paid,
                   CASE WHEN public.shop_order_balance_open(so) THEN so.tax_cents - so.tax_cents / 2 ELSE so.tax_cents END AS tax,
                   CASE WHEN public.shop_order_balance_open(so)
                        THEN least(public.shop_delivery_reserved_cents(so.id), so.delivery_cents - so.delivery_cents / 2)
                        ELSE public.shop_delivery_reserved_cents(so.id) END AS reserved,
                   -- 11-07 (money review change 1): a deposit order whose rest is paid was charged twice, and each
                   -- charge took its own card fee: the deposit's (recorded, else estimated on the deposit charge) plus
                   -- the rest's (recorded by shop_balance_paid, else estimated on the rest).
                   CASE WHEN public.shop_order_two_charges(so)
                        THEN COALESCE(so.card_fee_cents, public.declutter_card_fee_estimate(so.deposit_cents))
                             + COALESCE(so.balance_card_fee_cents, public.declutter_card_fee_estimate(so.balance_cents))
                        ELSE so.card_fee_cents END AS card_fee_cents
              FROM public.shop_orders so WHERE so.id = p_order_id) p
  ), k AS (
    SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept FROM o
  )
  SELECT k.policy, k.total_cents, k.tax_cents, k.fee, k.kept,
         public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents),
         k.total_cents - k.kept - public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents)
    FROM k;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_amounts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_amounts(uuid, text) TO service_role;

-- 3. Option B: a refund of an order paid in two charges is decided by a person, never sent by the queue.
CREATE OR REPLACE FUNCTION public.shop_refunds_two_charge_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF NEW.status NOT IN ('pending', 'failed') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR NOT public.shop_order_two_charges(o) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'held_for_review' THEN
    RAISE EXCEPTION 'two_charge_refund_by_hand' USING ERRCODE = '55000',
      HINT = 'This order was paid in two charges, so the app cannot send its refund. Refund it in Stripe and settle it by hand.';
  END IF;
  NEW.status := 'held_for_review';
  NEW.review_held_at := now();
  NEW.review_reason := 'two_charges: this order was paid in two charges (the deposit and the rest), so the app does not '
    || 'send its refund. Refund it in Stripe from the two payments and settle this row by hand.';
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refunds_two_charge_hold() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_refunds_two_charge_hold ON public.shop_refunds;
CREATE TRIGGER trg_shop_refunds_two_charge_hold
  BEFORE INSERT OR UPDATE OF status ON public.shop_refunds
  FOR EACH ROW EXECUTE FUNCTION public.shop_refunds_two_charge_hold();

-- A refund row still unsent when the rest is paid is held then (it was sized for the deposit alone).
CREATE OR REPLACE FUNCTION public.shop_orders_two_charge_hold_refunds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.balance_captured_at IS NULL AND NEW.balance_captured_at IS NOT NULL AND public.shop_order_two_charges(NEW) THEN
    UPDATE public.shop_refunds
       SET status = 'held_for_review', review_held_at = now(),
           review_reason = 'two_charges: the rest of this order was paid after this refund was written, so the app does not '
             || 'send it. Refund it in Stripe from the two payments and settle this row by hand.'
     WHERE order_id = NEW.id AND status IN ('pending', 'failed');
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_two_charge_hold_refunds() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_two_charge_hold_refunds ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_two_charge_hold_refunds
  AFTER UPDATE OF balance_captured_at ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_two_charge_hold_refunds();

-- 4. A deposit order is never delivered by a Helpr (its pay would come from the deposit charge alone).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_deposit_no_helpr_delivery'
                    AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_deposit_no_helpr_delivery
      CHECK (payment_plan <> 'deposit_50' OR fulfillment IS DISTINCT FROM 'helpr_delivers');
  END IF;
END;
$do$;

-- 3b. RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (its only CREATE): the order lookup reads the rest's
--     PaymentIntent too. Nothing else changes.
CREATE OR REPLACE FUNCTION public.shop_record_hand_refund(p_payment_intent_id text, p_stripe_refund_id text,
  p_amount_cents integer, p_livemode boolean, p_how text, p_admin uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  r public.shop_refunds;
  p public.shop_payouts;
  v_prior public.shop_hand_refunds;
  v_covered bigint;
  v_outcome text;
  v_full boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_'
     OR p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$'
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_how IS NULL OR p_how NOT IN ('webhook', 'admin') THEN
    RAISE EXCEPTION 'invalid_hand_refund' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_prior FROM public.shop_hand_refunds h WHERE h.stripe_refund_id = p_stripe_refund_id;
  IF FOUND THEN
    RETURN CASE WHEN v_prior.stripe_payment_intent_id = p_payment_intent_id THEN 'already' ELSE 'recorded_other_order' END;
  END IF;
  -- The order row lock first (every Shops money path takes it).
  -- 11-07: an order paid in two charges is found by the rest's PaymentIntent too, so a refund made by hand there is
  -- recorded and holds the order exactly like one on the deposit (option B: such refunds are only ever made by hand).
  SELECT * INTO o FROM public.shop_orders
   WHERE stripe_payment_intent_id = p_payment_intent_id
      OR (balance_payment_intent_id = p_payment_intent_id AND payment_plan = 'deposit_50')
   ORDER BY (stripe_payment_intent_id = p_payment_intent_id) DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_shops';
  END IF;
  SELECT * INTO r FROM public.shop_refunds WHERE order_id = o.id FOR UPDATE;
  IF r.id IS NOT NULL AND r.stripe_refund_id = p_stripe_refund_id THEN
    RETURN 'already';
  END IF;
  v_covered := p_amount_cents + COALESCE((SELECT sum(h.amount_cents) FROM public.shop_hand_refunds h
                                           WHERE h.order_id = o.id AND h.failed_at IS NULL), 0);
  v_full := v_covered >= o.total_cents;
  IF o.captured_at IS NULL THEN
    v_outcome := 'recorded_not_charged';
  ELSIF r.id IS NOT NULL THEN
    v_outcome := CASE WHEN r.status = 'succeeded' THEN 'recorded_row_already_settled' ELSE 'recorded_refund_held' END;
  ELSE
    SELECT * INTO p FROM public.shop_payouts WHERE order_id = o.id FOR UPDATE;
    v_outcome := CASE WHEN p.id IS NOT NULL AND p.status IN ('succeeded', 'settled_by_hand') THEN 'recorded_after_payout'
                      WHEN v_full THEN 'closed_refunded' ELSE 'closed_partially_refunded' END;
  END IF;
  INSERT INTO public.shop_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, shop_refund_id, amount_cents,
                                        livemode, recorded_how, recorded_by, outcome, note)
  VALUES (p_stripe_refund_id, p_payment_intent_id, o.id, r.id, p_amount_cents, p_livemode, p_how, p_admin, v_outcome,
          NULLIF(btrim(COALESCE(p_note, '')), ''));
  -- Rule A: the whole order is held (its unsent app refund and its unsent payout).
  PERFORM public.shop_hold_order_for_hand_refund(o.id,
    format('refunded_by_hand: %s ($%s) was refunded in Stripe; decide this row by hand',
           p_stripe_refund_id, to_char(p_amount_cents / 100.0, 'FM999999990.00')));
  IF r.id IS NOT NULL OR v_outcome = 'recorded_not_charged' THEN
    RETURN v_outcome;
  END IF;
  -- No app refund: the order closes (whatever it was), and the shop is not paid by any clock.
  IF o.status = 'accepted' THEN
    PERFORM public.shop_return_stock(o.id);
    DELETE FROM public.shop_cottage_sales WHERE source_ref = o.id;
  END IF;
  IF o.status IN ('accepted', 'handed_over', 'cancelled', 'partially_refunded') THEN
    UPDATE public.shop_orders
       SET status = CASE WHEN v_full THEN 'refunded' ELSE 'partially_refunded' END,
           close_reason = 'refunded_by_hand', closed_at = COALESCE(closed_at, now())
     WHERE id = o.id;
  END IF;
  IF v_outcome <> 'recorded_after_payout' THEN
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
      format('Louisiana Helpr refunded the order for %s to the buyer, so it is not paid out for now. Louisiana Helpr will tell you what happens next.',
             to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN v_outcome;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_record_hand_refund(text, text, integer, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_record_hand_refund(text, text, integer, boolean, text, uuid, text) TO service_role;
