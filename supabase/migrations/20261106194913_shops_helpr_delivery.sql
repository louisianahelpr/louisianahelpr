-- Shops delivery, slice 2 (server): HELPR delivery for Shops, reusing Declutter's Helpr task flow (owner 11-05
-- answer 3: pickup + porch + shop delivers + Helpr delivery, all at launch). Builder 5, 11-06. Stacked on
-- 20261106180902_shops_delivery.sql (ready/b5-shops-delivery). Shops stays behind its switch (testers).
--
-- Server slice. Slice 2 (edge: the pickup point saved at address save, the checkout's Helpr choice) and slice 3 (UI)
-- follow; until then no member path sets 'helpr_delivers'.
--
-- What this adds:
--   1. helpr_tasks.source_kind may be 'shop_delivery' (source_id = shop_orders.id).
--   2. shops.helpr_delivery: the shop offers Helpr delivery (shops_set_helpr_delivery, owner only). It needs a saved
--      private pickup address with a looked-up point.
--   3. shop_pickup_addresses.lat / lng: the point of the shop's PRIVATE pickup address, looked up on the server when the
--      shop saves it (lead 11-06: geocode at save, not at checkout). No member grant. Written ONLY by
--      shop_set_pickup_point (service role); a BEFORE UPDATE trigger clears it whenever the address text changes, so a
--      stale point never prices or routes a delivery.
--   4. shop_orders.fulfillment may be 'helpr_delivers': delivery_cents is Declutter's Helpr price for a small item,
--      declutter_delivery_price_cents(miles, '{small}') = $6 + $1.50 a mile (owner 11-01, 20261101175628), miles =
--      road miles from the pickup point to the drop-off, 1 to 50. Set ONLY by shop_set_order_helpr_delivery (service
--      role, shop-checkout after it geocodes the drop-off).
--   5. At capture (shop_order_captured, RESTATED): a Helpr order gets its helpr_tasks row (pickup = the shop's private
--      address, drop-off = shop_order_delivery_addresses, pay = delivery_cents, fee = helpr_task_fee_cents).
--   6. The task dispatchers, RESTATED from their NEWEST CREATE with a 'shop_delivery' branch (unknown kinds keep
--      their deny answer):
--        helpr_task_source_require_feature 20261017055505  -> require_feature('shops')
--        helpr_task_lock                   20261103072510  -> the shop order row first (same order as Declutter)
--        helpr_task_source_event           20261031014011  -> shop_delivery_on_task_event
--        helpr_task_source_held            20261031134217  -> an open problem on the shop handover, or a seller
--                                                             no-show report waiting for the Helpr's answer
--        helpr_task_source_slot_ok         20261017055505  -> shop_delivery_slot_ok
--        helpr_task_payouts_due            20261105032500  -> the shop order's PaymentIntent and shop_order_<id> group
--        helpr_tasks_open_near / _count    20261031075157 / 20261031082821 -> a shop task shows only to a Helpr the
--                                                             shops switch is on for
--   7. shop_delivery_on_task_event: words for accepted / released / picked_up / delivered; 'confirmed' finishes the
--      shop order (shop_complete_handover); 'unfilled' refunds the delivery price (4b) and turns the order into a
--      pickup at the shop; 'pickup_no_show' opens a problem on the handover (the money waits for an admin).
--   8. Payout split, RESTATED shop_complete_handover and shop_owe_shop (from 20261106180902): the shop is paid its own
--      delivery fee only when IT delivers; a Helpr order pays the shop its items, and the Helpr is paid from
--      helpr_task_payouts (pay_cents = delivery_cents, minus the Helpr fee).
--   9. trg_shop_orders_close_helpr_task: an order that leaves 'accepted' other than by the handover cancels its open
--      or booked task (and gives the delivery back on a late cancel / no-show), or, once the Helpr picked it up,
--      pays the Helpr ('admin' confirm). Declutter's declutter_close_paid_order rule.
--  4b. shop_delivery_refunds (+ shop_delivery_refund, _refunds_due, _refund_executed, _refund_reversed, shop_delivery_reserved_cents,
--      shop_order_refunds_recorded_cents): the delivery price given back on its own. RESTATED to read it:
--      shop_refund_amounts (20261019071055), shops_order_cancel_quote (20261103091013), shop_payouts_due
--      (20261019071055, + refunds_recorded_cents), helpr_task_customer_confirm (20261104175521). declutter-money
--      sends the rows and pays shop_delivery tasks.
-- MONEY: yes (lh-money-escrow). AUTHZ: one column grant-less, two service setters, one owner setter (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS then ADD, DROP TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsHelprDelivery.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1. The task source.
DO $do$
BEGIN
  ALTER TABLE public.helpr_tasks DROP CONSTRAINT IF EXISTS helpr_tasks_source_kind_check;
  ALTER TABLE public.helpr_tasks ADD CONSTRAINT helpr_tasks_source_kind_check
    CHECK (source_kind IN ('declutter_delivery', 'shop_delivery'));
END
$do$;

-- 2. The shop's offer.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS helpr_delivery boolean NOT NULL DEFAULT false;
GRANT SELECT (helpr_delivery) ON TABLE public.shops TO authenticated;

-- 3. The pickup point (private).
ALTER TABLE public.shop_pickup_addresses
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric,
  ADD COLUMN IF NOT EXISTS point_at timestamptz;
DO $do$
BEGIN
  ALTER TABLE public.shop_pickup_addresses DROP CONSTRAINT IF EXISTS shop_pickup_addresses_point;
  ALTER TABLE public.shop_pickup_addresses ADD CONSTRAINT shop_pickup_addresses_point
    CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL) = (point_at IS NULL)
           AND (lat IS NULL OR (lat BETWEEN 28 AND 34 AND lng BETWEEN -95 AND -88)));
