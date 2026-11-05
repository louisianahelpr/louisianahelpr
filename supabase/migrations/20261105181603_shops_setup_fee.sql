-- Shops H4 part 2 (audit ~/.lh-shots/audit-1105-shops.md, H4; NOT-LAUNCHED Q1954): the one-time $2 account setup fee,
-- once per account, ever, through the same profiles.onboarding_fee_paid flag and the same one-winner conditional UPDATE
-- as every other path (Jobs first post, release-payout, pay-onboarding-fee, declutter_claim_setup_fee,
-- declutter_payout_take_setup_fee, helpr_task_payout_take_setup_fee). Owner rule (OWNER-DECISIONS.md, 10-30, "once per
-- account"; audit "Settled": the shop owner is Declutter's seller, the buyer is Declutter's buyer).
--
-- A. THE SHOP OWNER: $2 from the first shop payout, exactly Declutter's seller rule (20261031214749 +
--    20261031225132). shop_payouts gets setup_fee_cents (counted inside debt_cents, so the amount CHECK
--    amount = items - debt holds with no change) and the sticky send_tried marker (payout_send_tried_sticky, the
--    trigger the Declutter and Helpr rows already wear). shop_payout_take_setup_fee is
--    declutter_payout_take_setup_fee for a shop row: same skips (a row a send was ever tried for, a send mark, a fee
--    already on it, a payout that would send under $1), same exemption (declutter_setup_fee_from_payout_cents: 0
--    while identity_check is off for them, and for an admin). declutter-money calls it right before the transfer,
--    only when no send can have started (maybeSent_shop). A shop payout is never rebooked after it is written (the
--    order is final at handover, a late cancel or a no-show), so no put-back function is needed on this side.
--
-- B. THE BUYER: $2 on the first shop order, Declutter's buyer rule (20261026154738) fitted to a card HOLD.
--   1. shop_orders.setup_fee_cents is frozen when the order is written (a BEFORE INSERT trigger, so
--      shops_request_order is not restated): declutter_setup_fee_due_cents(buyer), the same amount Declutter's
--      checkout freezes. It sits OUTSIDE total_cents, so every refund (computed from total_cents) keeps it, as a
--      Declutter or Jobs refund keeps it. It never changes after.
--   2. shop-checkout adds a "One-time account setup fee" line (non-taxable), so the hold is total + fee.
--   3. The claim happens when the hold lands (shop_mark_order_held, service context), with the one-winner UPDATE.
--      If another path paid the fee while the buyer was on the page (a 31-minute window), the hold is cancelled at
--      no cost and the buyer orders again without the fee: nothing is charged twice and no fee refund is ever
--      needed (a refund on the order's charge would also stop the shop's payout, which pays only from a whole
--      charge).
--   4. A hold that ends WITHOUT being captured (declined, no answer, withdrawn, capture lost or given up) puts the
--      fee back: the trigger trg_shop_orders_setup_fee_put_back clears the flag when hold_released_at is set on an
--      uncaptured order that claimed it. hold_released_at is written only by shop_hold_released and
--      shop_order_capture_failed (both service only), and shop_holds_to_release brings every closed held order
--      there. So a declined or expired hold never leaves the fee marked paid: it is only kept on a captured order.
--   5. shop_order_captured's "your card was charged" notice names the fee.
--   An old page (opened before shop-checkout learned the fee) pays total_cents alone: accepted, the order marked
--   not_charged, nothing claimed, the account still owes the fee at its next first-time step.
--
-- Restated from their NEWEST CREATE (only the lines marked H4-fee change):
--   shop_mark_order_held  20261018164442_shops_orders_checkout.sql
--   shop_order_captured   20261103112014_money_records_and_buy_lock_not_found_is_404.sql
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints in guarded DO blocks, CREATE OR REPLACE with unchanged
-- signatures, DROP TRIGGER IF EXISTS, grants restated.
-- Proof: src/test/pglite/shopsSetupFee.pglite.mjs (applied 3x; --before is red). Guard: src/test/shopsSetupFee.test.ts.

-- ---------------------------------------------------------------------------
-- A. The shop owner's fee, from the first payout.

