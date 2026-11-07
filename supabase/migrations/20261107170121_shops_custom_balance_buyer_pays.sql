-- Shops custom orders, 50% deposit: the rest never silently runs out on the buyer (Builder 4, 11-07; lh-money-escrow
-- review of 2b, LEAD 11-07 decisions). Stacked on 20261107162454. Unreachable by members: deposit_not_ready stays ON.
--
-- What was wrong:
--   a. BLOCKER: only a card error made the rest the buyer's to pay (balance_failed_at + the notice + the Pay button).
--      An order with NO saved card (shop_order_record_saved_card skips none; shop_balances_due listed only orders
--      with a card) or a non-card error that kept repeating was never told anything, and lapsed at ready + 8 days:
--      the buyer lost the deposit and got a strike without ever being asked to pay.
--   b. shop_balance_paid recorded any PaymentIntent as the rest, whatever its amount.
--   c. LEAD 11-07: a shop-delivers deposit order that closes unpaid gives the deposit's half of the delivery price
--      back to the buyer (nothing was delivered; 2a's comment), with the deposit's sales tax.
--
-- The fix:
--   1. shop_balances_due (RESTATED from 20261106215722) also lists a due order with no saved card; the edge answers it
--      with shop_balance_failed(p_buyer => true) at once (no Stripe call).
--   2. shop_balance_failed (RESTATED from 20261106215722): the 3rd failed try of any kind is the buyer's to pay too
--      (SHOP_BALANCE_TRIES = 3); the notice no longer says "your card" (there may be none).
--   3. shop_balance_paid (RESTATED from 20261106215722, new p_amount_cents): a payment whose amount is not exactly the
--      rest owed is answered 'refund' (reason amount_differs), never recorded.
--   4. shop_lapse_tax_done (RESTATED from 20261106221300) gives back the deposit's tax AND, for a shop-delivers order,
--      the deposit's half of the delivery (delivery - floor(delivery / 2)); shop_balance_lapse_sweep (RESTATED from
--      20261106215722) says so in the buyer's notice.
-- MONEY: yes (lh-money-escrow). AUTHZ: service-only, unchanged grants.
-- REPLAY-SAFE: DROP FUNCTION IF EXISTS for the changed signature, CREATE OR REPLACE, grants restated.

-- 1. RESTATED from 20261106215722_shops_custom_deposit_balance.sql: no saved card is listed too.
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
     -- 11-07: an order with no saved card is listed too: the edge makes it the buyer's to pay at once.
     AND o.balance_failed_at IS NULL
     AND o.balance_cents > 0
     AND o.ready_date <= public.shop_local_today()
   ORDER BY o.ready_date, o.id
   LIMIT greatest(1, least(COALESCE(p_limit, 50), 200));
$fn$;
REVOKE ALL ON FUNCTION public.shop_balances_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balances_due(integer) TO service_role;

