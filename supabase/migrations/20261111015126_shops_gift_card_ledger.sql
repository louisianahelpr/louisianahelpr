-- Q2105 step 1 (Builder 2, 11-10; template: Declutter's Q2106 stack, 20261105030604_declutter_gift_cards): the gift
-- ledger learns Shops orders. NOTHING CALLS THIS YET (service_role only); shop-checkout's gift path, the capture
-- remainder and the gift-paid accept path are step 2.
--   * gift_cards.shop_order_id (reserved or redeemed for that order) and split_for_shop_order_id (a leftover split off
--     when the gift was applied to that order); shop_orders gains gift_cents (what the gift pays toward the order, 0
--     with no gift) and gift_card_id.
--   * The Shops difference is the HELD order: the gift is RESERVED at request (status awaiting_hold, before the card
--     page opens), REDEEMED at capture (captured_at set by shop_order_captured; the maker said yes and the card's
--     remainder was taken), and PUT BACK when the order closes any other way (declined, expired, cancelled,
--     superseded: no answer, page unpaid, buyer withdrew, hold lost). One trigger does both, so no close path needs
--     its own put-back.
--   * redeem_gift_card_for_shop_order(p_credit_id, p_order_id, p_user_id, p_tax_cents, p_retired_session): the jobs
--     rules (named recipient, paid, not expired, sent/available or reserved for this order, no card page open but the
--     one the caller retired). Before the hold an order's total_cents has no tax in it (shop-checkout works the tax out
--     and the hold step writes it), so the caller passes the tax it calculated: the RPC writes it on the order
--     (tax_cents, and total_cents = the pre-tax total + it; idempotent on a re-apply) so the gift and the 50-cent check
--     are sized on the real price. The gift pays min(order price, gift); the order price is total_cents +
--     setup_fee_cents, what the card page asks for (H4: the one-time setup fee lives outside total_cents, as
--     Declutter's). The leftover is split off as the buyer's child gift and the gift
--     is LOWERED to what it pays (Q1728 no-doubling: a put-back returns the lowered gift, the child is already the
--     buyer's). A card remainder of 1-49 cents is refused with a sentence before anything changes (Stripe's 0.50 USD
--     minimum). A gift that covers the whole order is reserved too (outcome 'covered'): the order has no hold, so its
--     accept path (step 2) must set captured_at in the SAME update that sets 'accepted' (handed_over requires
--     captured_at, 20261018211820, and shop_captures_due cancels an accepted order left uncaptured); the trigger then
--     redeems it like any capture. Until then it is put back like any reserved gift when the order closes.
--   * Redeem ONLY at capture (captured_at set), and put back ONLY on the four closes before capture (declined,
--     expired, cancelled, superseded): any other status change leaves a reserved gift where it is.
--   * Only a full-hold order takes a gift for now (payment_plan 'full_hold'): a 50% deposit order captures twice, and
--     which capture spends the gift is a step 2 decision, so it is refused with a sentence.
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS. Grants service_role only.
-- Proof: src/test/pglite/shopsGiftCards.pglite.mjs (NEW_MIGRATION=skip red).

ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS shop_order_id uuid;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS split_for_shop_order_id uuid;
COMMENT ON COLUMN public.gift_cards.shop_order_id IS
  'The Shops order this gift is reserved or redeemed for (Q2105). No FK, as job_id: a deleted order must not erase the trail.';
COMMENT ON COLUMN public.gift_cards.split_for_shop_order_id IS
  'Set on a leftover split off when its parent was applied to this Shops order (Q2105). The parent''s amount was lowered by it.';
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS gift_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS gift_card_id uuid;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_gift_cents_check') THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_gift_cents_check CHECK (gift_cents >= 0 AND gift_cents <= total_cents + setup_fee_cents);
  END IF;
END
$do$;
COMMENT ON COLUMN public.shop_orders.gift_cents IS
  'What the buyer''s gift card pays toward this order (Q2105); the card pays total_cents + setup_fee_cents - gift_cents.';

CREATE OR REPLACE FUNCTION public.redeem_gift_card_for_shop_order(p_credit_id uuid, p_order_id uuid, p_user_id uuid,
  p_tax_cents integer, p_retired_session text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o                  record;
  v_credit           record;
  v_cost_cents       integer;
  v_total_cents      integer;
  v_credit_cents     integer;
  v_applied_cents    integer;
  v_leftover_cents   integer;
  v_difference_cents integer;
BEGIN
  IF p_credit_id IS NULL OR p_order_id IS NULL OR p_user_id IS NULL OR p_tax_cents IS NULL OR p_tax_cents < 0 THEN
    RAISE EXCEPTION 'p_credit_id, p_order_id, p_user_id and a p_tax_cents of 0 or more are required' USING ERRCODE = '22023';
  END IF;
  -- Lock the order, then the credit (the jobs order: what is paid for first).
  SELECT id, buyer_id, status, total_cents, tax_cents, setup_fee_cents, payment_plan, gift_cents, gift_card_id,
         stripe_checkout_session_id
    INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'PT404';
  END IF;
  IF o.buyer_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'This is not your order' USING ERRCODE = '42501';
  END IF;
  -- Only before the hold: once the card is held (or the order closed) the amounts are what Stripe holds.
  IF o.status <> 'awaiting_hold' THEN
    RAISE EXCEPTION 'This order can no longer take a gift' USING ERRCODE = 'P0001';
  END IF;
  IF o.payment_plan IS DISTINCT FROM 'full_hold' THEN
    RAISE EXCEPTION 'A gift card cannot pay toward a deposit order yet. Pay this order by card, or order it paid in full.' USING ERRCODE = 'P0001';
  END IF;
  -- A card page opened for this order, other than the one the caller just closed, may still be paid: applying the
  -- gift now could hold the buyer's card for the full price AND spend the gift (the jobs Q975 race 15 rule).
  IF o.stripe_checkout_session_id IS NOT NULL AND o.stripe_checkout_session_id IS DISTINCT FROM p_retired_session THEN
    RAISE EXCEPTION 'A card payment for this order is already open. Finish it or wait a moment, then use the gift.' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, donor_id, recipient_id, recipient_email, amount, status, payment_status, category, message,
         job_id, declutter_order_id, shop_order_id, expires_at
    INTO v_credit FROM public.gift_cards WHERE id = p_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_credit.recipient_id IS NULL OR v_credit.recipient_id <> p_user_id THEN
    RAISE EXCEPTION 'This gift is not yours to redeem' USING ERRCODE = '42501';
  END IF;
  IF v_credit.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'This gift has not been funded yet' USING ERRCODE = 'P0001';
  END IF;
  IF v_credit.expires_at IS NOT NULL AND v_credit.expires_at < now() THEN
    RAISE EXCEPTION 'This gift has expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_credit.status = 'reserved' THEN
    IF v_credit.shop_order_id IS DISTINCT FROM p_order_id OR v_credit.job_id IS NOT NULL
       OR v_credit.declutter_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'This gift is set aside for something else' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_credit.status NOT IN ('sent', 'available') THEN
    RAISE EXCEPTION 'This gift is no longer available' USING ERRCODE = 'P0001';
  END IF;

  -- The pre-tax total is total_cents less any tax an earlier apply wrote, so a re-apply never adds the tax twice.
  v_total_cents      := o.total_cents - o.tax_cents + p_tax_cents;
  v_cost_cents       := v_total_cents + o.setup_fee_cents;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_cost_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_cost_cents - v_applied_cents;
  IF v_cost_cents <= 0 OR v_applied_cents <= 0 THEN
    RAISE EXCEPTION 'This gift has nothing left to spend' USING ERRCODE = 'P0001';
  END IF;
  -- Stripe refuses a card hold under 0.50 USD: refuse BEFORE anything is reserved (the jobs Q1213 rule).
  IF v_difference_cents > 0 AND v_difference_cents < 50 THEN
    RAISE EXCEPTION 'Your gift covers all but $%.% of this order, and a card payment has to be at least $0.50. Change the order so the gift covers all of it, or leaves at least $0.50 to pay by card.',
      v_difference_cents / 100, lpad((v_difference_cents % 100)::text, 2, '0')
      USING ERRCODE = 'P0001';
  END IF;

  -- Another gift set aside for this order with no page open: back to the buyer first. It was lowered when it was
  -- applied and its leftover is already the buyer's, so 'sent' at its amount conserves value.
  IF o.gift_card_id IS NOT NULL AND o.gift_card_id <> p_credit_id THEN
    UPDATE public.gift_cards SET status = 'sent', shop_order_id = NULL
     WHERE id = o.gift_card_id AND status = 'reserved' AND shop_order_id = p_order_id;
  END IF;

  -- Reserved (never redeemed here): the capture redeems it. The gift is lowered to what it pays; the leftover is split
  -- off now as the buyer's own child gift.
  UPDATE public.gift_cards
     SET status = 'reserved', shop_order_id = p_order_id, amount = v_applied_cents::numeric / 100
   WHERE id = p_credit_id;
  IF v_leftover_cents > 0 THEN
    INSERT INTO public.gift_cards (donor_id, recipient_id, recipient_email, amount, status, payment_status, category,
                                   message, parent_credit_id, split_for_shop_order_id)
    VALUES (v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email, v_leftover_cents::numeric / 100,
            'sent', 'paid', v_credit.category, v_credit.message, p_credit_id, p_order_id);
  END IF;
  UPDATE public.shop_orders SET gift_cents = v_applied_cents, gift_card_id = p_credit_id,
         tax_cents = p_tax_cents, total_cents = v_total_cents,
         stripe_checkout_session_id = CASE WHEN stripe_checkout_session_id IS NOT DISTINCT FROM p_retired_session
                                           THEN NULL ELSE stripe_checkout_session_id END
   WHERE id = p_order_id;

  RETURN jsonb_build_object('outcome', CASE WHEN v_difference_cents > 0 THEN 'needs_hold' ELSE 'covered' END,
    'difference_cents', v_difference_cents, 'applied_cents', v_applied_cents, 'leftover_cents', v_leftover_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.redeem_gift_card_for_shop_order(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card_for_shop_order(uuid, uuid, uuid, integer, text) TO service_role;

-- The gift follows the order: captured -> the reserved gift is redeemed (a covered order's step 2 accept sets
-- captured_at with 'accepted'); one of the four closes before capture -> back to 'sent'.
-- 'accepted' alone does not redeem: shops_accept_order sets it BEFORE the capture, and a capture Stripe never
-- completes closes the order 'cancelled' (hold_lost / capture_gave_up), which puts the gift back.
CREATE OR REPLACE FUNCTION public.shop_order_gift_follows_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.captured_at IS NOT NULL AND OLD.captured_at IS NULL THEN
    UPDATE public.gift_cards SET status = 'redeemed', redeemed_at = now()
     WHERE id = NEW.gift_card_id AND shop_order_id = NEW.id AND status = 'reserved';
  ELSIF NEW.status IN ('declined', 'expired', 'cancelled', 'superseded') AND NEW.captured_at IS NULL THEN
    UPDATE public.gift_cards SET status = 'sent', shop_order_id = NULL
     WHERE id = NEW.gift_card_id AND shop_order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_gift_follows_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_gift_follows_status ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_gift_follows_status
  AFTER UPDATE OF status, captured_at ON public.shop_orders
  FOR EACH ROW
  WHEN (NEW.gift_card_id IS NOT NULL
        AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.captured_at IS DISTINCT FROM OLD.captured_at))
  EXECUTE FUNCTION public.shop_order_gift_follows_status();
