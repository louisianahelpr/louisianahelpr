-- Q2427 (owner 2026-10-27): Declutter bundle discounts, "Buy 2+, get N% off".
--
-- The problem: a seller clearing out a house had no way to reward a buyer for taking several things at once, though
-- checkout is already one order per seller (declutter_start_checkout groups every cart line from that seller).
--
-- What this adds:
--   * declutter_bundle_rules: one rule per seller, N from 5 to 50 (percent). Set or removed by the seller
--     (declutter_set_bundle_discount); read by any member while Declutter is on (declutter_bundle_rule).
--   * At checkout, when the cart from that seller has 2 or more PAID lines (free lines are $0 and never count or
--     change), each paid line's price becomes its original price less N%, never below the item's private lowest
--     price (declutter_item_private.floor_price_cents), never below $1, never above the original price. The
--     original stays on the line (list_price_cents) so a later checkout always starts again from it (the rule
--     changed or was removed, a line left the cart: the original comes back).
--   * Everything after checkout already reads the line prices and the order's items_cents, so the buyer's fee is on
--     the discounted paid total, the seller is paid the discounted total, and any refund (whole order or one line)
--     is of what was paid: pro-rated by construction. The order records bundle_discount_cents for the screens and
--     receipts. Members see "Bundle discount -$X" and the total, never fee math (owner rule).
--   * declutter_bundle_preview(seller): the discount the caller's cart from that seller would get now (the same
--     function checkout uses), so the cart shows the real number before Pay.
--   * The open order is handed back only when its items total is the one the rule gives now (an idempotency clause
--     added), so a changed rule always opens a new order rather than charging an old total.
--
-- Restated from its newest definition (20261027204500_declutter_safe_meetup.sql) with only the bundle lines added:
-- declutter_start_checkout. Restated from 20261027153244_declutter_seller_delivery.sql: declutter_seller_delivery_check (its items total). Restated from 20261021204947_declutter_sales_outlive_a_deleted_party.sql: declutter_my_cart (a line still in the cart shows its
-- original price; the discount is applied at checkout).
-- REPLAY-SAFETY: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.declutter_bundle_rules (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  percent smallint NOT NULL CHECK (percent BETWEEN 5 AND 50),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_bundle_rules ENABLE ROW LEVEL SECURITY;
-- Every public table keeps the unconfirmed-email gate (Q807; db-deploy smoke).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.declutter_bundle_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_bundle_rules TO service_role;
COMMENT ON TABLE public.declutter_bundle_rules IS
  'Q2427: a seller''s "Buy 2+, get N% off" (N 5-50). Written by declutter_set_bundle_discount, read through '
  'declutter_bundle_rule; applied by declutter_start_checkout to paid lines only, never below an item''s floor.';

ALTER TABLE public.declutter_cart_items ADD COLUMN IF NOT EXISTS list_price_cents integer
  CHECK (list_price_cents IS NULL OR list_price_cents BETWEEN 100 AND 1000000);
COMMENT ON COLUMN public.declutter_cart_items.list_price_cents IS
  'Q2427: the line''s price before a bundle discount; NULL when no discount is on it. price_cents is what is charged.';
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS bundle_discount_cents integer NOT NULL DEFAULT 0
  CHECK (bundle_discount_cents >= 0);

-- The one computation, for checkout and the preview: each line's original and its price now.
CREATE OR REPLACE FUNCTION public.declutter_bundle_targets(p_seller_id uuid, p_lines uuid[])
RETURNS TABLE (line_id uuid, base_cents integer, target_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH b AS (
    SELECT c.id, COALESCE(c.list_price_cents, c.price_cents) AS base, p.floor_price_cents AS floor
      FROM public.declutter_cart_items c
      LEFT JOIN public.declutter_item_private p ON p.item_id = c.item_id
     WHERE c.id = ANY (p_lines) AND c.seller_id = p_seller_id
  ), r AS (
    SELECT rr.percent FROM public.declutter_bundle_rules rr WHERE rr.seller_id = p_seller_id
  ), n AS (
    SELECT count(*) FILTER (WHERE b.base > 0) AS paid FROM b
  )
  SELECT b.id, b.base,
         CASE WHEN b.base > 0 AND (SELECT paid FROM n) >= 2 AND EXISTS (SELECT 1 FROM r)
              THEN LEAST(b.base, GREATEST(100, COALESCE(b.floor, 100),
                         round(b.base * (100 - (SELECT percent FROM r)) / 100.0)::integer))
              ELSE b.base END
    FROM b;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bundle_targets(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_targets(uuid, uuid[]) TO service_role;

-- The seller sets (5-50) or removes (NULL or 0) their rule.
CREATE OR REPLACE FUNCTION public.declutter_set_bundle_discount(p_percent integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_percent IS NULL OR p_percent = 0 THEN
    DELETE FROM public.declutter_bundle_rules WHERE seller_id = v_uid;
    RETURN NULL;
  END IF;
  IF p_percent NOT BETWEEN 5 AND 50 THEN
    RAISE EXCEPTION 'invalid_bundle_percent' USING ERRCODE = '22023', HINT = 'Pick from 5% to 50% off.';
  END IF;
  INSERT INTO public.declutter_bundle_rules (seller_id, percent) VALUES (v_uid, p_percent)
  ON CONFLICT (seller_id) DO UPDATE SET percent = EXCLUDED.percent, updated_at = now();
  RETURN p_percent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_bundle_discount(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_bundle_discount(integer) TO authenticated, service_role;

-- Any member, while Declutter is on: a seller's percent, or NULL. Nothing else about the seller.
CREATE OR REPLACE FUNCTION public.declutter_bundle_rule(p_seller_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN (SELECT r.percent::integer FROM public.declutter_bundle_rules r WHERE r.seller_id = p_seller_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bundle_rule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_rule(uuid) TO authenticated, service_role;

-- The cart's preview: what the caller's lines from this seller would be discounted by now (cents, 0 when none).
CREATE OR REPLACE FUNCTION public.declutter_bundle_preview(p_seller_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT sum(t.base_cents - t.target_cents)::integer
      FROM public.declutter_bundle_targets(p_seller_id,
             ARRAY(SELECT c.id FROM public.declutter_cart_items c
                    WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
                      AND c.checkout_by > now())) t), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bundle_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_preview(uuid) TO authenticated, service_role;

-- Checkout: the bundle discount on the paid lines (restated from 20261027204500_declutter_safe_meetup.sql).
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
  sd record;
  v_sd_dropoff text;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_spot public.declutter_meetup_spots%ROWTYPE;
  v_bundle_off integer := 0;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, a safe meeting spot, delivery by the seller, or Helpr delivery.';
  END IF;
  -- Q2425: a safe meeting spot is new work for the seller, so it needs the switch (row 62's rule).
  IF p_handover = 'meetup' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Seller delivery is new work for the seller: both switches. The buyer says
  -- how they want it: left at the door or handed to them (owner 2026-10-22).
  IF p_handover = 'seller_delivery' THEN
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_seller_delivery');
    IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
      RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023',
        HINT = 'Choose "Leave it at my door" or "Hand it to me".';
    END IF;
  ELSE
    p_slot_start := NULL;
    p_handoff := NULL;
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         (SELECT x.slot_start FROM public.declutter_seller_deliveries x
           WHERE x.order_id = o.id AND x.status = 'held' AND x.held_until > now()) AS held_slot,
         (SELECT x.dropoff_address FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id) AS sd_dropoff,
         (SELECT m.spot_id FROM public.declutter_order_meetups m WHERE m.order_id = o.id) AS meetup_spot,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- Q2427: the seller's bundle discount on the paid lines (2 or more), from each line's ORIGINAL price every time,
  -- never below the item's floor (declutter_bundle_targets). The lines are locked above. Free lines never change.
  UPDATE public.declutter_cart_items c
     SET price_cents = t.target_cents,
         list_price_cents = CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END
    FROM public.declutter_bundle_targets(p_seller_id, v_lines) t
   WHERE c.id = t.line_id
     AND (c.price_cents IS DISTINCT FROM t.target_cents
          OR c.list_price_cents IS DISTINCT FROM CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END);
  SELECT COALESCE(sum(c.price_cents), 0)::integer,
         COALESCE(sum(COALESCE(c.list_price_cents, c.price_cents) - c.price_cents), 0)::integer
    INTO v_items, v_bundle_off
    FROM public.declutter_cart_items c WHERE c.id = ANY (v_lines);
  -- Only free items (20261027170717): nothing to pay, so never a payment page (no fee, no setup fee).
  -- declutter_checkout_free takes it. A cart mixing free and paid lines checks out here as usual:
  -- the free lines are $0 and the fee is on the paid total.
  IF v_items = 0 THEN
    RAISE EXCEPTION 'free_order' USING ERRCODE = '22023', HINT = 'These items are free. Choose a pickup and tap Get it free.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;
  -- Seller delivery: under the seller's setting-row lock (held to the end of
  -- this transaction), taken BEFORE the setting is read (lh-money-escrow review
  -- of the free-delivery change #1): a seller saving a new price or turning
  -- delivery off mid-checkout is either seen here or waits, so the order never
  -- freezes terms the seller already changed. Then the setting, items, address,
  -- range and the rate; then the slot.
  IF p_handover = 'seller_delivery' THEN
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;
    SELECT * INTO sd FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
    IF sd.reason = 'address_needed' THEN
      RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023', HINT = 'Enter the address to deliver to.';
    ELSIF sd.reason = 'out_of_range' THEN
      RAISE EXCEPTION 'delivery_out_of_range' USING ERRCODE = '22023',
        HINT = 'This seller doesn''t deliver that far. Choose pickup or another delivery.';
    ELSIF sd.reason IS NOT NULL THEN
      RAISE EXCEPTION 'seller_delivery_unavailable' USING ERRCODE = '22023',
        HINT = 'This seller can''t deliver these items. Choose another way to get them.';
    END IF;
    IF p_slot_start IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id) s WHERE s = p_slot_start) THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
        HINT = 'That delivery time was just taken or is no longer open. Pick another time.';
    END IF;
    -- Q2427 (lh-money-escrow follow-up review #1): the rate from THIS checkout's items total (v_items, from the
    -- lines it locked and priced above), never the check's own re-computation: the check reads the bundle rule
    -- and floors in a later snapshot (after the setting-row wait), so a rule saved in between could otherwise
    -- price the delivery on one total and the items on another. The seller's rate and free-over amount are the
    -- locked setting row's (sd.base_rate_cents, sd.free_over_cents).
    v_delivery := public.declutter_seller_delivery_rate_cents(sd.base_rate_cents, sd.free_over_cents, v_items);
    v_sd_dropoff := sd.dropoff_address;
  END IF;

  -- Q2425: a safe meeting spot is the one the buyer chose for this seller (declutter_set_meetup_spot), still
  -- active and still near these items. Never the seller's home: the address is not shared for a meetup.
  IF p_handover = 'meetup' THEN
    SELECT s.* INTO v_spot
      FROM public.declutter_meetup_choices mc
      JOIN public.declutter_meetup_spots s ON s.id = mc.spot_id
     WHERE mc.buyer_id = v_uid AND mc.seller_id = p_seller_id AND s.active
       AND public.declutter_meetup_spot_near_lines(s.id, v_lines);
    IF v_spot.id IS NULL THEN
      RAISE EXCEPTION 'meetup_spot_needed' USING ERRCODE = '22023',
        HINT = 'Pick a safe meeting spot near the seller.';
    END IF;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off). Seller delivery: and
  -- the same slot, still held, to the same address.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup
     -- Q2427: and the items total the bundle rule gives now (a changed or removed rule opens a new order).
     AND v_existing.items_cents = v_items
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff))
     -- Q2425: and the same meeting spot.
     AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id) THEN
    -- lh-money-escrow review #1: an order handed back with NO page yet (the
    -- last try failed before Stripe attached one) gets a new page that lives
    -- 31 min from now, so its hold is re-armed from now too (the setting row
    -- is locked above). An order with a page keeps its hold: the page dies first.
    IF p_handover = 'seller_delivery' AND v_existing.stripe_checkout_session_id IS NULL THEN
      UPDATE public.declutter_seller_deliveries x
         SET held_until = now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer), updated_at = now()
       WHERE x.order_id = v_existing.id AND x.status = 'held' AND x.held_until > now();
    END IF;
    -- A changed door choice moves no money: it is updated on the order already open.
    IF p_handover = 'seller_delivery' THEN
      UPDATE public.declutter_seller_deliveries x SET handoff = p_handoff, updated_at = now()
       WHERE x.order_id = v_existing.id AND x.handoff IS DISTINCT FROM p_handoff;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The Helpr delivery fee is not part of the item total (row 29 prices it
  -- alone); the seller's delivery rate is (owner 2026-10-22, the shipping rule).
  v_premium := CASE WHEN p_handover = 'seller_delivery'
                    THEN public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, bundle_discount_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup,
          v_bundle_off)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;
  IF p_handover = 'seller_delivery' THEN
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
                                                    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, handoff)
    VALUES (v_order, v_uid, p_seller_id, 'held', p_slot_start,
            p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
            now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer),
            sd.dropoff_address, sd.dropoff_area, sd.dropoff_lat, sd.dropoff_lng, p_handoff);
  END IF;

  IF p_handover = 'meetup' THEN
    -- A snapshot: an admin editing or retiring the spot later never moves a meeting already agreed.
    INSERT INTO public.declutter_order_meetups (order_id, spot_id, spot_name, spot_address, spot_lat, spot_lng)
    VALUES (v_order, v_spot.id, v_spot.name, v_spot.address, v_spot.lat, v_spot.lng);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

