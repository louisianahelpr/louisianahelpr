-- Shops custom orders, slice 2b part 1: the rest of a 50% deposit order, the SQL side (Builder 4, 11-06; plan
-- ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 ~3:40 PM balance-failure rule; LEAD 11-06 ~5:20 PM tax rule).
-- Stacked on slice 2a (20261106212437). shops_order_custom_quote still refuses a deposit price (deposit_not_ready)
-- until the edge part (charge, pay-the-rest page, tax reversal) lands, so nothing here is reachable by a member yet.
--
-- The rest's life, all service-only (declutter-money / shop-checkout / stripe-webhook call these):
--   1. The card is saved at Checkout (setup_future_usage off_session on a deposit order's page); the webhook records
--      the customer and payment method on the order (shop_order_record_saved_card).
--   2. From the ready date, shop_balances_due lists accepted deposit orders whose deposit was captured and whose rest
--      is unpaid, with the saved card, and that are not waiting on the buyer. The edge charges the rest off-session
--      (one key per order and attempt: shop-balance-<order>-<attempt>), then records it:
--        paid   -> shop_balance_paid (balance_payment_intent_id + balance_captured_at; idempotent; one payment per order)
--        failed -> shop_balance_failed (counted; a card the bank declined or that needs the buyer is the buyer's to pay:
--                  balance_failed_at is set, the buyer is told to pay the rest, and the shop that it waits)
--   3. The buyer's pay-the-rest page (shop-checkout) is recorded with shop_attach_balance_session; its payment lands
--      through shop_balance_paid like the off-session one.
--   4. Still unpaid 7 days after the ready date (OWNER rule): shop_balance_lapse_sweep closes the order as the buyer's
--      late cancel (status 'cancelled', close_reason 'buyer_cancelled_late'): the shop is paid on the deposit only
--      (shop_owe_shop -> shop_order_shop_cents, 2a), the buyer gets a Shops strike, and both are told. It returns the
--      lapsed orders: the edge then reverses the order's Stripe Tax transaction IN FULL and refunds the deposit's tax
--      to the buyer (LEAD 11-06: no item changes hands, so no taxable sale, La. R.S. 47:301(12)). That refund is part 2.
-- Never charged twice: shop_balances_due never lists an order with a balance payment, a recorded payment is never
-- replaced, and a payment for an order that no longer owes the rest is answered 'refund' (the edge gives it back).
-- MONEY: yes (lh-money-escrow). AUTHZ: service-only functions (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraint added only when missing, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/shopsCustomBalance.pglite.mjs (applied 3x; BALANCE_MIGRATION=skip is red).

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS balance_customer_id text,
  ADD COLUMN IF NOT EXISTS balance_payment_method_id text,
  ADD COLUMN IF NOT EXISTS balance_lapsed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lapse_tax_done_at timestamptz;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_balance_card' AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_balance_card CHECK (
      (balance_customer_id IS NULL OR balance_customer_id ~ '^cus_')
      AND (balance_payment_method_id IS NULL OR balance_payment_method_id ~ '^pm_')
      AND (payment_plan = 'deposit_50' OR (balance_customer_id IS NULL AND balance_payment_method_id IS NULL)));
  END IF;
END;
$do$;
COMMENT ON COLUMN public.shop_orders.balance_lapsed_at IS
  'deposit_50: the order closed as cancelled with the rest unpaid (the 7-day lapse, the buyer''s late cancel or a no-show; no item changed hands). The tax step (full Stripe Tax reversal + the deposit''s tax refunded, LEAD 11-06) is owed until lapse_tax_done_at.';
COMMENT ON COLUMN public.shop_orders.balance_payment_method_id IS
  'deposit_50: the card saved at Checkout for the rest (recorded by stripe-webhook). Charged off-session from the ready date.';

-- 1. The saved card (stripe-webhook, when the deposit order's hold lands). Recorded once.
CREATE OR REPLACE FUNCTION public.shop_order_record_saved_card(p_order_id uuid, p_customer_id text, p_payment_method_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.payment_plan <> 'deposit_50' THEN
    RETURN jsonb_build_object('result', 'not_deposit', 'order_id', o.id);
  END IF;
  IF o.balance_payment_method_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', CASE WHEN o.balance_payment_method_id = p_payment_method_id THEN 'already_saved' ELSE 'kept_first' END,
                              'order_id', o.id);
  END IF;
  UPDATE public.shop_orders SET balance_customer_id = p_customer_id, balance_payment_method_id = p_payment_method_id WHERE id = o.id;
  RETURN jsonb_build_object('result', 'saved', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_record_saved_card(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_record_saved_card(uuid, text, text) TO service_role;

-- 2. What to charge now: from the ready date, deposit captured, rest unpaid, card saved, not waiting on the buyer.
CREATE OR REPLACE FUNCTION public.shop_balances_due(p_limit integer)
RETURNS TABLE (order_id uuid, buyer_id uuid, seller_id uuid, balance_cents integer, customer_id text,
               payment_method_id text, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.id, o.buyer_id, o.seller_id, o.balance_cents, o.balance_customer_id, o.balance_payment_method_id,
         o.balance_attempts, o.payment_livemode, o.stripe_checkout_session_id
    FROM public.shop_orders o
   WHERE o.payment_plan = 'deposit_50' AND o.status = 'accepted' AND o.captured_at IS NOT NULL
     AND o.balance_captured_at IS NULL AND o.balance_payment_intent_id IS NULL
     AND o.balance_failed_at IS NULL AND o.balance_payment_method_id IS NOT NULL
     AND o.balance_cents > 0
     AND o.ready_date <= public.shop_local_today()
   ORDER BY o.ready_date, o.id
   LIMIT greatest(1, least(COALESCE(p_limit, 50), 200));
$fn$;
REVOKE ALL ON FUNCTION public.shop_balances_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balances_due(integer) TO service_role;

-- 3. The rest was paid (off-session or the buyer's page). Idempotent; a payment for an order that no longer owes the
--    rest is answered 'refund' so the edge gives it back (it is never recorded over another or on a closed order).
CREATE OR REPLACE FUNCTION public.shop_balance_paid(p_order_id uuid, p_payment_intent_id text, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.balance_payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('result', 'already_paid', 'order_id', o.id);
  END IF;
  IF o.payment_plan <> 'deposit_50' OR o.balance_payment_intent_id IS NOT NULL OR o.status <> 'accepted' THEN
    RETURN jsonb_build_object('result', 'refund', 'order_id', o.id,
      'reason', CASE WHEN o.balance_payment_intent_id IS NOT NULL THEN 'paid_twice' ELSE 'order_not_open' END);
  END IF;
  UPDATE public.shop_orders
     SET balance_payment_intent_id = p_payment_intent_id, balance_captured_at = now(),
         balance_card_fee_cents = CASE WHEN p_card_fee_cents >= 0 THEN p_card_fee_cents END,
         balance_failed_at = NULL, balance_last_error = NULL
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order paid in full',
    format('The rest of your custom order ($%s) is paid. The shop can hand it over now.', to_char(o.balance_cents / 100.0, 'FM999990.00')),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Custom order paid in full',
    format('The rest of the custom order for %s is paid. You can hand it over.', to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'paid', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_balance_paid(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balance_paid(uuid, text, integer) TO service_role;

-- 4. The off-session charge did not go through. Counted (the next try gets a new key). p_buyer: the bank declined the
--    card or needs the buyer to confirm, so it is the buyer's to pay now (OWNER rule): told once, with the link.
CREATE OR REPLACE FUNCTION public.shop_balance_failed(p_order_id uuid, p_error text, p_buyer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.payment_plan <> 'deposit_50' OR o.balance_payment_intent_id IS NOT NULL OR o.status <> 'accepted' THEN
    RETURN jsonb_build_object('result', 'nothing_owed', 'order_id', o.id);
  END IF;
  UPDATE public.shop_orders
     SET balance_attempts = balance_attempts + 1, balance_last_error = left(COALESCE(p_error, ''), 300),
         balance_failed_at = CASE WHEN p_buyer THEN COALESCE(balance_failed_at, now()) ELSE balance_failed_at END
   WHERE id = o.id;
  IF p_buyer AND o.balance_failed_at IS NULL THEN
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Pay the rest of your order',
      format('We could not charge the rest of your custom order ($%s) to your card. Pay it from your order by %s, or the order is cancelled as a late cancel: the deposit is not refunded.',
             to_char(o.balance_cents / 100.0, 'FM999990.00'), to_char(o.ready_date + 7, 'FMMonth FMDD')),
      '/shops/orders', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Waiting on the rest of a payment',
      format('The buyer''s card did not take the rest of the custom order for %s. We asked them to pay it. Hand it over only once it is paid.',
             to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN jsonb_build_object('result', CASE WHEN p_buyer THEN 'buyer_pays' ELSE 'will_retry' END, 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_balance_failed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balance_failed(uuid, text, boolean) TO service_role;

-- 5. The buyer's pay-the-rest page (shop-checkout opens it as the buyer's own action, after reading the order).
CREATE OR REPLACE FUNCTION public.shop_attach_balance_session(p_order_id uuid, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_(live|test)_' THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.payment_plan <> 'deposit_50' OR o.balance_payment_intent_id IS NOT NULL OR o.status <> 'accepted' THEN
    RAISE EXCEPTION 'nothing_owed' USING ERRCODE = '55000', HINT = 'Nothing more is owed on this order.';
  END IF;
  UPDATE public.shop_orders SET balance_checkout_session_id = p_session_id WHERE id = o.id;
  RETURN jsonb_build_object('result', 'attached', 'order_id', o.id, 'replaced', o.balance_checkout_session_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_attach_balance_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_attach_balance_session(uuid, text) TO service_role;

-- 6. The lapse (declutter-money every 10 minutes): still unpaid 7 days after the ready date (from the start of the 8th
--    day, Louisiana time) -> the buyer's late cancel on the deposit only. It returns the orders it closed; the tax step
--    reads shop_lapse_tax_due (below), so a step that fails after this commits is never lost.
CREATE OR REPLACE FUNCTION public.shop_balance_lapse_sweep()
RETURNS TABLE (order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, owed_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  o public.shop_orders;
  v_owed integer;
BEGIN
  FOR r IN
    SELECT x.id FROM public.shop_orders x
     WHERE x.payment_plan = 'deposit_50' AND x.status = 'accepted' AND x.captured_at IS NOT NULL
       AND x.balance_payment_intent_id IS NULL
       AND now() >= ((x.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago')
     ORDER BY x.ready_date, x.id LIMIT 200
  LOOP
    BEGIN
      SELECT * INTO o FROM public.shop_orders WHERE id = r.id FOR UPDATE;
      -- Re-read under the lock: paid or closed in the meantime -> skipped.
      CONTINUE WHEN o.status <> 'accepted' OR o.balance_payment_intent_id IS NOT NULL;
      UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now(),
                                    balance_lapsed_at = now()
       WHERE id = o.id AND status = 'accepted';
      v_owed := public.shop_owe_shop(o.id);
      PERFORM public.shop_give_strike(o.buyer_id, 'buyer', 'buyer_cancelled_late', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Custom order cancelled',
        format('The rest of your custom order for %s was not paid within 7 days of the ready date, so the order is cancelled as a late cancel. The deposit is not refunded, except its sales tax.',
               to_char(o.ready_date, 'FMMonth FMDD')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Custom order cancelled',
        format('The buyer did not pay the rest of the custom order for %s, so it is cancelled. You are paid for the deposit ($%s). Do not hand it over.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(v_owed / 100.0, 'FM999999990.00')),
        '/shops/dashboard', o.buyer_id);
      order_id := o.id; buyer_id := o.buyer_id; seller_id := o.seller_id;
      payment_intent_id := o.stripe_payment_intent_id; owed_cents := v_owed;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; logged and retried next run.
      PERFORM public.log_cron_defect('shop_balance_lapse_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_balance_lapse_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balance_lapse_sweep() TO service_role;

-- 7. The tax step owed on a lapsed order (part 2's edge: full Stripe Tax reversal, then the deposit's tax refunded),
--    durable: listed until shop_lapse_tax_done records it.
CREATE OR REPLACE FUNCTION public.shop_lapse_tax_due(p_limit integer)
RETURNS TABLE (order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, deposit_tax_cents integer,
               livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.id, o.buyer_id, o.seller_id, o.stripe_payment_intent_id, o.tax_cents - o.tax_cents / 2,
         o.payment_livemode, o.stripe_checkout_session_id
    FROM public.shop_orders o
   WHERE o.balance_lapsed_at IS NOT NULL AND o.lapse_tax_done_at IS NULL
   ORDER BY o.balance_lapsed_at, o.id
   LIMIT greatest(1, least(COALESCE(p_limit, 50), 200));
$fn$;
REVOKE ALL ON FUNCTION public.shop_lapse_tax_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lapse_tax_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_lapse_tax_done(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.shop_orders SET lapse_tax_done_at = now()
   WHERE id = p_order_id AND balance_lapsed_at IS NOT NULL AND lapse_tax_done_at IS NULL;
  RETURN jsonb_build_object('result', CASE WHEN FOUND THEN 'done' ELSE 'not_owed' END, 'order_id', p_order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_lapse_tax_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lapse_tax_done(uuid) TO service_role;

-- 8. LEAD 11-06 ~5:20 PM: ANY close where the item never changes hands follows the lapse tax rule, not only the lapse:
--    the buyer's own late cancel and a no-show of a deposit order whose rest is unpaid close as 'cancelled' with the
--    shop paid on the deposit only (2a), and owe the same tax step. One trigger marks every such close, whoever writes it.
CREATE OR REPLACE FUNCTION public.shop_orders_mark_unpaid_close()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.status = 'accepted' AND NEW.status = 'cancelled' AND public.shop_order_balance_open(NEW) THEN
    NEW.balance_lapsed_at := COALESCE(NEW.balance_lapsed_at, now());
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_mark_unpaid_close() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_mark_unpaid_close ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_mark_unpaid_close BEFORE UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_mark_unpaid_close();