-- 2. RESTATED from 20261106215722_shops_custom_deposit_balance.sql: the 3rd failed try is the buyer's to pay.
CREATE OR REPLACE FUNCTION public.shop_balance_failed(p_order_id uuid, p_error text, p_buyer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_buyer boolean;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.payment_plan <> 'deposit_50' OR o.balance_payment_intent_id IS NOT NULL OR o.status <> 'accepted' THEN
    RETURN jsonb_build_object('result', 'nothing_owed', 'order_id', o.id);
  END IF;
  -- 11-07: the 3rd failed try of ANY kind is the buyer's to pay too, so a repeating error never runs out the clock.
  v_buyer := COALESCE(p_buyer, false) OR o.balance_attempts + 1 >= 3;
  UPDATE public.shop_orders
     SET balance_attempts = balance_attempts + 1, balance_last_error = left(COALESCE(p_error, ''), 300),
         balance_failed_at = CASE WHEN v_buyer THEN COALESCE(balance_failed_at, now()) ELSE balance_failed_at END
   WHERE id = o.id;
  IF v_buyer AND o.balance_failed_at IS NULL THEN
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Pay the rest of your order',
      format('We could not charge the rest of your custom order ($%s) automatically. Pay it from your order by %s, or the order is cancelled as a late cancel: the deposit is not refunded.',
             to_char(o.balance_cents / 100.0, 'FM999990.00'), to_char(o.ready_date + 7, 'FMMonth FMDD')),
      '/shops/orders', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Waiting on the rest of a payment',
      format('The rest of the custom order for %s did not go through automatically. We asked them to pay it. Hand it over only once it is paid.',
             to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN jsonb_build_object('result', CASE WHEN v_buyer THEN 'buyer_pays' ELSE 'will_retry' END, 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_balance_failed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balance_failed(uuid, text, boolean) TO service_role;

-- 3. RESTATED from 20261106215722_shops_custom_deposit_balance.sql with the amount paid (new signature).
DROP FUNCTION IF EXISTS public.shop_balance_paid(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.shop_balance_paid(p_order_id uuid, p_payment_intent_id text, p_card_fee_cents integer,
  p_amount_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
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
  -- 11-07: only exactly the rest owed is the rest; any other amount is given back, never recorded.
  IF p_amount_cents IS DISTINCT FROM o.balance_cents THEN
    RETURN jsonb_build_object('result', 'refund', 'order_id', o.id, 'reason', 'amount_differs');
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
REVOKE ALL ON FUNCTION public.shop_balance_paid(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_balance_paid(uuid, text, integer, integer) TO service_role;

-- 4. RESTATED from 20261106221300_shops_custom_balance_edge.sql: the deposit's delivery half goes back too.
CREATE OR REPLACE FUNCTION public.shop_lapse_tax_done(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_tax integer;
  v_delivery integer;
  v_back integer;
  v_refund uuid;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.balance_lapsed_at IS NULL OR o.lapse_tax_done_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_owed', 'order_id', p_order_id);
  END IF;
  -- The deposit's tax: what the deposit capture took of the tax (the rest held floor(tax / 2), 2a).
  v_tax := o.tax_cents - o.tax_cents / 2;
  -- LEAD 11-07: a shop-delivers order delivered nothing, so the deposit's half of the delivery goes back too (the rest
  -- held floor(delivery / 2), 2a). The shop is never paid delivery on an unpaid close (shop_order_shop_cents).
  v_delivery := CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents - o.delivery_cents / 2 ELSE 0 END;
  v_back := v_tax + v_delivery;
  IF v_back > 0 AND o.stripe_payment_intent_id IS NOT NULL THEN
    INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
                                     card_fee_cents, kept_cents, tax_kept_cents, refund_cents, note)
    VALUES (o.id, o.stripe_payment_intent_id, 'unpaid_close_tax', 'keep_card_fee', v_back, 0,
            0, 0, 0, v_back,
            CASE WHEN v_delivery > 0 THEN 'Sales tax and the delivery share of the deposit: the order closed with nothing handed over or delivered.'
                 ELSE 'Sales tax on the deposit: the order closed with no item handed over.' END)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_refund;
    IF v_refund IS NULL THEN
      -- The order already has its one refund row (an earlier refund): a person settles the tax by hand.
      PERFORM public.log_cron_defect('shop_lapse_tax_done', o.id::text, 'order already has a refund row; deposit tax and delivery share not queued');
    END IF;
  END IF;
  UPDATE public.shop_orders SET lapse_tax_done_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'done', 'order_id', o.id, 'refund_id', v_refund, 'tax_cents', v_tax, 'delivery_cents', v_delivery);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_lapse_tax_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lapse_tax_done(uuid) TO service_role;

-- 4b. RESTATED from 20261106215722_shops_custom_deposit_balance.sql: the buyer's notice names the delivery share.
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
        format('The rest of your custom order for %s was not paid within 7 days of the ready date, so the order is cancelled as a late cancel. The deposit is not refunded, except its sales tax%s.',
               to_char(o.ready_date, 'FMMonth FMDD'),
               CASE WHEN o.fulfillment = 'shop_delivers' AND o.delivery_cents > 0 THEN ' and its share of the delivery price' ELSE '' END),
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
