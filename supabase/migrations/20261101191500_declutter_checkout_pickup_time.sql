-- B110 (owner 11-01 11:44 AM; lead 1:14 PM): Buy now and accepted offers: the buyer picks the pickup DAY and TIME at
-- checkout, before paying; on payment the time is booked and goes to the seller with the order.
-- Time format (lead 1:14 PM): a porch pickup is a 2-hour WINDOW (the seller leaves it out, e.g. "Sat 11/2, 3–5 PM");
-- a door pickup and a meetup are an exact 30-minute time. The 30-minute booking stays the unit (declutter_bookings);
-- the window is stored on the order (pickup_slot_start / pickup_slot_end).
--
-- 1. declutter_orders.pickup_slot_start / pickup_slot_end (NULL: no time chosen at checkout, the old path).
-- 2. declutter_checkout_pickup_end (new, service_role only): the end of the chosen time when it is inside the order's
--    hours (declutter_order_slot_in_windows, the check declutter_book_pickup runs), else NULL.
-- 3. declutter_pickup_time_words (new, service_role only): "Pickup Sat 11/2, 3–5 PM. Have it ready on the porch."
-- 4. declutter_start_checkout, restated VERBATIM from its newest CREATE (20261101032626_declutter_checkout_page_inside_hold),
--    p_slot_start now also kept for porch / pickup_home / meetup: refused unless ahead, within 7 days and inside the
--    hours; frozen on the order; part of the same-order comparison. NULL keeps every old call the same.
-- 5. declutter_mark_order_paid, restated VERBATIM from its newest CREATE (20261101030040_declutter_buy_now_30_minutes):
--    a chosen time still ahead is booked (declutter_bookings + handover code, as declutter_book_pickup's 'booked'
--    branch) and the seller's "Buyer paid" notice carries it.
-- 6. declutter_take_item, restated VERBATIM from its newest CREATE (20261101030040): the accepted-offer notice says who
--    accepted it and what to do next (lead 12:01 PM copy).
-- Newest CREATEs measured 11-01 with git grep over origin/main and every origin wip/, ready/ and train/ branch.
--
-- MONEY: no amount, fee, refund or status changes. AUTHZ: no new member-callable function; both helpers are
-- service_role only; start_checkout's grants restated. REPLAY-SAFE: IF NOT EXISTS / CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterCheckoutPickupTime.pglite.mjs.

ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS pickup_slot_start timestamptz;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS pickup_slot_end timestamptz;
ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_pickup_slot;
ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_pickup_slot CHECK (
  (pickup_slot_start IS NULL) = (pickup_slot_end IS NULL)
  AND (pickup_slot_end IS NULL OR (pickup_slot_end > pickup_slot_start AND pickup_slot_end <= pickup_slot_start + interval '2 hours')));

