-- S053 (Shops audit 11-12, Suggestion; Builder 1 r4): the card fee recorded at capture (shop_orders.card_fee_cents)
-- was Stripe's fee on the WHOLE charge, which includes the buyer's one-time $2 setup fee when the order carries it. That
-- recorded fee is what a buyer's own cancel keeps (keep_card_fee) and what a cancelling shop owes, so either paid about
-- 6 cents of Stripe's fee on Helpr's setup fee. Now only the sale's share is recorded: fee x paid / (paid + setup
-- fee), rounded to the cent, where paid is the sale part of the captured charge (a deposit order's deposit; money
-- review note). The fallback estimate is on that charge too (it overstated a deposit order's fee before). Orders without the setup fee (most) record exactly what they did before.
-- RESTATED FROM THE NEWEST CREATE, checked by name: shop_order_captured from 20261108185110 (newest), verbatim plus
-- the card_fee_cents expression and v_paid.
-- REPLAY-SAFE: CREATE OR REPLACE. Grants unchanged (service_role only). MONEY: lh-money-escrow. AUTHZ: lh-authz-rls.
-- Proof: src/test/pglite/shopsCardFeeShare.pglite.mjs (3x; NEW_MIGRATION=skip red).

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
  v_paid integer;
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
  v_paid := CASE WHEN o.payment_plan = 'deposit_50' THEN o.total_cents - COALESCE(o.balance_cents, 0) ELSE o.total_cents END;
  UPDATE public.shop_orders
     SET captured_at = now(), capture_last_error = NULL,
         -- CHANGED (S053): Stripe's fee is on the whole charge (the sale part it carries + the buyer's one-time setup
         -- fee). Only the sale part's share is recorded, so a refund that keeps the card fee, or a shop that cancels,
         -- never pays Stripe's fee on Helpr's own setup fee: fee x paid / (paid + setup fee), rounded, at most paid.
         -- paid is the sale part of THIS charge: the whole total, or a deposit order's deposit (total - balance; the
         -- balance is its own charge with its own fee, balance_card_fee_cents). No setup fee: the fee as read.
         card_fee_cents = least(v_paid, round(
           COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(v_paid + v_fee))::numeric
           * v_paid / NULLIF(v_paid + v_fee, 0))::integer)
   WHERE id = o.id;
  -- L8: the app counts its own home-food sales (once per order: source_ref UNIQUE).
  SELECT COALESCE(sum(line_cents), 0)::integer INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, is_seed)
    VALUES (o.seller_id, o.id, v_home_food, o.is_seed)
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;
  -- CHANGED (digital): a download is ready the moment it is paid; the buyer is told so, and the shop is told of the
  -- sale (shop_digital_mark_paid already sent nothing: the charge is what makes it a sale).
  IF o.is_digital THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your download is ready',
      format('You paid $%s%s. Open Shops > My orders and tap Download. It stays there for as long as you have an account.',
             to_char((o.total_cents + v_fee) / 100.0, 'FM999999990.00'),
             CASE WHEN v_fee > 0
               THEN format(', including the one-time $%s account setup fee (charged once per account)', to_char(v_fee / 100.0, 'FM999990.00'))
               ELSE '' END),
      '/shops/orders', o.seller_id);
    -- The email (lead default) rides on this notifications row: trg_email_shop_download_ready (below) mails it after
    -- the row passes notifications_seed_boundary, so a seed or test subject never emails a real person.
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'You sold a download',
      'A buyer bought one of your downloads. You are paid 72 hours after the sale unless the buyer reports a problem with the file.',
      '/shops/dashboard', o.buyer_id);
    RETURN jsonb_build_object('result', 'captured', 'order_id', o.id, 'digital', true);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order accepted',
    format('The shop accepted your order for %s and your card was charged $%s%s.', to_char(o.ready_date, 'FMMonth FMDD'),
           to_char((o.total_cents + v_fee) / 100.0, 'FM999999990.00'),
           CASE WHEN v_fee > 0
             THEN format(', including the one-time $%s account setup fee (charged once per account)', to_char(v_fee / 100.0, 'FM999990.00'))
             ELSE '' END),
    '/shops/orders', o.seller_id);
  -- Helpr delivery (20261106194913): the charged order gets its Helpr task now.
  IF o.fulfillment = 'helpr_delivers' THEN
    PERFORM public.shop_delivery_open_task(o.id);
  END IF;
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_captured(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_captured(uuid, integer) TO service_role;