END
$do$;
REVOKE SELECT (lat, lng, point_at) ON TABLE public.shop_pickup_addresses FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shop_pickup_addresses_clear_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  IF (NEW.line1, NEW.line2, NEW.city, NEW.postal_code) IS DISTINCT FROM (OLD.line1, OLD.line2, OLD.city, OLD.postal_code)
     AND NOT (NEW.point_at IS DISTINCT FROM OLD.point_at) THEN
    NEW.lat := NULL;
    NEW.lng := NULL;
    NEW.point_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_pickup_addresses_clear_point() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_pickup_addresses_clear_point ON public.shop_pickup_addresses;
CREATE TRIGGER trg_shop_pickup_addresses_clear_point BEFORE UPDATE ON public.shop_pickup_addresses
  FOR EACH ROW EXECUTE FUNCTION public.shop_pickup_addresses_clear_point();

-- The edge function that saves the pickup address looks it up and stores the point. p_expect_* are the address the
-- point was looked up for: a point for an address the shop has since changed is refused (address_changed).
CREATE OR REPLACE FUNCTION public.shop_set_pickup_point(p_shop_id uuid, p_owner uuid, p_expect_line1 text,
  p_expect_postal_code text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  a public.shop_pickup_addresses;
BEGIN
  SELECT * INTO a FROM public.shop_pickup_addresses WHERE shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR a.owner_id IS DISTINCT FROM p_owner THEN
    RAISE EXCEPTION 'pickup_address_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF a.line1 IS DISTINCT FROM p_expect_line1 OR a.postal_code IS DISTINCT FROM p_expect_postal_code THEN
    RAISE EXCEPTION 'address_changed' USING ERRCODE = '55000';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'pickup_outside_louisiana' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_pickup_addresses SET lat = p_lat, lng = p_lng, point_at = now() WHERE shop_id = a.shop_id;
  RETURN jsonb_build_object('shop_id', a.shop_id, 'result', 'point_saved');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_set_pickup_point(uuid, uuid, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_set_pickup_point(uuid, uuid, text, text, numeric, numeric) TO service_role;

-- The shop turns Helpr delivery on or off. On needs a pickup address with a looked-up point.
CREATE OR REPLACE FUNCTION public.shops_set_helpr_delivery(p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_on AND NOT EXISTS (SELECT 1 FROM public.shop_pickup_addresses a WHERE a.shop_id = s.id AND a.lat IS NOT NULL) THEN
    RAISE EXCEPTION 'pickup_point_missing' USING ERRCODE = '55000',
      HINT = 'Save your pickup address first, so a Helpr knows where to pick up.';
  END IF;
  UPDATE public.shops SET helpr_delivery = p_on WHERE id = s.id;
  RETURN jsonb_build_object('shop_id', s.id, 'helpr_delivery', p_on);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_helpr_delivery(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_helpr_delivery(boolean) TO authenticated, service_role;

-- 4. The order's choice: a Helpr delivery carries Declutter's small-item Helpr price for its miles.
DO $do$
BEGIN
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_fulfillment;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_fulfillment
    CHECK ((fulfillment = 'pickup' AND delivery_cents = 0 AND delivery_miles IS NULL)
        OR (fulfillment = 'shop_delivers' AND delivery_miles BETWEEN 1 AND 50 AND delivery_cents % 100 = 0
            AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000))
        OR (fulfillment = 'helpr_delivers' AND delivery_miles BETWEEN 1 AND 50
            AND delivery_cents = public.declutter_delivery_price_cents(delivery_miles::integer, ARRAY['small'])));
END
$do$;
-- 'unfilled' (no Helpr took it): the order became a pickup at the shop; the delivery is refunded (see the handoff).
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS helpr_unfilled_at timestamptz;
GRANT SELECT (helpr_unfilled_at) ON TABLE public.shop_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_set_order_helpr_delivery(p_order_id uuid, p_buyer uuid, p_line1 text, p_line2 text,
  p_city text, p_postal_code text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  s public.shops;
  a public.shop_pickup_addresses;
  v_miles integer;
  v_cents integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_buyer IS NULL OR o.buyer_id IS DISTINCT FROM p_buyer THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'awaiting_hold' OR o.stripe_checkout_session_id IS NOT NULL OR o.fulfillment <> 'pickup' THEN
    RAISE EXCEPTION 'delivery_frozen' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = o.shop_id;
  SELECT * INTO a FROM public.shop_pickup_addresses WHERE shop_id = o.shop_id;
  IF s.id IS NULL OR NOT s.helpr_delivery OR a.lat IS NULL THEN
    RAISE EXCEPTION 'shop_no_helpr_delivery' USING ERRCODE = '55000',
      HINT = 'This shop does not offer Helpr delivery. Choose pickup.';
  END IF;
  IF p_postal_code IS NULL OR p_postal_code !~ '^(70[013-8]|71[0-4])[0-9]{2}$'
     OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'delivery_outside_louisiana' USING ERRCODE = '22023', HINT = 'Shops deliver in Louisiana only.';
  END IF;
  -- The Helpr's real trip: the shop's pickup point to the drop-off (the point is never shown to anyone).
  v_miles := greatest(1, public.declutter_road_miles(a.lat, a.lng, p_lat, p_lng));
  IF v_miles IS NULL OR v_miles > 50 THEN
    RAISE EXCEPTION 'delivery_too_far' USING ERRCODE = '22023',
      HINT = 'A Helpr delivers within 50 miles of the shop. Choose pickup.';
  END IF;
  v_cents := public.declutter_delivery_price_cents(v_miles, ARRAY['small']);
  INSERT INTO public.shop_order_delivery_addresses (order_id, buyer_id, line1, line2, city, postal_code, lat, lng, is_seed)
  VALUES (o.id, o.buyer_id, btrim(p_line1), NULLIF(btrim(COALESCE(p_line2, '')), ''), btrim(p_city), p_postal_code,
          p_lat, p_lng, o.is_seed);
  UPDATE public.shop_orders
     SET fulfillment = 'helpr_delivers', delivery_cents = v_cents, delivery_miles = v_miles,
         total_cents = total_cents + v_cents
   WHERE id = o.id;
  RETURN jsonb_build_object('order_id', o.id, 'delivery_cents', v_cents, 'delivery_miles', v_miles,
                            'total_cents', o.total_cents + v_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_set_order_helpr_delivery(uuid, uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_set_order_helpr_delivery(uuid, uuid, text, text, text, text, numeric, numeric) TO service_role;

-- 4b. The delivery money on its own (Declutter's rules: 20261017055505 row 40, declutter_close_paid_order,
--     declutter_delivery_reserved_cents):
--   * no Helpr took it ('unfilled'): the delivery price goes back in full (reason no_helpr), and the order becomes a
--     pickup at the shop;
--   * the order closes before a Helpr picked it up: the delivery price goes back. A refund of the order includes it
--     (shop_refund_amounts); a late cancel or a no-show, which refunds nothing else, writes it here
--     (reason delivery_not_done, trg_shop_orders_close_helpr_task);
--   * the order closes after the Helpr picked it up: the Helpr made the trip and is paid (helpr_task_confirm by
--     'admin', as declutter_close_paid_order); the delivery price is RESERVED, never refunded.
-- One row per order, sent by declutter-money (key shop-delivery-refund-<id>; metadata.kind shop_refund, so the
-- webhook treats it as the app's own refund), never through shop_refunds (one row per order AND per payment).
CREATE TABLE IF NOT EXISTS public.shop_delivery_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
  stripe_payment_intent_id text NOT NULL CHECK (stripe_payment_intent_id ~ '^pi_'),
  reason text NOT NULL CHECK (reason IN ('no_helpr', 'delivery_not_done')),
  refund_cents integer NOT NULL CHECK (refund_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  stripe_refund_id text UNIQUE CHECK (stripe_refund_id IS NULL OR stripe_refund_id ~ '^(re|pyr)_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT shop_delivery_refunds_succeeded CHECK (status <> 'succeeded' OR stripe_refund_id IS NOT NULL)
);
ALTER TABLE public.shop_delivery_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_delivery_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_delivery_refunds TO service_role;
DROP TRIGGER IF EXISTS trg_shop_delivery_refunds_seed ON public.shop_delivery_refunds;
CREATE TRIGGER trg_shop_delivery_refunds_seed BEFORE INSERT ON public.shop_delivery_refunds
  FOR EACH ROW EXECUTE FUNCTION public.shop_money_rows_seed();

-- The part of the delivery price that is NOT the buyer's to get back with the order: all of it once it went back on
-- its own, or once a Helpr picked the order up (the Helpr is paid for the trip). As declutter_delivery_reserved_cents.
CREATE OR REPLACE FUNCTION public.shop_delivery_reserved_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.fulfillment IS DISTINCT FROM 'helpr_delivers' OR o.delivery_cents <= 0 THEN 0
    WHEN EXISTS (SELECT 1 FROM public.shop_delivery_refunds d WHERE d.order_id = o.id) THEN o.delivery_cents
    WHEN EXISTS (SELECT 1 FROM public.helpr_tasks t
                  WHERE t.source_kind = 'shop_delivery' AND t.source_id = o.id
                    AND t.status IN ('picked_up', 'delivered', 'confirmed')) THEN o.delivery_cents
    ELSE 0 END
    FROM public.shop_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_reserved_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_reserved_cents(uuid) TO service_role;

-- Writes the delivery price's refund (idempotent: one per order). Refuses an order with nothing to give back: not a
-- charged Helpr delivery, or the Helpr already picked it up (the trip is paid).
CREATE OR REPLACE FUNCTION public.shop_delivery_refund(p_order_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.fulfillment <> 'helpr_delivers' OR o.delivery_cents <= 0
     OR o.captured_at IS NULL OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'no_delivery_fee' USING ERRCODE = '55000';
  END IF;
  SELECT id INTO v_id FROM public.shop_delivery_refunds WHERE order_id = o.id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF public.shop_delivery_reserved_cents(o.id) > 0 THEN
    RAISE EXCEPTION 'delivery_made' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.shop_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, o.delivery_cents)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.shop_delivery_refunds WHERE order_id = o.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_refund(uuid, text) TO service_role;

-- Every refund the app itself made on the order's charge (Stripe confirmed it), so a payout from that charge still
-- finds it whole (declutter-money wholeCharge) and only an unrecorded refund (by hand, a dispute) stops it: a delivery
-- refund (shop_delivery_refunds), and the order's own refund (shop_refunds). A refund AFTER the Helpr picked the order
-- up leaves the Helpr's trip in the charge (shop_refund_amounts reserves it), and the Helpr is still paid from it.
CREATE OR REPLACE FUNCTION public.shop_order_refunds_recorded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (COALESCE((SELECT sum(d.refund_cents) FROM public.shop_delivery_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND d.status = 'succeeded'), 0)
        + COALESCE((SELECT sum(r.refund_cents) FROM public.shop_refunds r
                     WHERE r.order_id = o.id AND r.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND r.status = 'succeeded'), 0))::integer
    FROM public.shop_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_refunds_recorded_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_refunds_recorded_cents(uuid) TO service_role;

-- The rows declutter-money sends (the same shape as shop_refunds_due, so _shared/shopRefunds.ts sends both).
CREATE OR REPLACE FUNCTION public.shop_delivery_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, refund_cents integer,
               livemode boolean, checkout_session_id text, attempts integer, reversals integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.id, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, o.payment_livemode,
         o.stripe_checkout_session_id, r.attempts, 0
    FROM public.shop_delivery_refunds r
    JOIN public.shop_orders o ON o.id = r.order_id
   WHERE r.status IN ('pending', 'failed') AND r.next_attempt_at <= now() AND r.attempts < 12
     -- A charge refunded by hand in Stripe is decided by a person first (section 13 of 20261019071055).
     AND NOT public.shop_order_unaccounted_hand_refund(r.order_id)
   ORDER BY r.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_refunds_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_delivery_refund_executed(p_refund_id uuid, p_stripe_refund_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL OR (p_succeeded AND (p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_')) THEN
    RAISE EXCEPTION 'invalid_refund' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_delivery_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_id = CASE WHEN p_succeeded THEN p_stripe_refund_id ELSE stripe_refund_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_refund_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.shop_delivery_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_refund_executed(uuid, text, boolean, text) TO service_role;

-- Stripe failed or cancelled a delivery refund the row had recorded (stripe-webhook charge.refund.updated): the row
-- reopens, due now, with one more try counted, so declutter-money sends a NEW refund under a new key (-r<tries>) and
-- the recorded sum no longer counts it. As declutter_delivery_refund_reversed (20261017055505).
CREATE OR REPLACE FUNCTION public.shop_delivery_refund_reversed(p_id uuid, p_stripe_refund_id text, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE public.shop_delivery_refunds
     SET status = 'failed', stripe_refund_id = NULL, attempts = least(attempts + 1, 100), next_attempt_at = now(),
         last_error = left('Stripe moved refund ' || COALESCE(p_stripe_refund_id, '?') || ' to ' || COALESCE(p_why, 'failed'), 500)
   WHERE id = p_id AND stripe_refund_id = p_stripe_refund_id AND status = 'succeeded'
  RETURNING attempts INTO v_attempts;
  IF NOT FOUND THEN
    RETURN 'unchanged';
  END IF;
  RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_refund_reversed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_refund_reversed(uuid, text, text) TO service_role;

-- 5. The task for one captured Helpr order (called by shop_order_captured; idempotent through helpr_task_create's
-- UNIQUE (source_kind, source_id)). Window: open 48 hours (Declutter's row 40), pickup from the ready date's start to
-- 3 days after it (Louisiana time).
CREATE OR REPLACE FUNCTION public.shop_delivery_open_task(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  s public.shops;
  a public.shop_pickup_addresses;
  d public.shop_order_delivery_addresses;
  v_latest timestamptz;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.fulfillment <> 'helpr_delivers' OR o.captured_at IS NULL OR o.status <> 'accepted' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = o.shop_id;
  SELECT * INTO a FROM public.shop_pickup_addresses WHERE shop_id = o.shop_id;
  SELECT * INTO d FROM public.shop_order_delivery_addresses WHERE order_id = o.id;
  IF a.lat IS NULL OR d.order_id IS NULL THEN
    RAISE EXCEPTION 'helpr_delivery_addresses_missing' USING ERRCODE = '55000';
  END IF;
  v_latest := ((o.ready_date + 3)::timestamp + interval '20 hours') AT TIME ZONE 'America/Chicago';
  RETURN public.helpr_task_create('shop_delivery', o.id, 'small', left('Order from ' || COALESCE(s.name, 'a shop'), 300),
    COALESCE(a.city, 'Louisiana'),
    concat_ws(', ', a.line1, a.line2, a.city, 'LA ' || a.postal_code), a.lat, a.lng,
    COALESCE(d.city, 'Louisiana'),
    concat_ws(', ', d.line1, d.line2, d.city, 'LA ' || d.postal_code), d.lat, d.lng,
    o.delivery_miles::integer, o.delivery_cents, o.buyer_id, o.seller_id,
    least(now() + interval '48 hours', v_latest), v_latest, o.is_seed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_open_task(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_open_task(uuid) TO service_role;

-- A pickup slot: the order is accepted and charged, the slot is in the future, from the ready date's 8 AM, and the
-- 30-minute slot ends by the task's latest pickup.
CREATE OR REPLACE FUNCTION public.shop_delivery_slot_ok(p_order_id uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.shop_orders o
                   JOIN public.helpr_tasks t ON t.source_kind = 'shop_delivery' AND t.source_id = o.id
                  WHERE o.id = p_order_id AND o.status = 'accepted' AND o.captured_at IS NOT NULL
                    AND o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL
                    AND p_start > now()
                    AND p_start >= (o.ready_date::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago'
                    AND p_start + interval '30 minutes' <= t.latest_pickup_at);
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_slot_ok(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_slot_ok(uuid, timestamptz) TO service_role;

-- 7. What a task event does to the shop order.
CREATE OR REPLACE FUNCTION public.shop_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  t public.helpr_tasks;
  v_when text;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  v_when := to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM');
  IF p_event = 'accepted' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'A Helpr took your delivery',
      format('A Helpr picks up your order from the shop %s. They leave it at your door with a photo.', v_when),
      '/shops/orders', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up the order %s. Have it ready.', v_when), '/shops/dashboard', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      'Your Helpr can''t make it. Your delivery is back up for another Helpr.', '/shops/orders', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      'The Helpr can''t make it. You''ll be told the new pickup time.', '/shops/dashboard', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your order is on its way',
      'The Helpr picked up your order. They leave it at your door with a photo; tap "I got it" when you have it.',
      '/shops/orders', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      'The Helpr picked up the order. You''re paid when the buyer has it.', '/shops/dashboard', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      'The Helpr left your order at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
      '/shops/orders', t.helpr_id);
  ELSIF p_event = 'confirmed' THEN
    -- The drop-off IS the handover: the shop is paid its items (and the Helpr, by helpr_task_confirm).
    RETURN public.shop_complete_handover(o.id,
      CASE p_by WHEN 'customer' THEN 'buyer' WHEN 'code' THEN 'buyer' WHEN 'admin' THEN 'admin' ELSE 'auto' END);
  ELSIF p_event = 'unfilled' THEN
    -- No Helpr in time (Declutter's row 40): the delivery price goes back in full, and the order becomes a pickup at
    -- the shop (shop_delivery_refunds, reason no_helpr; a later refund of the order leaves it out: reserved).
    IF o.status = 'accepted' AND o.helpr_unfilled_at IS NULL THEN
      PERFORM public.shop_delivery_refund(o.id, 'no_helpr');
      UPDATE public.shop_orders SET helpr_unfilled_at = now() WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('No Helpr took the delivery of your order. The $%s you paid for delivery is coming back to your card. Pick it up at the shop instead.',
               to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        'No Helpr took the delivery of this order. The buyer picks it up at the shop instead.', '/shops/dashboard', o.buyer_id);
    END IF;
    RETURN jsonb_build_object('result', 'unfilled');
  ELSIF p_event = 'pickup_no_show' THEN
    -- The Helpr says the shop was not there: a problem on the handover holds the money for an admin.
    INSERT INTO public.shop_handovers (order_id, problem_at, problem_note, is_seed)
    VALUES (o.id, now(), left(format('The Helpr says the shop wasn''t there for the pickup at %s (%s m from the pickup address).',
                                     v_when, COALESCE(NULLIF(split_part(p_by, '|', 1), ''), '?')), 500), o.is_seed)
    ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, EXCLUDED.problem_at),
                                         problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'The Helpr couldn''t pick up',
      'The Helpr says you weren''t there to hand over the order. Louisiana Helpr will look at it and decide; the money waits until then.',
      '/shops/dashboard', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      'The Helpr couldn''t pick up your order from the shop. Louisiana Helpr will look at it and decide; you''ll be told.',
      '/shops/orders', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported');
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delivery_on_task_event(uuid, uuid, text, text) TO service_role;

-- 9. An order that leaves 'accepted' other than by its handover (a cancel, a refund, a no-show): the Declutter rule
-- (declutter_close_paid_order). Before the Helpr picked it up, the task is cancelled (no Helpr drives to a closed
-- order) and the delivery price goes back: with the order's refund (shop_refund_amounts leaves nothing reserved), or,
-- on a late cancel or a no-show that refunds nothing else, on its own here. After the pickup, the Helpr made the trip:
-- they are paid ('admin' confirm), and the delivery price is reserved.
CREATE OR REPLACE FUNCTION public.shop_orders_close_helpr_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_refund uuid;
BEGIN
  IF NEW.fulfillment = 'helpr_delivers' AND OLD.status = 'accepted' AND NEW.status NOT IN ('accepted', 'handed_over') THEN
    SELECT * INTO t FROM public.helpr_tasks
     WHERE source_kind = 'shop_delivery' AND source_id = NEW.id FOR UPDATE;
    IF t.id IS NOT NULL AND t.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(t.id, 'admin', NULL);
    ELSIF t.id IS NOT NULL AND t.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(t.id, 'cancelled', 'The shop order was closed: ' || COALESCE(NEW.close_reason, NEW.status));
    END IF;
    -- The shop is paid and the buyer refunded nothing (shop_owe_shop): the delivery nobody made goes back alone.
    IF NEW.status = 'cancelled' AND NEW.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')
       AND NEW.captured_at IS NOT NULL AND public.shop_delivery_reserved_cents(NEW.id) = 0 THEN
      v_refund := public.shop_delivery_refund(NEW.id, 'delivery_not_done');
      PERFORM public.declutter_notify(NEW.buyer_id, 'payment', 'Delivery money coming back',
        format('No Helpr had picked up your order, so the $%s you paid for delivery is coming back to your card.',
               to_char(NEW.delivery_cents / 100.0, 'FM999990.00')),
        '/shops/orders', NEW.seller_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_close_helpr_task() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_close_helpr_task ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_close_helpr_task AFTER UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_close_helpr_task();


-- RESTATED from 20261017055505_declutter_helpr_delivery.sql (a shop task needs the shops switch).
CREATE OR REPLACE FUNCTION public.helpr_task_source_require_feature(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind = 'declutter_delivery' THEN
    PERFORM public.require_feature('declutter');
  ELSIF p_kind = 'shop_delivery' THEN
    PERFORM public.require_feature('shops');
  ELSE
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END;
$fn$;


-- RESTATED from 20261103072510_declutter_checkout_reach_not_found_is_404.sql (a shop task locks its shop order first).
CREATE OR REPLACE FUNCTION public.helpr_task_lock(p_task uuid)
RETURNS public.helpr_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Q1945: a member who is no party to a task that is not open takes no lock. is_server_context(), not
  -- v_uid IS NOT NULL: anon has a NULL uid too (20260915101102); only the service role skips the check.
  IF NOT public.is_server_context() AND t.status IS DISTINCT FROM 'open'
     AND v_uid IS DISTINCT FROM t.helpr_id AND v_uid IS DISTINCT FROM t.customer_id
     AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.source_kind = 'declutter_delivery' THEN
    PERFORM public.declutter_lock_order(t.source_id);
  ELSIF t.source_kind = 'shop_delivery' THEN
    -- The shop order first, then the task: the order every shop money step takes.
    PERFORM 1 FROM public.shop_orders WHERE id = t.source_id FOR UPDATE;
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task FOR UPDATE;
  RETURN t;
END;
$fn$;


-- RESTATED from 20261031014011_helpr_delivery_still_in_hand_nudge.sql (shop tasks go to shop_delivery_on_task_event).
CREATE OR REPLACE FUNCTION public.helpr_task_source_event(p_task uuid, p_event text, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.source_kind = 'declutter_delivery' THEN
    -- BUY-37: only words, so it stays out of the function that moves the money.
    IF p_event = 'still_in_hand' THEN
      RETURN public.declutter_delivery_still_in_hand(t.source_id, t.id);
    END IF;
    RETURN public.declutter_delivery_on_task_event(t.source_id, t.id, p_event, p_by);
  END IF;
  IF t.source_kind = 'shop_delivery' THEN
    IF p_event = 'still_in_hand' THEN
      RETURN jsonb_build_object('result', p_event);
    END IF;
    RETURN public.shop_delivery_on_task_event(t.source_id, t.id, p_event, p_by);
  END IF;
  RAISE EXCEPTION 'unknown_task_source' USING ERRCODE = '55000';
END;
$function$;


-- RESTATED from 20261031134217_helpr_delivery_seller_reports_no_show.sql (a shop task is held by an open handover problem or an unanswered seller no-show report).
CREATE OR REPLACE FUNCTION public.helpr_task_source_held(p_kind text, p_source uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Unknown or NULL = held: this is a deny predicate (lh-authz-rls #11).
  IF p_kind IS NULL OR p_source IS NULL THEN
    RETURN true;
  END IF;
  IF p_kind = 'declutter_delivery' THEN
    RETURN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = p_source AND p.status = 'open')
      -- CHANGED (soldstates-5): a seller's "The Helpr didn't come" waiting for the Helpr's answer holds it too.
      OR EXISTS (SELECT 1 FROM public.helpr_tasks x
                  WHERE x.source_kind = 'declutter_delivery' AND x.source_id = p_source
                    AND x.seller_no_show_reported_at IS NOT NULL AND x.seller_no_show_answered_at IS NULL
                    AND x.seller_no_show_settled_at IS NULL);
  END IF;
  IF p_kind = 'shop_delivery' THEN
    RETURN EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = p_source AND h.problem_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.helpr_tasks x
                  WHERE x.source_kind = 'shop_delivery' AND x.source_id = p_source
                    AND x.seller_no_show_reported_at IS NOT NULL AND x.seller_no_show_answered_at IS NULL
                    AND x.seller_no_show_settled_at IS NULL);
  END IF;
  RETURN true;
END;
$fn$;


-- RESTATED from 20261017055505_declutter_helpr_delivery.sql (shop slots read shop_delivery_slot_ok).
CREATE OR REPLACE FUNCTION public.helpr_task_source_slot_ok(p_kind text, p_source uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind IS NULL OR p_source IS NULL OR p_start IS NULL THEN RETURN false; END IF;
  IF p_kind = 'declutter_delivery' THEN
    RETURN public.declutter_delivery_slot_ok(p_source, p_start);
  END IF;
  IF p_kind = 'shop_delivery' THEN
    RETURN public.shop_delivery_slot_ok(p_source, p_start);
  END IF;
  RETURN false;
END;
$fn$;


-- RESTATED from 20261105032500_declutter_gift_payouts.sql (a shop task pays from the shop order's charge, group shop_order_<id>; refunds_recorded_cents is NULL for it and its recorded delivery refunds (shop_order_refunds_recorded_cents)).
DROP FUNCTION IF EXISTS public.helpr_task_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.helpr_task_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, task_id uuid, source_kind text, source_id uuid, helpr_id uuid, customer_id uuid,
               pickup_contact_id uuid, amount_cents integer, stripe_account_id text, payment_intent_id text,
               transfer_group text, refunds_recorded_cents integer, attempts integer, raised_cents integer, raise_parts jsonb,
               tip_parts jsonb, gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, t.id, t.source_kind, t.source_id, p.helpr_id, t.customer_id, t.pickup_contact_id, p.amount_cents,
         pr.stripe_account_id,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN o.stripe_payment_intent_id
              WHEN t.source_kind = 'shop_delivery' THEN so.stripe_payment_intent_id END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || o.id::text
              WHEN t.source_kind = 'shop_delivery' THEN 'shop_order_' || so.id::text END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_refunds_recorded_cents(o.id)
              WHEN t.source_kind = 'shop_delivery' THEN public.shop_order_refunds_recorded_cents(so.id) END,
         p.attempts,
         t.raised_cents,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('raise_id', r.id, 'payment_intent_id', r.stripe_payment_intent_id,
                                                       'cents', r.raise_cents) ORDER BY r.applied_at, r.id)
                     FROM public.declutter_delivery_raises r
                    WHERE r.task_id = t.id AND r.status = 'applied'), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('tip_id', x.id, 'payment_intent_id', x.stripe_payment_intent_id,
                                                       'cents', x.tip_cents) ORDER BY x.paid_at, x.id)
                     FROM public.helpr_task_tips x
                    WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb),
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_gift_net_cents(o.id) ELSE 0 END
    FROM public.helpr_task_payouts p
    JOIN public.helpr_tasks t ON t.id = p.task_id
    LEFT JOIN public.declutter_orders o ON t.source_kind = 'declutter_delivery' AND o.id = t.source_id
    LEFT JOIN public.shop_orders so ON t.source_kind = 'shop_delivery' AND so.id = t.source_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.helpr_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payouts_due(integer) TO service_role;


-- RESTATED from 20261031075157_helpr_open_deliveries_hide_backed_out.sql (a shop task shows only to a Helpr the shops switch is on for).
CREATE OR REPLACE FUNCTION public.helpr_tasks_open_near(p_lat numeric, p_lng numeric, p_limit integer)
RETURNS TABLE (task_id uuid, source_kind text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, miles_to_pickup integer, take_home_cents integer, open_until timestamptz,
               latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT t.id, t.source_kind, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles,
         CASE WHEN p_lat IS NULL THEN NULL
              ELSE greatest(1, ceil(public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) / 1609.344))::integer END,
         public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents), t.open_until, t.latest_pickup_at
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, t.size)
     AND (t.source_kind <> 'shop_delivery' OR public.feature_enabled_for_user('shops', v_uid))
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
     -- BUY-41 (new): never one this Helpr backed out of or missed (helpr_task_accept refuses it: task_taken) ...
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     -- ... and never one whose sale is held by an open problem (refused: problem_open).
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY CASE WHEN p_lat IS NULL THEN 0 ELSE public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) END, t.open_until
   LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100);
END;
$fn$;


-- RESTATED from 20261031082821_helpr_open_count_and_windows_hide_backed_out.sql (as helpr_tasks_open_near).
CREATE OR REPLACE FUNCTION public.helpr_tasks_open_count()
RETURNS TABLE(pickup_area text, open_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  RETURN QUERY
  SELECT t.pickup_area, count(*)::integer
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
     AND (t.source_kind <> 'shop_delivery' OR public.feature_enabled_for_user('shops', v_uid))
     -- BUY-41 (new): as helpr_tasks_open_near, never one this Helpr backed out of or missed ...
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     -- ... and never one whose sale is held by an open problem.
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   GROUP BY t.pickup_area
   ORDER BY count(*) DESC, t.pickup_area;
END;
$fn$;


-- RESTATED from 20261105181603_shops_setup_fee.sql (a captured Helpr order opens its task).
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
  -- Helpr delivery (20261106194913): the charged order gets its Helpr task now.
  IF o.fulfillment = 'helpr_delivers' THEN
    PERFORM public.shop_delivery_open_task(o.id);
  END IF;
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;


-- RESTATED from 20261106180902_shops_delivery.sql (a Helpr order pays the shop its items only; the Helpr's pay comes from helpr_task_payouts).
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
  -- Delivery (20261106180902, 20261106194913): the shop is paid its items, and its own delivery fee only when IT
  -- delivered (shop_delivers); a Helpr's pay comes from helpr_task_payouts. shop_payouts.items_cents carries what
  -- the shop is owed, so shop_payouts_amount (amount = items - debt) is unchanged.
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END), v_debt, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt,
          CASE WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
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


-- RESTATED from 20261106180902_shops_delivery.sql (a late cancel or no-show of a Helpr order owes the shop its items, never the Helpr's pay).
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
                                              (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END), v_debt,
          (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt,
          CASE WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END, now())
  ON CONFLICT (order_id) DO NOTHING;
  RETURN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt;
END;
$fn$;


-- RESTATED from 20261104175521_q2390_last_member_not_found_is_404.sql (a shop task's delivery price goes back through shop_delivery_refund, never declutter_delivery_refund).
CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  -- CHANGED (BUY-36): the item is on its way back, so there is nothing to confirm.
  IF t.stuck_stage IN ('returning', 'returned', 'awaiting_choice') THEN
    RAISE EXCEPTION 'item_going_back' USING ERRCODE = '55000', HINT = 'This item is going back to the seller.';
  END IF;
  -- BUY-39: on the road is not "I got it". From the drop-off, or after 24 h in the Helpr's hands.
  -- CHANGED (BUY-36): except when the buyer collected it from a Helpr at fault (below).
  IF t.status = 'picked_up' AND t.stuck_stage IS DISTINCT FROM 'collecting'
     AND (t.picked_up_at IS NULL OR t.picked_up_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'delivery_on_the_way' USING ERRCODE = '55000', HINT = 'The Helpr is bringing it. Tap I got it once it is dropped off.';
  END IF;
  -- CHANGED (BUY-36): the buyer collected it from a Helpr at fault: the sale goes ahead, the Helpr is unpaid, the delivery fee goes back.
  IF t.stuck_stage = 'collecting' THEN
    IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
      RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
        HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
    END IF;
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The buyer collected it from the Helpr', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', v_uid, 'helpr fault: buyer collected');
    IF t.source_kind = 'shop_delivery' THEN
      PERFORM public.shop_delivery_refund(t.source_id, 'delivery_not_done');
    ELSE
      PERFORM public.declutter_delivery_refund(t.source_id, 'delivery_not_done');
    END IF;
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('The buyer has "%s". You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$fn$;


-- RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (the Helpr delivery price already refunded or earned is left out).
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
    SELECT so.total_cents - public.shop_delivery_reserved_cents(so.id) AS total_cents, so.tax_cents,
           public.declutter_card_fee_left(
             least(so.total_cents, COALESCE(so.card_fee_cents, public.declutter_card_fee_estimate(so.total_cents))),
             so.total_cents, public.shop_delivery_reserved_cents(so.id)) AS fee,
           public.shop_refund_fee_policy(p_reason) AS policy
      FROM public.shop_orders so WHERE so.id = p_order_id
  ), k AS (
    SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept FROM o
  )
  SELECT k.policy, k.total_cents, k.tax_cents, k.fee, k.kept,
         public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents),
         k.total_cents - k.kept - public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents)
    FROM k;
$fn$;


-- RESTATED from 20261103091013_shops_promotions_team_message_not_found_is_404.sql (a late cancel of a Helpr order quotes the delivery coming back).
CREATE OR REPLACE FUNCTION public.shops_order_cancel_quote(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL
     OR EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RETURN jsonb_build_object('can_cancel', false);
  END IF;
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  -- The free cancel's figures are exactly what shop_write_refund will write.
  SELECT * INTO a FROM public.shop_refund_amounts(o.id, 'buyer_cancelled');
  RETURN jsonb_build_object('can_cancel', true, 'free', v_free,
    'free_until', CASE WHEN v_until IS NULL OR NOT isfinite(v_until) THEN NULL ELSE v_until END,
    'paid_cents', o.total_cents,
    -- Helpr delivery (20261106194913): a late cancel gives back the delivery no Helpr picked up yet.
    'refund_cents', CASE WHEN v_free THEN a.refund_cents
                         WHEN o.fulfillment = 'helpr_delivers' AND public.shop_delivery_reserved_cents(o.id) = 0
                         THEN o.delivery_cents ELSE 0 END,
    'kept_cents', CASE WHEN v_free THEN a.kept_cents + a.tax_kept_cents
                       WHEN o.fulfillment = 'helpr_delivers' AND public.shop_delivery_reserved_cents(o.id) = 0
                       THEN o.total_cents - o.delivery_cents ELSE o.total_cents END);
END;
$fn$;


-- RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (a delivery refund the app made leaves the charge whole for the shop's payout).
DROP FUNCTION IF EXISTS public.shop_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.shop_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, livemode boolean, checkout_session_id text, attempts integer,
               refunds_recorded_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, o.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id,
         o.payment_livemode, o.stripe_checkout_session_id, p.attempts,
         public.shop_order_refunds_recorded_cents(o.id)
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

-- Q807: an unconfirmed email cannot write the new tables either (the same guarded call as 20261106163703).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;
