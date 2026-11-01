-- Free items: when the giver picks an asker, the time that asker chose when they asked becomes the confirmed pickup
-- (owner 11-01, Mockup 3: "If it's you, <time> is already set, and you'll get the address"). Builder 103, on top of
-- Builder 99's 20261101174857_free_ask_picks_a_pickup_time (declutter_free_requests.pickup_at).
--
-- WHAT WAS THERE: declutter_pick_free_request (newest: 20261030064021_declutter_free_requests.sql) closed the asks and
-- called declutter_take_item, which put the item in the picked person's cart with 48 hours to choose how (porch or
-- the giver's home), which place, then book a time (declutter_checkout_free + declutter_book_pickup, both run by the
-- picked person).
--
-- WHAT THIS CHANGES (declutter_pick_free_request restated whole; everything before the hand-off is verbatim):
--   When the picked ask carries a pickup_at AND that time can still be confirmed, the pick does in one step what the
--   picked person did by hand: the item is set aside for them, a $0 'free' order is made and marked paid exactly as
--   declutter_checkout_free makes it (same columns, same place snapshot, same status flips), and the pickup is booked
--   at their time (the same declutter_bookings + declutter_handovers rows declutter_book_pickup inserts on a first
--   booking). The address is then shared as for any free order today (the paid order's place / the giver's door).
--   ONE notice to the picked person: "It's yours. Pickup is <time>." (no "48 hours" notice, no checkout step).
--   The time can be confirmed only when ALL hold; otherwise the old 48-hour path runs unchanged:
--     * pickup_at is in the future and its 30 minutes end before the 7-day pickup deadline (book_pickup's rule);
--     * the picked person needs no ID check first (verified, exempt or admin). declutter_identity_gate only judges a
--       member acting for themselves, so an order made by the giver would skip it: such a person keeps the old path
--       and meets the gate at their own checkout (owner: a free claimer is ID-checked when picked);
--     * a way the item allows: porch when the item takes porch pickup, else the giver's home (declutter_handover_refused's
--       rule for one line);
--     * a giver with pickup places: a place open at that time (the picked person's saved choice first, else the
--       first place by position); a giver with none: the time is inside the usual times (declutter_slot_in_windows);
--     * no order of theirs with this giver is waiting on a payment page (declutter_orders_one_awaiting);
--     * porch only on the giver's porch days when they have no places, and the booked time passes the order's own
--       check (declutter_order_slot_in_windows, as declutter_book_pickup checks the buyer); a time that fails it is
--       undone (inner block, rolled back) and the old path runs.
--   An ask with no pickup_at (asked from an older app build) keeps the old path.
--
-- MONEY: none ($0 order, paid_with 'free', fee rule from the existing trigger). REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/freePickConfirmsTheTime.pglite.mjs (applied 3x, with mutants).

