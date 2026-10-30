-- SHIPPING S2 (database part): the 'ship' handover joins the order CHECK together with every
-- handover-generic path that would otherwise catch it (docs/specs/shipping-draft.md section 11,
-- money review must-fix 1; owner decisions 2026-10-20; Q2259).
--
-- Why one migration: 24 Declutter functions on prod test the handover NEGATIVELY (<> / NOT IN,
-- measured 2026-10-30 ~00:05Z with pg_get_functiondef). Each that reaches money or an address
-- is restated here, from its EFFECTIVE prod definition (pg_get_functiondef, read-only), with
-- only the 'ship' lines added:
--   * declutter_orders_fee_rule_f1   (prod = 20261027170717): 'ship' -> fee rule 'f1_ship'
--     (decision 2: 5% of items + shipping + 70c), so the S1 premium CHECK prices it.
--   * declutter_handover_sweep       (prod = 20261028225038): the
--     24 h auto-pay loop and the 7-day no-booking loop skip 'ship' (a shipped order would be
--     closed as buyer_no_show 7 days after payment, must-fix 1). Shipped orders finish only on
--     the delivered scan + 48 h (S7's own sweep).
--   * declutter_bookings_not_delivery (prod = 20261027153244): a shipped order never books a
--     pickup slot (which would start the 24 h auto-pay).
--   * declutter_address_access       (prod = 20261027204500): the buyer of a SHIPPED order is
--     never given the seller's home address (the label carries it to USPS, not the buyer).
--   * declutter_confirm_handover     (prod = 20261028202844): the buyer's "I got it" on a
--     shipped order only after the USPS delivered scan (review fix 10).
-- The other negative tests are whitelists of one handover (porch / seller_delivery / meetup /
-- delivery-only RPCs) and already refuse 'ship'; src/test/shippingHandoverExclusions.test.ts
-- lists them and fails when a new negative test does not name 'ship'.
--
-- The label budget (GUARD, spec Q2259): a shipment's quoted_cents (the most a label may cost)
-- can never exceed the shipping the buyer paid on its order, and shipping_rate_buyable()
-- refuses any rate above it. The worker (S5) calls it BEFORE buying.
--
-- NOT here: no member path can create a 'ship' order yet (declutter_start_checkout's whitelist
-- does not take 'ship'; the item's "Ship it" tick, the switch declutter_shipping and its first
-- useFeature read come with the checkout phase), so this migration changes nothing members see.
--
-- Replay-safe: CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS + ADD in one block.

-- DESTRUCTIVE-DDL-ACK: declutter_orders_handover_check
-- ACK-REASON: dropped only to be re-added in the same block with one more allowed value ('ship');
--   every existing row keeps a value the new CHECK allows.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.

-- 1. The handover.
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_handover_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_handover_check
    CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship'));
END
$do$;

-- 2. The fee rule (restated from prod; only the 'ship' line is new).
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_f1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A free claim (20261027170717) carries no fee at all: rule 'free', and only with paid_with 'free'.
  NEW.fee_rule := CASE WHEN NEW.paid_with = 'free' THEN 'free'
                       WHEN NEW.handover = 'seller_delivery' THEN 'f1_seller_delivery'
                       -- Shipping S2 (decision 2): the fee counts the shipping, so it always covers the card fee.
                       WHEN NEW.handover = 'ship' THEN 'f1_ship'
                       ELSE 'f1' END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_f1() FROM PUBLIC, anon, authenticated;

-- 3. The handover sweep (restated from prod; only 'ship' added to the four NOT IN lists).
CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_reminders integer := 0;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  -- Shipping S2: a shipped order is never finished or closed here; it finishes on the USPS
  -- delivered scan + 48 h (S7), and never books a slot (declutter_bookings_not_delivery).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now())
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL)) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (c) Seller delivery: 24 h after the seller's "Delivered" (a photo, when left at the
  -- door) or "Handed over", unless a problem is open.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'booked'
       AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
       AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h JOIN public.declutter_seller_deliveries d ON d.order_id = h.order_id
                      WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
                        AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_sd_auto := v_sd_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (d) Reminders before a booked delivery (24 h and 1 h, from the rules). One
  -- per run per order: the nearest one due; any earlier one not sent yet is
  -- marked sent too, so a late booking never gets "tomorrow" after "soon".
  FOR r IN
    SELECT d.order_id, d.buyer_id, d.seller_id, d.slot_start, d.dropoff_area, d.reminded_hours
      FROM public.declutter_seller_deliveries d
      JOIN public.declutter_orders o2 ON o2.id = d.order_id
     WHERE d.status = 'booked' AND o2.status = 'paid' AND d.slot_start > now()
       AND d.slot_start <= now() + make_interval(hours => (SELECT max(x::integer) FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x))
     ORDER BY d.slot_start LIMIT 500
  LOOP
    BEGIN
      SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
       WHERE r.slot_start <= now() + make_interval(hours => x::integer)
         AND NOT x::integer = ANY (r.reminded_hours);
      IF v_h IS NOT NULL THEN
        UPDATE public.declutter_seller_deliveries d
           SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)
                                   FROM unnest(d.reminded_hours || ARRAY(SELECT x::integer FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
                                                                         WHERE x::integer >= v_h)) y),
               updated_at = now()
         WHERE d.order_id = r.order_id;
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?tab=selling', r.buyer_id);
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Delivery coming up',
          format('The seller delivers on %s.', public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=cart', r.seller_id);
        v_reminders := v_reminders + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.order_id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

-- 4. No pickup slot on a shipped order (restated from prod; only the 'ship' block is new).
CREATE OR REPLACE FUNCTION public.declutter_bookings_not_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'delivery') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'A Helpr is delivering this order and picks the pickup time.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'seller_delivery') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'The seller is delivering this order at the time you picked.';
  END IF;
  -- Shipping S2 (must-fix 1): a booked slot would start the 24 h auto-pay on a parcel in the mail.
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'ship') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'This order is shipped by mail. There is no pickup time.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_bookings_not_delivery() FROM PUBLIC, anon, authenticated;