-- The cart read: a line still in the cart shows its original price (restated from 20261021204947_declutter_sales_outlive_a_deleted_party.sql).
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer,
               porch_ok boolean, delivery_cents integer, delivery_task_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, COALESCE(i.title, 'An item from a former member'),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         -- Q2427: a line still in the cart shows its original price (a bundle discount is applied at checkout).
         c.seller_id, CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END,
         c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;

-- Seller delivery's free-over-$X threshold and its rate read the items total at the BUNDLE prices (lh-money-escrow
-- review #1): the offer the buyer sees before Pay and the check checkout runs both call this, so they agree
-- (restated from 20261027153244_declutter_seller_delivery.sql, the one line that totals the items changed).
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_check(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (reason text, rate_cents integer, radius_miles integer, dropoff_address text, dropoff_area text,
               dropoff_lat numeric, dropoff_lng numeric, base_rate_cents integer, free_over_cents integer, items_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  s public.declutter_seller_delivery;
  d public.declutter_delivery_dropoffs;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_far integer;
  v_unplaced boolean;
  v_items integer;
  v_rate integer;
BEGIN
  SELECT * INTO s FROM public.declutter_seller_delivery x WHERE x.seller_id = p_seller;
  -- A setting outside the rules (a rate the caps no longer allow) offers nothing; $0 is free delivery.
  IF NOT FOUND OR NOT s.enabled
     OR NOT (s.rate_cents = (v_rules ->> 'free_rate_cents')::integer
             OR s.rate_cents BETWEEN (v_rules ->> 'rate_min_cents')::integer AND (v_rules ->> 'rate_max_cents')::integer) THEN
    RETURN QUERY SELECT 'seller_not_delivering'::text, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  -- The order's items total from this seller, before fees: every line of the one order (owner 2026-10-27).
  -- Q2427: at the bundle prices (each paid line N% off when 2+, never below its floor), as checkout charges.
  SELECT COALESCE(sum(t.target_cents), 0)::integer INTO v_items FROM public.declutter_bundle_targets(p_seller, p_lines) t;
  v_rate := public.declutter_seller_delivery_rate_cents(s.rate_cents, s.free_over_cents, v_items);
  IF p_lines IS NULL OR cardinality(p_lines) = 0 OR EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_item_no_seller_delivery n ON n.item_id = c.item_id
        WHERE c.id = ANY (p_lines)) THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RETURN QUERY SELECT 'address_needed'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  SELECT bool_or(p.pickup_lat IS NULL OR p.pickup_lng IS NULL),
         max(public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng))
    INTO v_unplaced, v_far
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.id = ANY (p_lines);
  IF v_unplaced IS NOT FALSE OR v_far IS NULL THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  IF v_far > s.radius_miles THEN
    RETURN QUERY SELECT 'out_of_range'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::text, v_rate, s.radius_miles, d.address, d.area_label, d.lat, d.lng,
                      s.rate_cents, s.free_over_cents, v_items;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) TO service_role;