ALTER TABLE public.shop_payouts ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_payouts ADD COLUMN IF NOT EXISTS send_tried boolean NOT NULL DEFAULT false;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_payouts_setup_fee'
                   AND conrelid = 'public.shop_payouts'::regclass) THEN
    ALTER TABLE public.shop_payouts ADD CONSTRAINT shop_payouts_setup_fee
      CHECK (setup_fee_cents >= 0 AND setup_fee_cents <= 10000 AND setup_fee_cents <= debt_cents);
  END IF;
END
$do$;
COMMENT ON COLUMN public.shop_payouts.setup_fee_cents IS
  'The one-time account setup fee taken out of this shop payout (owner 2026-10-30). Also counted inside debt_cents, so the amount CHECK holds. 0 for almost every row.';
GRANT SELECT (setup_fee_cents) ON TABLE public.shop_payouts TO authenticated;

DROP TRIGGER IF EXISTS trg_shop_payouts_send_tried ON public.shop_payouts;
CREATE TRIGGER trg_shop_payouts_send_tried BEFORE INSERT OR UPDATE ON public.shop_payouts
  FOR EACH ROW EXECUTE FUNCTION public.payout_send_tried_sticky();

UPDATE public.shop_payouts p SET send_tried = true
 WHERE NOT p.send_tried
   AND (p.attempts > 0 OR p.last_error IS NOT NULL OR p.executed_at IS NOT NULL OR p.review_held_at IS NOT NULL
        OR p.stripe_transfer_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'shop' AND m.payout_id = p.id));

