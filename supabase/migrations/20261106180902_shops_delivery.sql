-- Shops delivery, slice 1: "Shop delivers" (owner 11-05 answer 3: pickup + porch + shop delivers + Helpr delivery,
-- all at launch; plan ~/.lh-shots/audit-1105-shops.md M5). Builder 5, 11-06. Shops stays behind its switch (testers).
-- Pickup and porch already exist (shops.handover_mode, 20261018211820). Helpr delivery is the next slice (it needs
-- Declutter's Helpr task flow); this slice only lets the order carry a delivery and its fee.
--
-- What this adds:
--   1. shops.delivers / delivery_fee_cents / delivery_radius_miles: the shop's own delivery offer, set by
--      shops_set_delivery. The fee is Declutter's seller-delivery rule (declutter_orders_delivery, 20261101175628):
--      free, or a whole-dollar $5 to $150. The radius is 1 to 50 road miles from the shop's pin.
--   2. shop_orders.fulfillment ('pickup' | 'shop_delivers'), delivery_cents, delivery_miles. total_cents now holds the
--      delivery too: shop_orders_total CHECK is total = items + premium + tax + delivery. Pickup orders carry 0.
--      Frozen once the order leaves awaiting_hold (trg_shop_orders_delivery_frozen).
--   3. shop_order_delivery_addresses: the buyer's drop-off address for ONE order. PERSONAL DATA: buyer_id ON DELETE
--      CASCADE (account deletion purges it); no member grant; never in a list. Written ONLY by
--      shop_set_order_delivery (service role), which shop-checkout calls after it geocodes the typed address on the
--      server (_shared/geocodeDropoff.ts), so a buyer never picks the point the distance is measured to.
--   4. shop_set_order_delivery: measures declutter_road_miles from the shop's public pin (already rounded to
--      2 decimals for a home maker, 20261017061155: no exact home point is used or leaked) to the drop-off, refuses
--      one past the radius (delivery_too_far), freezes the shop's fee on the order and adds it to total_cents.
--      Only while the order is the buyer's, awaiting_hold and has no Stripe page yet (row lock).
--   5. shops_order_delivery_address(order): the buyer reads their own; the shop reads it ONLY while the order is
--      accepted (owner: "the address shown only on accept"); never after the handover, never anyone else.
--   6. Money restated from their NEWEST CREATE (only the delivery lines change):
--        shop_mark_order_held   20261105181603_shops_setup_fee.sql (the page must add up to items + fee + delivery
--                                + tax [+ setup fee])
--        shop_complete_handover 20261105182903_shops_handover_rule.sql (the shop is paid its items AND its delivery
--                                fee; shop_payouts.items_cents carries both, so shop_payouts_amount is unchanged)
--        shop_owe_shop          20261019071055_shops_refunds_cancels_strikes.sql (equal to LIVE, read 11-06; a late
--                                cancel or a no-show pays the shop its items AND its delivery fee, as the copy says
--                                "you are paid for it"; money review BLOCK on 33156ebb22)
--        shops_report_no_show   20261103162420 (copy only: a delivery order says "didn't receive the delivery")
--      Refunds already read total_cents (20261019071055), so a full refund gives the delivery back too.
--      NOTE (Q1948): shops' facilitated_la_sales_cents counts items only; the delivery fee is not in it.
-- Tax: the delivery line goes to Stripe as non-taxable, exactly as Declutter's "Seller delivery" line
--   (declutter-checkout NONTAXABLE_TAX_CODE); it is not in the tax calculation.
-- MONEY: yes (lh-money-escrow). AUTHZ: one table, two setters, one read (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP CONSTRAINT IF EXISTS then ADD, DROP TRIGGER
--   IF EXISTS, CREATE OR REPLACE. ACK-REASON: shop_orders_total is dropped only to be re-added in the same block with
--   delivery_cents (default 0), which every existing row satisfies.
-- Proof: src/test/pglite/shopsDelivery.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1. The shop's offer.
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS delivers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_radius_miles smallint NOT NULL DEFAULT 10;
DO $do$
BEGIN
  ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_delivery_offer;
  ALTER TABLE public.shops ADD CONSTRAINT shops_delivery_offer
    CHECK (delivery_fee_cents % 100 = 0 AND (delivery_fee_cents = 0 OR delivery_fee_cents BETWEEN 500 AND 15000)
           AND delivery_radius_miles BETWEEN 1 AND 50);
END
$do$;
-- Public to members like the other order terms (a buyer reads the fee and the radius before ordering).
GRANT SELECT (delivers, delivery_fee_cents, delivery_radius_miles) ON TABLE public.shops TO authenticated;

-- 2. The order's choice.
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS delivery_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_miles smallint;
DO $do$
BEGIN
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_fulfillment;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_fulfillment
    CHECK ((fulfillment = 'pickup' AND delivery_cents = 0 AND delivery_miles IS NULL)
        OR (fulfillment = 'shop_delivers' AND delivery_miles BETWEEN 1 AND 50 AND delivery_cents % 100 = 0
            AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000)));
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_total;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_total
    CHECK (total_cents = items_cents + premium_cents + tax_cents + delivery_cents);