CREATE OR REPLACE FUNCTION public.declutter_pick_free_request(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req record;
  v_item record;
  v_line uuid;
  r record;
  v_handover text;
  v_place public.declutter_porch_places%ROWTYPE;
  v_local timestamp;
  v_has_places boolean;
  v_order uuid;
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_req FROM public.declutter_free_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.seller_id <> v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.id, i.status, i.current_price_cents, i.title INTO v_item
    FROM public.declutter_items i WHERE i.id = v_req.item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Re-read under the item lock: a withdraw or a second pick may have landed first.
  SELECT * INTO v_req FROM public.declutter_free_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'That person took back their ask.';
  END IF;
  IF v_item.status <> 'live' OR v_item.current_price_cents <> 0 THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_uid, v_req.requester_id) OR public.declutter_member_out(v_req.requester_id) THEN
    RAISE EXCEPTION 'requester_unavailable' USING ERRCODE = '55000', HINT = 'That person can''t take items right now. Pick someone else.';
  END IF;
  -- Close the asks first, so the item-left-live trigger finds none open.
  UPDATE public.declutter_free_requests SET status = 'picked', closed_at = now() WHERE id = p_request_id;
  FOR r IN
    UPDATE public.declutter_free_requests SET status = 'not_picked', closed_at = now()
     WHERE item_id = v_item.id AND status = 'open'
    RETURNING requester_id
  LOOP
    PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'It went to someone else',
      format('"%s" went to someone else. Thanks for asking.', v_item.title),
      '/declutter/item/' || v_item.id::text, v_uid);
  END LOOP;

  -- ── Owner 11-01: the asked time becomes the confirmed pickup, when it still can (header). ──
  IF v_req.pickup_at IS NOT NULL
     AND v_req.pickup_at > now()
     AND v_req.pickup_at + interval '30 minutes' <= now() + interval '7 days'
     AND (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_req.requester_id AND ur.role = 'admin')
          OR public.identity_check_exempt(v_req.requester_id)
          OR public.is_identity_verified(v_req.requester_id))
     AND NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                      WHERE o.buyer_id = v_req.requester_id AND o.seller_id = v_uid AND o.status = 'awaiting_payment')
     AND NOT EXISTS (SELECT 1 FROM public.declutter_items i
                      WHERE i.id = v_item.id AND i.is_seed AND public.seed_hidden_for(v_req.requester_id))
  THEN
    v_local := v_req.pickup_at AT TIME ZONE 'America/Chicago';
    v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = v_uid);
    IF v_has_places THEN
      -- The picked person's saved place first, else the first place by position; only a place open at that time.
      SELECT pl.* INTO v_place
        FROM public.declutter_porch_places pl
        LEFT JOIN public.declutter_porch_place_choices ch
          ON ch.place_id = pl.id AND ch.buyer_id = v_req.requester_id AND ch.seller_id = v_uid
       WHERE pl.seller_id = v_uid
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(
                    coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))) e
            WHERE (e ->> 'weekday')::int = extract(dow FROM v_local)::int
              AND v_local::time >= (e ->> 'starts')::time
              AND (e ->> 'ends')::time >= (e ->> 'starts')::time + interval '30 minutes'
              AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes')
       ORDER BY (ch.place_id IS NULL), pl.position
       LIMIT 1
       FOR SHARE OF pl;
    END IF;
    -- A way this item allows, by declutter_handover_refused's rule for one line (its ticks; an older item with none,
    -- every way but porch when porch_ok is off): porch when it takes porch pickup, else the giver's home.
    -- A giver with no places keeps porch pickups to their porch days (declutter_order_slot_in_windows' rule).
    SELECT CASE WHEN i.porch_ok AND (i.handovers IS NULL OR 'porch' = ANY (i.handovers))
                     AND (v_has_places OR COALESCE(public.declutter_is_porch_day(v_uid, extract(dow FROM v_local)::smallint), false))
                  THEN 'porch'
                WHEN i.handovers IS NULL OR 'pickup_home' = ANY (i.handovers) THEN 'pickup_home'
           END INTO v_handover
      FROM public.declutter_items i WHERE i.id = v_item.id;
    IF NOT ((v_has_places AND v_place.id IS NOT NULL)
            OR (NOT v_has_places AND public.declutter_slot_in_windows(v_uid, v_req.pickup_at))) THEN
      v_handover := NULL;
    END IF;
    IF v_handover IS NOT NULL THEN
    BEGIN
      -- The item set aside for them, as declutter_take_item does for a free claim, without its 48-hour notices.
      UPDATE public.declutter_items SET status = 'reserved', updated_at = now()
       WHERE id = v_item.id AND status = 'live'
      RETURNING title INTO v_title;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
      END IF;
      INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
      VALUES (v_item.id, v_req.requester_id, v_uid, 0, 'buy', NULL, now() + public.declutter_hold_length(0, 'buy'))
      RETURNING id INTO v_line;
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = v_line
         WHERE item_id = v_item.id AND status = 'open'
        RETURNING id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      END LOOP;
      -- The order, exactly as declutter_checkout_free makes it: $0 everywhere, paid_with 'free', paid at once.
      INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                           delivery_cents, total_cents, setup_fee_cents, paid_with)
      VALUES (v_req.requester_id, v_uid, v_handover, 0, 0, 0, 0, 0, 0, 'free')
      RETURNING id INTO v_order;
      UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = v_line;
      IF v_place.id IS NOT NULL THEN
        INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
        VALUES (v_order, v_uid, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
      END IF;
      -- The time must pass the order's own check, as declutter_book_pickup would make the picked person pass it;
      -- when it does not, everything since BEGIN is undone and the old path runs.
      IF NOT public.declutter_order_slot_in_windows(v_order, v_uid, v_req.pickup_at) THEN
        RAISE EXCEPTION 'free_pick_time_unusable' USING ERRCODE = 'LHFP1';
      END IF;
      UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
       WHERE id = v_order AND status = 'awaiting_payment';
      UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
       WHERE c.id = v_line AND c.status = 'in_cart';
      UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = v_item.id AND status = 'reserved';
      -- The booking, as declutter_book_pickup's first booking makes it.
      INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
      VALUES (v_order, v_req.requester_id, v_uid, v_req.pickup_at, v_req.pickup_at + interval '30 minutes');
      INSERT INTO public.declutter_handovers (order_id, code) VALUES (v_order, public.declutter_new_handover_code())
      ON CONFLICT (order_id) DO NOTHING;
      PERFORM public.declutter_notify(v_req.requester_id, 'payment', 'It''s yours',
        format('"%s" is yours. Pickup is %s; the address is in your order. Nothing is charged.', v_title,
               to_char(v_req.pickup_at AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
        '/declutter?view=cart', v_uid);
      RETURN v_line;
    EXCEPTION WHEN SQLSTATE 'LHFP1' THEN
      v_line := NULL;
    END;
    END IF;
  END IF;

  v_line := public.declutter_take_item(v_item.id, v_req.requester_id, 0, 'buy', NULL);
  RETURN v_line;
END;
$function$;