-- Right before the transfer: take the fee once and answer the amount to send. Idempotent: a row that already carries
-- the fee answers its stored amount, so a retry sends the same amount under the same Stripe key (shop-payout-<id>).
CREATE OR REPLACE FUNCTION public.shop_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.shop_payouts;
  v_seller uuid;
  v_ready date;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.shop_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- A row a send was ever tried for keeps its amount, even after an admin release put attempts back to 0: its
  -- Stripe key may already carry the old amount.
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.send_tried
     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'shop' AND m.payout_id = p.id) THEN
    RETURN p.amount_cents;
  END IF;
  SELECT o.seller_id, o.ready_date INTO v_seller, v_ready FROM public.shop_orders o WHERE o.id = p.order_id;
  IF v_seller IS NULL THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(v_seller);
  IF v_fee <= 0 OR p.amount_cents - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = v_seller AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.shop_payouts
     SET setup_fee_cents = v_fee, debt_cents = debt_cents + v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(v_seller, 'payment', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your payout for the order for %s, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), to_char(v_ready, 'FMMonth FMDD'), to_char(v_amount / 100.0, 'FM999990.00')),
    '/shops/dashboard', NULL);
  RETURN v_amount;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payout_take_setup_fee(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- B. The buyer's fee, on the first order.

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_fee_state text;
COMMENT ON COLUMN public.shop_orders.setup_fee_cents IS
  'H4: the one-time account setup fee this order''s page carries, outside total_cents (0 when the buyer had paid it). Frozen at insert.';
COMMENT ON COLUMN public.shop_orders.setup_fee_state IS
  'H4: NULL until the hold lands; claimed (this order holds the account''s fee), put_back (the hold ended uncaptured, the account owes it again), paid_elsewhere (another path paid it first: the hold was cancelled), not_charged (the page did not carry it).';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_setup_fee'
                   AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_setup_fee
      CHECK (setup_fee_cents >= 0 AND setup_fee_cents <= 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_setup_fee_state'
                   AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_setup_fee_state
      CHECK (setup_fee_state IS NULL
             OR (setup_fee_cents > 0 AND setup_fee_state IN ('claimed', 'put_back', 'paid_elsewhere', 'not_charged')));
  END IF;
END
$do$;
GRANT SELECT (setup_fee_cents, setup_fee_state) ON TABLE public.shop_orders TO authenticated;

-- 1. Frozen at insert, never changed after. Whatever a writer passes is replaced by the buyer's due amount.
CREATE OR REPLACE FUNCTION public.shop_orders_setup_fee_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.setup_fee_cents := public.declutter_setup_fee_due_cents(NEW.buyer_id);
    NEW.setup_fee_state := NULL;
    RETURN NEW;
  END IF;
  IF NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents THEN
    RAISE EXCEPTION 'order_amounts_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_setup_fee_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_setup_fee_frozen ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_setup_fee_frozen BEFORE INSERT OR UPDATE OF setup_fee_cents ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_setup_fee_frozen();

-- 4. A hold that ends uncaptured gives the fee back. Only the order that claimed it clears the flag, and only when
-- the flag really went false (a member-context write would be undone by prevent_self_escalation: then the state
-- stays 'claimed' rather than saying put_back while the account still reads paid).
CREATE OR REPLACE FUNCTION public.shop_orders_setup_fee_put_back()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_paid boolean;
BEGIN
  IF NEW.setup_fee_state = 'claimed' AND NEW.captured_at IS NULL
     AND OLD.hold_released_at IS NULL AND NEW.hold_released_at IS NOT NULL AND NEW.buyer_id IS NOT NULL THEN
    UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL
     WHERE user_id = NEW.buyer_id
    RETURNING onboarding_fee_paid INTO v_paid;
    IF v_paid IS NOT TRUE THEN
      NEW.setup_fee_state := 'put_back';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_setup_fee_put_back() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_setup_fee_put_back ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_setup_fee_put_back BEFORE UPDATE OF hold_released_at ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_setup_fee_put_back();

-- 3. The hold lands. Restated from 20261018164442 (newest CREATE); only the H4-fee lines change.
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
  -- H4-fee: the page carries the frozen setup fee on top of total (items + fee + tax), or, for a page opened
  -- before shop-checkout learned the fee, total alone (then nothing is claimed: not_charged).
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total IS NOT DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents + o.setup_fee_cents;
  IF p_tax_cents IS NULL OR p_tax_cents < 0
     OR (NOT v_fee_charged AND p_amount_total IS DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents) THEN
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
  IF v_cap IS NOT NULL AND public.shop_day_count(o.seller_id, o.ready_date, ARRAY['held', 'accepted', 'handed_over']) >= v_cap THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'day_full', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'That day filled up',
      'Another order took the last spot that day, so nothing was charged and the hold on your card was released. Pick another day.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'day_full', 'order_id', o.id);
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
         total_cents = p_amount_total - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now() + interval '24 hours'
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New order',
    format('A new order for %s is waiting. Accept or decline it within 24 hours, or it drops.', to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order sent',
    format('Your card is held, not charged. %s has 24 hours to accept; you are charged only if they do.', COALESCE(v_shop_name, 'The shop')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'held', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) TO service_role;

-- 5. The capture. Restated from 20261103112014 (newest CREATE); only the H4-fee lines change.
CREATE OR REPLACE FUNCTION public.shop_order_captured(p_order_id uuid, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_home_food integer;
  v_fee integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_captured', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_accepted' USING ERRCODE = '55000';
  END IF;
  -- H4-fee: what the card paid on top of the sale (0 unless this order holds the account's fee).
  v_fee := CASE WHEN o.setup_fee_state = 'claimed' THEN o.setup_fee_cents ELSE 0 END;
  UPDATE public.shop_orders
     SET captured_at = now(), capture_last_error = NULL,
         card_fee_cents = least(o.total_cents, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents + v_fee)))
   WHERE id = o.id;
  -- L8: the app counts its own home-food sales (once per order: source_ref UNIQUE).
  SELECT COALESCE(sum(line_cents), 0)::integer INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, is_seed)
    VALUES (o.seller_id, o.id, v_home_food, o.is_seed)
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order accepted',
    format('The shop accepted your order for %s and your card was charged $%s%s.', to_char(o.ready_date, 'FMMonth FMDD'),
           to_char((o.total_cents + v_fee) / 100.0, 'FM999999990.00'),
           CASE WHEN v_fee > 0
             THEN format(', including the one-time $%s account setup fee (charged once per account)', to_char(v_fee / 100.0, 'FM999990.00'))
             ELSE '' END),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_captured(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_captured(uuid, integer) TO service_role;