-- 5. The seller's home address (restated from prod; only 'ship' is new in the NOT IN).
CREATE OR REPLACE FUNCTION public.declutter_address_access(p_item_id uuid, p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
           WHEN i.seller_id = p_user_id THEN 'seller'
           WHEN EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_orders o ON o.id = c.order_id
                         WHERE c.item_id = i.id AND c.status = 'paid'
                           AND o.status = 'paid' AND o.buyer_id = p_user_id
                           -- Q2425: a safe-spot meetup never shares the seller's home address.
                           -- Shipping S2: nor does a shipped order (the buyer never comes to the door).
                           AND o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer'
         END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 6. "I got it" (restated from prod; only the 'ship' block is new).
CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_method IS NULL OR p_method <> 'buyer' THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    -- the seller cannot tap "I got it" for the buyer
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- A seller delivery (20261028202844, #7): only once the seller marked it delivered, or from the delivery
  -- day on the Louisiana calendar. No time booked and not delivered: not yet.
  IF o.handover = 'seller_delivery' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_seller_deliveries d
        WHERE d.order_id = o.id
          AND (d.delivered_at IS NOT NULL
               OR (d.status = 'booked' AND d.slot_start IS NOT NULL
                   AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date))) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it from the delivery day, or once the seller marks it delivered.';
  END IF;
  -- Shipping S2 (review fix 10): a shipped order only after the USPS delivered scan.
  IF o.handover = 'ship' AND NOT EXISTS (
       SELECT 1 FROM public.shipments s
        WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it once the post office scans it as delivered.';
  END IF;
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated;

-- 7. The label budget (GUARD). A shipment belongs to a shipped order, and the most a label may
--    cost (quoted_cents) is never above the shipping the buyer paid on it.
CREATE OR REPLACE FUNCTION public.shipments_within_collected()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_handover text;
  v_shipping integer;
BEGIN
  IF NEW.declutter_order_id IS NOT NULL THEN
    SELECT o.handover, o.shipping_cents INTO v_handover, v_shipping
      FROM public.declutter_orders o WHERE o.id = NEW.declutter_order_id;
    IF v_handover IS DISTINCT FROM 'ship' THEN
      RAISE EXCEPTION 'shipment_order_not_shipped' USING ERRCODE = '23514';
    END IF;
    IF v_shipping IS NULL OR NEW.quoted_cents IS NULL OR NEW.quoted_cents > v_shipping THEN
      RAISE EXCEPTION 'label_over_collected_shipping' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shipments_within_collected() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shipments_within_collected ON public.shipments;
CREATE TRIGGER trg_shipments_within_collected BEFORE INSERT ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_within_collected();

-- Asked by the label worker (S5, service role) BEFORE every purchase: is this rate within what
-- the buyer paid? A NULL anything is false (never buy on a missing number).
CREATE OR REPLACE FUNCTION public.shipping_rate_buyable(p_shipment_id uuid, p_rate_cents integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT p_rate_cents IS NOT NULL AND p_rate_cents > 0
       AND s.label_state = 'claimed'
       AND p_rate_cents <= s.quoted_cents
       AND (s.declutter_order_id IS NULL
            OR p_rate_cents <= (SELECT o.shipping_cents FROM public.declutter_orders o WHERE o.id = s.declutter_order_id))
      FROM public.shipments s
     WHERE s.id = p_shipment_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shipping_rate_buyable(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipping_rate_buyable(uuid, integer) TO service_role;
