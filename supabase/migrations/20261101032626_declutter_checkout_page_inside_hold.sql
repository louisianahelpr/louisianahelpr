-- BUY-1 follow-ups (lh-money-escrow approve of 20261101030040, lead 10-31; for verdict).
--
-- 1. declutter_start_checkout (restated VERBATIM from its newest CREATE, 20261031164337_declutter_door_pickup_uses_places.sql,
--    two predicates added): a line whose own hold plus 10 minutes is over (now() > created_at + declutter_hold_length +
--    10 min) is not checked out, so no new Stripe page is opened for it; with none left the buyer gets cart_empty. With
--    the stretch cap in declutter_attach_checkout_session (hold + 31 min) and the sweep's 10 min grace, a page opened at
--    the last allowed moment ends (hold + 41 min) no later than the hold's release, so no page outlives it. A payment
--    that still lands on a released hold is refunded in full (declutter_mark_order_paid, 20261101030040).
-- 2. declutter_reopen_voided_offers (restated from 20261101030040): the seller is told too when an offer opens again.
--
-- MONEY: no amount, fee or status changes; one more way to refuse a checkout before an order is made.
-- REPLAY-SAFE: CREATE OR REPLACE, grants restated. Proof: src/test/pglite/declutterCheckoutPageInsideHold.pglite.mjs.

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
         -- Review 2026-10-31 (low): and the place's hours (20261031145652), so edited hours never reuse a stale order.
         (SELECT pp.place_id::text || '|' || pp.address || '|' || pp.lat || '|' || pp.lng || '|' || pp.weekdays::text
                 || '|' || coalesce(pp.windows::text, '')
            FROM public.declutter_order_porch_places pp WHERE pp.order_id = o.id) AS porch_key,
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

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_reopen_voided_offers(p_line uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer := 0;
  r record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'open', closed_at = NULL, updated_at = now(), respond_by = now() + interval '48 hours'
     WHERE o.voided_by_line = p_line AND o.status = 'voided'
       AND EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = o.item_id AND i.status = 'live')
    RETURNING o.id, o.buyer_id, o.seller_id, o.item_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title
  LOOP
    v_n := v_n + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'reopen');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Your offer is open again',
      format('"%s" is back on sale, so your offer is open again. The seller has 48 hours to answer it. Nothing was charged.', r.title),
      '/declutter/item/' || r.item_id::text, r.seller_id);
    -- Follow-up (lead 10-31): the seller is told too, so the reopened offer is answered.
    PERFORM public.declutter_notify(r.seller_id, 'new_offers', 'An offer is open again',
      format('"%s" is back on sale, so an offer the hold closed is open again. You have 48 hours to answer it.', r.title),
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_reopen_voided_offers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_reopen_voided_offers(uuid) TO service_role;