CREATE OR REPLACE FUNCTION public.declutter_checkout_pickup_end(p_order_id uuid, p_seller uuid, p_handover text,
  p_start timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_local timestamp := p_start AT TIME ZONE 'America/Chicago';
  v_hours jsonb;
  v_ends time;
BEGIN
  IF p_handover IS NULL OR p_handover NOT IN ('porch', 'pickup_home', 'meetup')
     OR NOT public.declutter_order_slot_in_windows(p_order_id, p_seller, p_start) THEN
    RETURN NULL;
  END IF;
  IF p_handover <> 'porch' THEN
    RETURN p_start + interval '30 minutes';
  END IF;
  -- A porch window: 2 hours from the start, cut at the end of the seller's window it starts in.
  SELECT op.windows INTO v_hours FROM public.declutter_order_porch_places op WHERE op.order_id = p_order_id;
  IF v_hours IS NOT NULL THEN
    SELECT max((e ->> 'ends')::time) INTO v_ends
      FROM jsonb_array_elements(v_hours) e
     WHERE (e ->> 'weekday')::int = extract(dow FROM v_local)::int
       AND v_local::time >= (e ->> 'starts')::time
       AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes';
  ELSE
    SELECT max(w.ends_local) INTO v_ends
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = p_seller
       AND w.weekday = extract(dow FROM v_local)::smallint
       AND v_local::time >= w.starts_local
       AND v_local::time <= w.ends_local - interval '30 minutes';
  END IF;
  IF v_ends IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LEAST(v_local + interval '2 hours', v_local::date + v_ends) AT TIME ZONE 'America/Chicago';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_pickup_end(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_pickup_end(uuid, uuid, text, timestamptz) TO service_role;

-- "3 PM" / "3:30 PM" pieces, Chicago time.
CREATE OR REPLACE FUNCTION public.declutter_pickup_time_words(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  a timestamp;
  b timestamp;
  v_day text;
  v_a text;
  v_b text;
  v_spot text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR o.pickup_slot_start IS NULL THEN
    RETURN NULL;
  END IF;
  a := o.pickup_slot_start AT TIME ZONE 'America/Chicago';
  b := o.pickup_slot_end AT TIME ZONE 'America/Chicago';
  v_day := to_char(a, 'Dy FMMM/FMDD');
  IF o.handover = 'porch' THEN
    v_a := to_char(a, 'FMHH12') || CASE WHEN extract(minute FROM a) <> 0 THEN to_char(a, ':MI') ELSE '' END;
    v_b := to_char(b, 'FMHH12') || CASE WHEN extract(minute FROM b) <> 0 THEN to_char(b, ':MI') ELSE '' END;
    RETURN format('Pickup %s, %s. Have it ready on the porch.', v_day,
      CASE WHEN to_char(a, 'AM') = to_char(b, 'AM') THEN v_a || '–' || v_b || ' ' || to_char(b, 'AM')
           ELSE v_a || ' ' || to_char(a, 'AM') || '–' || v_b || ' ' || to_char(b, 'AM') END);
  ELSIF o.handover = 'meetup' THEN
    SELECT m.spot_name INTO v_spot FROM public.declutter_order_meetups m WHERE m.order_id = o.id;
    RETURN format('Meet %s at %s%s.', v_day, to_char(a, 'FMHH12:MI AM'), COALESCE(' at ' || v_spot, ''));
  END IF;
  RETURN format('Pickup %s at %s. Have it ready.', v_day, to_char(a, 'FMHH12:MI AM'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_time_words(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_time_words(uuid) TO service_role;

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
  v_place public.declutter_porch_places%ROWTYPE;
  v_pickup_end timestamptz;
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
  ELSIF p_handover IN ('porch', 'pickup_home', 'meetup') THEN
    -- B110 (owner 11-01): the buyer picks the pickup day and time BEFORE paying. Optional (NULL: an older app, or a
    -- seller with no times; the buyer books after paying as before). Checked here for the future and the 7-day
    -- pickup deadline; inside the seller's hours below, once the order (and its frozen place) exists.
    p_handoff := NULL;
    IF p_slot_start IS NOT NULL
       AND (p_slot_start <= now() OR p_slot_start + interval '30 minutes' > now() + interval '7 days') THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
        HINT = 'Pick a pickup time in the future, within the next 7 days.';
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
         -- Review 2026-10-31 (low): and the place's hours (20261031145652), so edited hours never reuse a stale order.
         (SELECT pp.place_id::text || '|' || pp.address || '|' || pp.lat || '|' || pp.lng || '|' || pp.weekdays::text
                 || '|' || coalesce(pp.windows::text, '')
            FROM public.declutter_order_porch_places pp WHERE pp.order_id = o.id) AS porch_key,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines,
         o.pickup_slot_start
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now()
             -- BUY-1 follow-up (lh-money-escrow): no new page once the line's own hold plus 10 min is over.
             AND now() <= c2.created_at + public.declutter_hold_length(c2.price_cents, c2.source) + interval '10 minutes'
           ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now()
     -- BUY-1 follow-up: the same limit as the line list above.
     AND now() <= c.created_at + public.declutter_hold_length(c.price_cents, c.source) + interval '10 minutes';
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
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  IF public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (owner-approved 2026-10-29, 20261030164712): a seller with saved porch places hands over at the ONE the
  -- buyer picked (declutter_set_porch_place), for a porch pickup and for Helpr delivery alike. Read under a share
  -- lock so the seller cannot edit it mid-checkout; it is frozen on the order below. A seller with no places: as before.
  IF p_handover IN ('porch', 'pickup_home', 'delivery')
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
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
     -- D-NEW14: and the same porch place, as it is now (an edited or changed place opens a new order).
     AND v_existing.porch_key IS NOT DISTINCT FROM
         (v_place.id::text || '|' || v_place.address || '|' || v_place.lat || '|' || v_place.lng || '|' || v_place.weekdays::text
          || '|' || coalesce(v_place.windows::text, ''))
     -- Q2425: and the same meeting spot.
     AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id)
     -- B110: and the same pickup time (a changed time opens a new order; the app closes the old page first).
     AND (p_handover NOT IN ('porch', 'pickup_home', 'meetup')
          OR v_existing.pickup_slot_start IS NOT DISTINCT FROM p_slot_start) THEN
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

  -- D-NEW14: the chosen porch place, frozen: the seller editing or deleting it later never moves this sale.
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;

  IF p_handover = 'meetup' THEN
    -- A snapshot: an admin editing or retiring the spot later never moves a meeting already agreed.
    INSERT INTO public.declutter_order_meetups (order_id, spot_id, spot_name, spot_address, spot_lat, spot_lng)
    VALUES (v_order, v_spot.id, v_spot.name, v_spot.address, v_spot.lat, v_spot.lng);
  END IF;

  -- B110: the chosen pickup time, inside the seller's hours for THIS order (its frozen place's hours, else the
  -- seller's usual times; a porch order keeps to the porch days): declutter_book_pickup's own check. A porch pickup
  -- is a 2-hour window (lead 11-01: the seller leaves it out); a door pickup or a meetup is the 30-minute time.
  -- A refusal rolls back the whole checkout (the order above included).
  IF p_handover IN ('porch', 'pickup_home', 'meetup') AND p_slot_start IS NOT NULL THEN
    v_pickup_end := public.declutter_checkout_pickup_end(v_order, p_seller_id, p_handover, p_slot_start);
    IF v_pickup_end IS NULL THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
    UPDATE public.declutter_orders SET pickup_slot_start = p_slot_start, pickup_slot_end = v_pickup_end
     WHERE id = v_order;
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_pickup text;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  -- 141d: a replayed payment event for a HANDED-OVER sale is the same payment, never a new one to refund
  -- (before this it fell through to 'order_closed' and refunded the whole sale while the seller was paid).
  IF o.status IN ('paid', 'refunded', 'handed_over') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  -- Q2352: the page charged the sale plus the one-time setup fee frozen on the order, or the sale alone: a page
  -- opened by a declutter-checkout that did not know the fee yet (the migration deploys before the edge,
  -- functions-deploy.yml waits for db-deploy; lh-money-escrow review of the Q2352 branch #1). Then the fee was
  -- not charged: it is marked so, nothing is claimed, and the account pays it at its next first-time step.
  IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes. BUY-1: the sale no
      -- longer stands; the hold was released, so the payment is refunded in full.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      -- BUY-1 (lead 10-31): the hold was already released (the item went back on sale and the offers it closed
      -- reopened), so the sale is never brought back: every cent is refunded. The strike still goes (paid in time).
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
        'You paid in time, so the missed-checkout strike is gone. The hold on the item had already ended, so every cent is coming back to your card.',
        '/declutter?view=cart', o.seller_id);
      -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
      -- thing that stops the sale, the seller (not us) owes the card fee; the
      -- buyer still gets every cent. Anything else is ours.
      v_reason := CASE WHEN v_items_ok AND v_cant
                             AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                                              WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                       THEN 'seller_out' ELSE 'order_closed' END;
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  -- B110 (owner 11-01): the pickup time the buyer chose at checkout is booked now, exactly as declutter_book_pickup's
  -- 'booked' branch (a 30-minute booking at the start, and the handover code), when it is still ahead and inside the
  -- 7-day deadline. One already past (a late payment) is not booked: the buyer picks a time after paying, as before.
  IF o.handover IN ('porch', 'pickup_home', 'meetup') AND o.pickup_slot_start IS NOT NULL
     AND o.pickup_slot_start > now() AND o.pickup_slot_start + interval '30 minutes' <= now() + interval '7 days' THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, o.pickup_slot_start, o.pickup_slot_start + interval '30 minutes')
    ON CONFLICT (order_id) DO NOTHING;
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
    v_pickup := public.declutter_pickup_time_words(o.id);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid %s for %s. %s', public.declutter_price_text(p_amount_cents), public.declutter_order_items_named(p_order_id),
           public.declutter_paid_next_step(p_order_id)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid %s for %s. %sYou get paid after the handover.', public.declutter_price_text(o.items_cents),
           public.declutter_order_items_named(p_order_id), COALESCE(v_pickup || ' ', '')),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seller uuid;
  v_title text;
  v_line uuid;
  v_price text := public.declutter_price_text(p_price);
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND is_seed)
     AND public.seed_hidden_for(p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.declutter_items
     SET status = 'reserved', updated_at = now()
   WHERE id = p_item_id AND status = 'live'
  RETURNING seller_id, title INTO v_seller, v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;

  IF p_offer_id IS NOT NULL THEN
    UPDATE public.declutter_offers
       SET status = 'accepted', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND item_id = p_item_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- BUY-1 (owner 10-31): Buy now holds 30 minutes, an accepted offer 24 hours to pay; a free claim keeps its 48 hours.
  -- The line is made BEFORE the other offers are voided, so each voided offer records the hold that voided it.
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + public.declutter_hold_length(p_price, p_source))
  RETURNING id INTO v_line;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = v_line
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    -- BUY-1: if this hold runs out unpaid the offer opens again (declutter_reopen_voided_offers).
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item on hold for another buyer',
      format('"%s" is on hold for another buyer, so your offer is closed for now. If they don''t pay in time, it opens again. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  IF p_price = 0 THEN
    -- A free claim (20261027170717): the same 48 hours, nothing to pay.
    -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
    PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
      format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. Nothing is charged.',
             v_title),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
      format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
      '/declutter?view=selling', p_buyer);
  ELSIF p_source = 'buy' THEN
    -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 30 minutes',
      format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
             v_title, v_price),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
      format('"%s" sold for %s. The buyer has 30 minutes to check out and pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
  ELSE
  -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
  -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
  PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 24 hours',
    CASE WHEN p_offer_id IS NOT NULL THEN
      format('%s accepted your %s offer for "%s". Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay, or it goes back up for sale and you get a strike. Your card is not charged until you check out.',
             COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller'),
             v_price, v_title)
    ELSE
    format('"%s" is in your cart for %s. Check out within 24 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price) END,
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for %s. The buyer has 24 hours to check out and pay.', v_title, v_price),
    '/declutter?view=selling', p_buyer);
  END IF;
  RETURN v_line;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;