END
$do$;
GRANT SELECT (fulfillment, delivery_cents) ON TABLE public.shop_orders TO authenticated;

-- Frozen once the buyer is on the Stripe page or past it: a later write can never move what the card was held for.
CREATE OR REPLACE FUNCTION public.shop_orders_delivery_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  IF (NEW.fulfillment IS DISTINCT FROM OLD.fulfillment OR NEW.delivery_cents IS DISTINCT FROM OLD.delivery_cents
      OR NEW.delivery_miles IS DISTINCT FROM OLD.delivery_miles)
     AND (OLD.status <> 'awaiting_hold' OR OLD.stripe_checkout_session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'delivery_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_delivery_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_delivery_frozen ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_delivery_frozen BEFORE UPDATE OF fulfillment, delivery_cents, delivery_miles ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_delivery_frozen();

-- 3. The drop-off address, one per order.
CREATE TABLE IF NOT EXISTS public.shop_order_delivery_addresses (
  order_id uuid PRIMARY KEY REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  line1 text NOT NULL CHECK (char_length(btrim(line1)) BETWEEN 3 AND 120),
  line2 text CHECK (line2 IS NULL OR char_length(btrim(line2)) BETWEEN 1 AND 120),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 60),
  -- Louisiana's assigned ZIP prefixes only (700-701, 703-708, 710-714), the rule Builder 4's H8 fix uses.
  postal_code text NOT NULL CHECK (postal_code ~ '^(70[013-8]|71[0-4])[0-9]{2}$'),
  lat numeric NOT NULL CHECK (lat BETWEEN 28 AND 34),
  lng numeric NOT NULL CHECK (lng BETWEEN -95 AND -88),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_delivery_addresses_buyer_idx ON public.shop_order_delivery_addresses (buyer_id);
ALTER TABLE public.shop_order_delivery_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_order_delivery_addresses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_order_delivery_addresses TO service_role;

-- 4. The shop sets its offer.
CREATE OR REPLACE FUNCTION public.shops_set_delivery(p_delivers boolean, p_fee_cents integer, p_radius_miles integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  v_uid := public.shops_assert_owner_eligible();
  IF p_delivers IS NULL THEN
    RAISE EXCEPTION 'invalid_delivery' USING ERRCODE = '22023';
  END IF;
  IF p_fee_cents IS NULL OR p_fee_cents % 100 <> 0 OR NOT (p_fee_cents = 0 OR p_fee_cents BETWEEN 500 AND 15000) THEN
    RAISE EXCEPTION 'invalid_delivery_fee' USING ERRCODE = '22023',
      HINT = 'Make delivery free, or a whole-dollar fee from $5 to $150.';
  END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_delivery_radius' USING ERRCODE = '22023', HINT = 'Deliver within 1 to 50 miles.';
  END IF;
  UPDATE public.shops
     SET delivers = p_delivers, delivery_fee_cents = p_fee_cents, delivery_radius_miles = p_radius_miles, updated_at = now()
   WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object('delivers', p_delivers, 'delivery_fee_cents', p_fee_cents, 'delivery_radius_miles', p_radius_miles);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_delivery(boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_delivery(boolean, integer, integer) TO authenticated, service_role;

-- 5. shop-checkout (service role) turns a just-asked order into a delivery, after geocoding the buyer's address.
CREATE OR REPLACE FUNCTION public.shop_set_order_delivery(p_order_id uuid, p_buyer uuid, p_line1 text, p_line2 text,
  p_city text, p_postal_code text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  s public.shops;
  v_miles integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_buyer IS NULL OR o.buyer_id IS DISTINCT FROM p_buyer THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'awaiting_hold' OR o.stripe_checkout_session_id IS NOT NULL OR o.fulfillment <> 'pickup' THEN
    RAISE EXCEPTION 'delivery_frozen' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = o.shop_id;
  IF NOT FOUND OR NOT s.delivers THEN
    RAISE EXCEPTION 'shop_does_not_deliver' USING ERRCODE = '55000', HINT = 'This shop does not deliver. Choose pickup.';
  END IF;
  IF p_postal_code IS NULL OR p_postal_code !~ '^(70[013-8]|71[0-4])[0-9]{2}$' THEN
    RAISE EXCEPTION 'delivery_outside_louisiana' USING ERRCODE = '22023', HINT = 'Shops deliver in Louisiana only.';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'delivery_outside_louisiana' USING ERRCODE = '22023', HINT = 'Shops deliver in Louisiana only.';
  END IF;
  -- From the shop's public pin (2 decimals for a home maker): never its exact pickup address.
  v_miles := public.declutter_road_miles(s.pin_lat, s.pin_lng, p_lat, p_lng);
  IF v_miles IS NULL OR v_miles > s.delivery_radius_miles THEN
    RAISE EXCEPTION 'delivery_too_far' USING ERRCODE = '22023',
      HINT = format('This shop delivers within %s miles. Choose pickup.', s.delivery_radius_miles);
  END IF;
  INSERT INTO public.shop_order_delivery_addresses (order_id, buyer_id, line1, line2, city, postal_code, lat, lng, is_seed)
  VALUES (o.id, o.buyer_id, btrim(p_line1), NULLIF(btrim(COALESCE(p_line2, '')), ''), btrim(p_city), p_postal_code,
          p_lat, p_lng, o.is_seed);
  UPDATE public.shop_orders
     SET fulfillment = 'shop_delivers', delivery_cents = s.delivery_fee_cents, delivery_miles = v_miles,
         total_cents = total_cents + s.delivery_fee_cents
   WHERE id = o.id;
  RETURN jsonb_build_object('order_id', o.id, 'delivery_cents', s.delivery_fee_cents, 'delivery_miles', v_miles,
                            'total_cents', o.total_cents + s.delivery_fee_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_set_order_delivery(uuid, uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_set_order_delivery(uuid, uuid, text, text, text, text, numeric, numeric) TO service_role;

-- 6. ONE order's drop-off address: the buyer's own, or the shop's while it has accepted the order.
CREATE OR REPLACE FUNCTION public.shops_order_delivery_address(p_order_id uuid)
RETURNS TABLE (line1 text, line2 text, city text, postal_code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR NOT (o.buyer_id = v_uid OR (o.seller_id = v_uid AND o.status = 'accepted')) THEN
    RETURN;
  END IF;
  IF o.seller_id = v_uid AND public.is_caller_banned() THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT a.line1, a.line2, a.city, a.postal_code
    FROM public.shop_order_delivery_addresses a WHERE a.order_id = o.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_delivery_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_delivery_address(uuid) TO authenticated, service_role;

-- 7. RESTATED from 20261105181603_shops_setup_fee.sql (only the delivery lines change).
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
  -- Delivery (20261106180902): the page also carries the order's frozen delivery fee (0 for a pickup).
  -- H4-fee: the page carries the frozen setup fee on top of total (items + fee + tax), or, for a page opened
  -- before shop-checkout learned the fee, total alone (then nothing is claimed: not_charged).
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total IS NOT DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents + o.setup_fee_cents;
  IF p_tax_cents IS NULL OR p_tax_cents < 0
     OR (NOT v_fee_charged AND p_amount_total IS DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents) THEN
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

-- 8. RESTATED from 20261105182903_shops_handover_rule.sql (only the delivery lines change).
CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- Delivery (20261106180902): the shop is paid its items AND its own delivery fee; shop_payouts.items_cents
  -- carries both (the sale the shop is owed), so shop_payouts_amount (amount = items - debt) is unchanged.
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, (o.items_cents + o.delivery_cents));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + o.delivery_cents), v_debt, (o.items_cents + o.delivery_cents) - v_debt,
          CASE WHEN (o.items_cents + o.delivery_cents) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN (o.items_cents + o.delivery_cents) - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char(((o.items_cents + o.delivery_cents) - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char(((o.items_cents + o.delivery_cents) - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char(((o.items_cents + o.delivery_cents) - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      WHEN 'buyer' THEN 'The pickup is done and the order is final. Thank you for buying local.'
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.'
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;

-- 9. RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (equal to LIVE, read 11-06). A late cancel or a
-- no-show pays the shop what a handover would: its items AND its own delivery fee (lead decision 11-06 on the money
-- BLOCK of 33156ebb22: the shop is told "you are paid for it", so the fee is never silently kept).
CREATE OR REPLACE FUNCTION public.shop_owe_shop(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text,
                                              (o.items_cents + o.delivery_cents));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + o.delivery_cents), v_debt,
          (o.items_cents + o.delivery_cents) - v_debt,
          CASE WHEN (o.items_cents + o.delivery_cents) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END, now())
  ON CONFLICT (order_id) DO NOTHING;
  RETURN (o.items_cents + o.delivery_cents) - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owe_shop(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owe_shop(uuid) TO service_role;

-- 10. RESTATED from 20261103162420_q2390_handover_paid_refund_shop_cancel_photo_no_show_decline_not_found_is_404.sql
-- (only the buyer's notice changes: a delivery order says it was not received).
CREATE OR REPLACE FUNCTION public.shops_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_owed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  IF o.handover_mode <> 'in_person' THEN
    RAISE EXCEPTION 'not_in_person' USING ERRCODE = '55000',
      HINT = 'A left-out order cannot be a no-show; it finishes on its own after the ready date.';
  END IF;
  -- Only an order the shop marked ready (/code-review of shops-m3-v1 #2): a shop
  -- that never said "it's ready" cannot say the buyer failed to come for it.
  IF NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_ready' USING ERRCODE = '55000',
      HINT = 'Mark the order ready first. A no-show can only be reported for an order you had ready.';
  END IF;
  IF now() < ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') THEN
    RAISE EXCEPTION 'too_early_for_no_show' USING ERRCODE = '55000',
      HINT = 'You can report a no-show once the ready date is over.';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.shop_give_strike(o.buyer_id, 'buyer', 'buyer_no_show', o.id);
  -- Delivery (20261106180902): a shop-delivered order was not received, not "not picked up".
  PERFORM public.declutter_notify(o.buyer_id, 'warning', CASE WHEN o.fulfillment = 'shop_delivers' THEN 'Missed delivery' ELSE 'Missed pickup' END,
    CASE WHEN o.fulfillment = 'shop_delivers' THEN
      format('The shop says you didn''t receive the delivery of your order for %s. A missed delivery counts as a late cancel: nothing is refunded and the shop is paid. If you did receive it, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    ELSE
      format('The shop says you did not pick up your order for %s. A missed pickup counts as a late cancel: nothing is refunded and the shop is paid. If you did pick it up, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'No-show recorded',
    format('You are paid for the order ($%s).', to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'no_show', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_no_show(uuid) TO authenticated, service_role;
