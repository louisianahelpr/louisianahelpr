-- Declutter: NO ID check and NO $2 account setup fee, for anyone (owner 2026-11-20, pop-up). Supersedes the 10-22 /
-- 10-30 / 11-12 Declutter rows of OWNER-DECISIONS.md ("ID check + $2 setup fee"):
--   * SELLER: no ID before the first payout, no $2 out of the payout, no card fee at the first listing.
--   * BUYER: no ID and no $2 at the first purchase (offer, counter, bundle ask, trade, checkout).
--   * FREE CLAIMER: no ID and no $2 when the giver picks them.
-- KEPT exactly as they are: job posters (ID at posting, $2 with the first job payment), Helprs (ID at hire or first
-- payout, $2 from the first payout) and delivery Helprs (ID when taking a delivery; helpr_task payouts keep their
-- setup fee and ID wait). Shops keep theirs (shop_identity_before_list / _buy still call declutter_identity_gate, which
-- is unchanged; Shops is testers-only and was not part of the ruling).
--
-- Server refusals removed (a hidden UI gate over a server that still refuses would be a bug):
--   1. The BUYER triggers on declutter_offers (insert, counter) and declutter_orders (insert) and their function
--      declutter_identity_before_buy.
--   2. The first-listing card fee trigger on declutter_items (setup_fee_required_to_list) and its function.
--   3-5. The ID gate calls in declutter_checkout_free (with declutter_free_claim_gate: setup_fee_required_to_claim /
--      identity_required_to_claim), declutter_offer_swap and declutter_request_bundle.
--   6-7. The free pick books the asked time for everyone; the hold notice says "Nothing is charged." for everyone.
--   8. declutter_start_checkout freezes setup_fee_cents = 0 (no $2 on the buyer's first purchase).
--   9-10. declutter_payout_take_setup_fee never takes the $2; declutter_my_setup_fee always answers none (both kept
--      for deployed callers: declutter-money before its redeploy, and app builds in the field).
--   11. declutter_complete_handover's seller notice drops "Verify your ID to get paid" and the setup-fee sentence.
-- The payout's ID wait itself is in declutter-money (stillPayableNow), which this PR changes to skip the declutter and
-- declutter_manager kinds; payout_waits_on_identity is unchanged (Jobs and delivery Helprs read it).
-- Orders and payouts already carrying a $2 keep their own state machine (claim / refund_due / put back) unchanged;
-- prod 2026-11-20: 0 orders with setup_fee_state 'claimed', 0 payouts with setup_fee_cents > 0.
-- Each function restated from its effective definition (src/test/helpers/effectiveFunctionDefs) with only the
-- CHANGED (owner 2026-11-20) places edited; same signatures and return types; grants restated. Replay-safe.
-- Guard: src/test/declutterNoIdNoSetupFee.test.ts.

-- 1. Buyer ID triggers.
DROP TRIGGER IF EXISTS trg_declutter_offers_identity_before_buy ON public.declutter_offers;
DROP TRIGGER IF EXISTS trg_declutter_offers_identity_before_counter ON public.declutter_offers;
DROP TRIGGER IF EXISTS trg_declutter_orders_identity_before_buy ON public.declutter_orders;
DROP TRIGGER IF EXISTS trg_declutter_cart_identity_before_buy ON public.declutter_cart_items;
DROP FUNCTION IF EXISTS public.declutter_identity_before_buy();

-- 2. First-listing card fee.
DROP TRIGGER IF EXISTS trg_declutter_items_setup_fee_before_list ON public.declutter_items;
DROP FUNCTION IF EXISTS public.declutter_setup_fee_before_list();


-- 3. Free claim / trade checkout: no ID, no $2 (declutter_free_claim_gate is dropped below).
CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_taker text;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
  v_place public.declutter_porch_places%ROWTYPE;
  v_has_swap boolean;  -- trades #8
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  -- CHANGED (trades #8): when this seller's lines include a trade line, only the $0 lines check out here; a priced
  -- line from the same seller stays in the cart for its card checkout (a trade line can never join a card order).
  v_has_swap := EXISTS (SELECT 1 FROM public.declutter_cart_items c
                         WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
                           AND c.checkout_by > now() AND c.swap_id IS NOT NULL);
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() AND (c2.price_cents = 0 OR NOT v_has_swap) ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now() AND (c.price_cents = 0 OR NOT v_has_swap);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- CHANGED (owner 2026-11-20): no ID check and no setup fee for a free claim or a trade. The first-timer gate
  -- (declutter_free_claim_gate) and the trade's ID check are gone; the address opens once the handover is chosen.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
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
  -- D-NEW14 (20261030164712): a free porch pickup from a seller with saved places is at the place the buyer picked.
  IF p_handover IN ('porch', 'pickup_home')
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
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  -- CHANGED (trades #2): a trade pickup says trade, never "free item". Its own kind (declutter_pickups), since
  -- declutter_notice_type does not list these titles (src/test/declutterNoticeKinds.test.ts).
  IF v_has_swap THEN
    PERFORM public.declutter_notify(v_uid, 'declutter_pickups', 'Trade pickup set',
      'Your trade pickup is set. Next: choose when to pick it up. No money changes hands.',
      '/declutter?view=cart', p_seller_id);
    PERFORM public.declutter_notify(p_seller_id, 'declutter_pickups', 'Trade pickup chosen',
      COALESCE(v_taker, 'Someone') || ' chose how to pick up their trade item. No money changes hands.',
      '/declutter?tab=selling', v_uid);
  ELSE
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_order;
END;
$fn$;

-- 4. Trade offer: no ID check.
CREATE OR REPLACE FUNCTION public.declutter_offer_swap(p_item_id uuid, p_offered_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_ok record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_item_id IS NULL OR p_offered_item_id IS NULL OR p_item_id = p_offered_item_id THEN
    RAISE EXCEPTION 'invalid_trade' USING ERRCODE = '22023';
  END IF;
  -- CHANGED (owner 2026-11-20): no ID check for a trade offer.
  SELECT * INTO v_ok FROM public.declutter_swap_items_ok(p_item_id, p_offered_item_id, v_uid);

  -- Unswept past-due offers never block a new one.
  UPDATE public.declutter_swap_offers SET status = 'expired', closed_at = now(), updated_at = now()
   WHERE status = 'open' AND respond_by <= now()
     AND ((item_id = p_item_id AND buyer_id = v_uid) OR offered_item_id = p_offered_item_id);
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.item_id = p_item_id AND s.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'trade_already_open' USING ERRCODE = '55000',
      HINT = 'You already offered a trade for this item. Wait for the answer or take it back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.offered_item_id = p_offered_item_id) THEN
    RAISE EXCEPTION 'offered_item_in_trade' USING ERRCODE = '55000',
      HINT = 'That item is already offered in another trade. Take that offer back first, or pick another item.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_swap_offers s
       WHERE s.buyer_id = v_uid AND s.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'trade_rate_limited' USING ERRCODE = '54000', HINT = 'You can offer 10 trades a day.';
  END IF;

  INSERT INTO public.declutter_swap_offers (item_id, offered_item_id, buyer_id, seller_id, respond_by, is_seed)
  VALUES (p_item_id, p_offered_item_id, v_uid, v_ok.o_seller_id, now() + interval '48 hours', coalesce(v_ok.o_seed, false))
  RETURNING id INTO v_id;
  -- CHANGED (#11): bell and email.
  PERFORM public.declutter_notify(v_ok.o_seller_id, 'declutter_offers', 'New trade offer',
    -- CHANGED 20261111201159 (F482): "No money changes hands." leads.
    format('No money changes hands. %s offered "%s" in trade for "%s". Accept or decline within 48 hours.',
           coalesce((SELECT public.member_display_name(p.full_name, 'A buyer') FROM public.profiles p WHERE p.user_id = v_uid), 'A buyer'),
           v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

-- 5. Bundle ask: no ID check.
CREATE OR REPLACE FUNCTION public.declutter_request_bundle(p_item_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_ids uuid[];
  v_item_id uuid;
  v_item record;
  v_seller uuid;
  v_id uuid;
  v_seed boolean := false;
  v_total integer := 0;
  v_buyer text; -- CHANGED 20261112004748: "Ann S.", the buyer as the seller's offer card shows them; NULL = no name.
BEGIN
  -- Q281 ban gate (lander 11-04): a banned account cannot ask for, or answer, a bundle (the same refusal as declutter_request_free).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(false);
  -- CHANGED (owner 2026-11-20): no first-purchase ID check at a bundle ask.
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x WHERE x IS NOT NULL;
  IF coalesce(cardinality(v_ids), 0) < 2 OR cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'bundle_size' USING ERRCODE = '22023', HINT = 'Pick 2 to 20 items from one seller.';
  END IF;

  -- Locked in id order, so two requests over the same items never deadlock.
  FOREACH v_item_id IN ARRAY v_ids LOOP
    SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_item_id, v_uid);
    IF v_seller IS NULL THEN
      v_seller := v_item.o_seller_id;
    ELSIF v_seller <> v_item.o_seller_id THEN
      RAISE EXCEPTION 'bundle_one_seller' USING ERRCODE = '22023', HINT = 'A bundle request is for one seller''s items.';
    END IF;
    IF v_item.o_price_cents IS NULL OR v_item.o_price_cents < 100 THEN
      RAISE EXCEPTION 'bundle_free_item' USING ERRCODE = '22023', HINT = 'Free items are claimed on their own.';
    END IF;
  END LOOP;

  -- A request past its 48 hours is closed here too, so an unswept one never blocks a new ask.
  UPDATE public.declutter_bundle_requests SET status = 'expired', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = v_seller AND status = 'open' AND respond_by <= now();
  IF EXISTS (SELECT 1 FROM public.declutter_bundle_requests r
              WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.status = 'open') THEN
    RAISE EXCEPTION 'bundle_already_open'
      USING ERRCODE = '55000', HINT = 'You already asked this seller. Wait for their answer or take it back.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_bundle_requests r
       WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'bundle_rate_limited' USING ERRCODE = '54000', HINT = 'You can ask one seller 3 times a day.';
  END IF;

  SELECT bool_or(i.is_seed), sum(i.current_price_cents) INTO v_seed, v_total
    FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  INSERT INTO public.declutter_bundle_requests (buyer_id, seller_id, respond_by, is_seed)
  VALUES (v_uid, v_seller, now() + interval '48 hours', coalesce(v_seed, false))
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_bundle_request_items (request_id, item_id, price_cents)
  SELECT v_id, i.id, i.current_price_cents FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  -- CHANGED 20261112004748 (owner 11-11): the seller's notice names the buyer, first name + last initial; the old words without a name.
  SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Bundle request',
    format('%s wants %s of your items ($%s in all). Accept all or pick some within 48 hours.',
           COALESCE(v_buyer, 'A buyer'), cardinality(v_ids), to_char(v_total / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$function$;

-- 6. Giver picks a free claimer: the asked time is booked for everyone (no ID first).
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
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT i.id, i.status, i.current_price_cents, i.title INTO v_item
    FROM public.declutter_items i WHERE i.id = v_req.item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Re-read under the item lock: a withdraw or a second pick may have landed first.
  SELECT * INTO v_req FROM public.declutter_free_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'That person took back their ask.';
  END IF;
  -- ── A3-57: an ask whose own pickup time has passed can't be picked (the sweep closes it and tells the asker). ──
  IF v_req.pickup_at IS NOT NULL AND v_req.pickup_at <= now() THEN
    RAISE EXCEPTION 'request_time_passed' USING ERRCODE = '55000',
      HINT = 'Their pickup time has passed. Pick someone else.';
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
     -- CHANGED (owner 2026-11-20): no ID check for a free claimer, so the asked time is booked for everyone.
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

-- 7. Free hold notice: nothing is charged, for everyone.
CREATE OR REPLACE FUNCTION public.declutter_free_hold_charge_words(p_buyer uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- CHANGED (owner 2026-11-20): a free item never has an ID check or a setup fee.
  SELECT 'Nothing is charged.'::text;
$fn$;

-- 8. Checkout: no $2 on a first purchase.
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL, p_quote_id uuid DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer,
               shipping_cents integer)
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
  v_shipping integer := 0;
  v_quote public.shipping_quotes%ROWTYPE;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship') THEN
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
  ELSIF p_handover = 'ship' THEN
    -- Shipping S3 (Q2259): new work for the seller, so both switches (row 62's rule); the buyer's quote is required.
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_shipping');
    IF p_quote_id IS NULL THEN
      RAISE EXCEPTION 'shipping_quote_needed' USING ERRCODE = '22023', HINT = 'Get a shipping price for your address first.';
    END IF;
    p_slot_start := NULL;
    p_handoff := NULL;
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

  IF p_handover <> 'ship' THEN
    p_quote_id := NULL;
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
         o.pickup_slot_start,
         o.shipping_cents, o.shipping_quote_id
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
  -- Shipping S3: an item ships only when its seller picked a parcel for it ("Ship it": declutter_items.ship_preset,
  -- small items only by its CHECK); the handovers ticks do not name 'ship'.
  IF p_handover = 'ship' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND i.ship_preset IS NULL) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t ship one of these items. Choose another way to get it.';
  END IF;
  IF p_handover <> 'ship' AND public.declutter_handover_refused(v_lines, p_handover) THEN
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

  -- Shipping S3: the price is the buyer's own stored quote (ship-rates), never a number from the client: for this
  -- buyer and seller, still fresh, and for exactly the lines this checkout groups (one parcel, decision 10). A quote
  -- for other lines (one added, one expired) is stale: the app asks ship-rates again.
  IF p_handover = 'ship' THEN
    SELECT q2.* INTO v_quote FROM public.shipping_quotes q2
     WHERE q2.id = p_quote_id AND q2.buyer_id = v_uid AND q2.seller_id = p_seller_id;
    IF v_quote.id IS NULL OR v_quote.expires_at <= now()
       OR ARRAY(SELECT x FROM unnest(v_quote.cart_item_ids) x ORDER BY x) IS DISTINCT FROM v_lines THEN
      RAISE EXCEPTION 'shipping_quote_stale' USING ERRCODE = '22023',
        HINT = 'That shipping price ran out. Get a new one for your address.';
    END IF;
    v_shipping := v_quote.rate_cents;
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

  -- CHANGED (owner 2026-11-20): a Declutter purchase never carries the one-time account setup fee (Q2352's
  -- first-purchase $2 is removed). setup_fee_cents stays on the order, always 0 from here.
  v_setup := 0;

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
          OR v_existing.pickup_slot_start IS NOT DISTINCT FROM p_slot_start)
     -- Shipping S3: and the same quote (a new price or address opens a new order).
     AND v_existing.shipping_quote_id IS NOT DISTINCT FROM p_quote_id
     AND v_existing.shipping_cents = v_shipping THEN
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
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents,
                        v_existing.shipping_cents;
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
                    -- Shipping S3 (decision 2): 5% of items + shipping + 70c, so the card fee is always covered.
                    WHEN p_handover = 'ship' THEN public.declutter_buyer_fee_cents_ship(v_items, v_shipping)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, bundle_discount_cents,
                                       shipping_cents, shipping_quote_id)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery + v_shipping,
          v_setup, v_bundle_off, v_shipping, p_quote_id)
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

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery + v_shipping, v_old_session, NULL::text,
                      v_delivery, v_shipping;
END;
$fn$;

-- 9. Seller payout: the $2 is never taken.
CREATE OR REPLACE FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- CHANGED (owner 2026-11-20): a Declutter seller's payout never loses the one-time setup fee. Kept (returning the
  -- payout's own amount) only so a declutter-money build deployed before this migration keeps sending the whole payout.
  RETURN p.amount_cents;
END;
$fn$;

-- 10. The seller's setup-fee read: always none.
CREATE OR REPLACE FUNCTION public.declutter_my_setup_fee()
RETURNS jsonb
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
  -- CHANGED (owner 2026-11-20): no Declutter setup fee, so the answer is always none. Kept for app builds that
  -- still read it.
  RETURN jsonb_build_object('fee_cents', 0, 'order_id', NULL);
END;
$fn$;

-- 11. Handover notice: no ID and no setup-fee words, no ID sheet link.
CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
  -- Manager mode phase 2: the manager's share of this sale (0 when none was locked at payment).
  v_share integer := 0;
  v_ms public.declutter_order_manager_shares;
  v_mpay uuid;
  v_split text := '';
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Our team decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    -- CHANGED (BUY-36): or the buyer collected it from a Helpr who couldn't finish (helpr_task_customer_confirm failed the task, unpaid).
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed')
          OR (v_task.status = 'failed' AND v_task.stuck_stage = 'collecting') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  -- A free claim (20261027170717): no money is owed either way, so no payout row and no payout words.
  IF o.paid_with = 'free' THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
      format('Thank you for giving away %s. It has a new home.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
      format('The handover of %s is done. Leave the giver a review.', public.declutter_order_items_named(o.id)),
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'handed_over', 'payout_id', NULL, 'by', p_by, 'free', true);
  END IF;
  -- Manager mode phase 2 (lead 11-01): the share comes off first (items + rate - share), then the fee debt and the
  -- setup fee from what is left, so the seller's row is never negative and a debt never reduces the manager's share.
  SELECT * INTO v_ms FROM public.declutter_order_manager_shares s WHERE s.order_id = o.id;
  v_share := public.declutter_manager_share_cents(o.id);
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate - v_share);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, manager_share_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_share, v_debt, o.items_cents + v_rate - v_share - v_debt,
          CASE WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The manager's own row: a SEPARATE transfer to their own payout account (declutter-money), never through the seller.
  IF v_payout IS NOT NULL AND v_ms.order_id IS NOT NULL AND v_ms.manager_id IS NOT NULL THEN
    INSERT INTO public.declutter_manager_payouts (order_id, seller_payout_id, grant_id, seller_id, manager_id, share_cents, amount_cents, status)
    VALUES (o.id, v_payout, v_ms.grant_id, o.seller_id, v_ms.manager_id, v_share, v_share,
            CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_mpay;
    IF v_mpay IS NOT NULL AND v_share > 0 THEN
      v_split := format('$%s sale · $%s to %s%s · $%s to you. ',
        to_char((o.items_cents + v_rate) / 100.0, 'FM999990.00'), to_char(v_share / 100.0, 'FM999990.00'),
        public.declutter_manager_first_name(v_ms.manager_id),
        CASE WHEN v_ms.share_type = 'percent' THEN ' (' || v_ms.share_pct::text || '%)' ELSE '' END,
        to_char((o.items_cents + v_rate - v_share) / 100.0, 'FM999990.00'));
      -- declutter_sales, by choice (declutterNoticeKinds): the manager's share is a sale notice, under the Declutter switch.
      PERFORM public.declutter_notify(v_ms.manager_id, 'declutter_sales', 'You earned a share',
        format('You earned $%s from %s''s sale of %s. ', to_char(v_share / 100.0, 'FM999990.00'),
               public.declutter_manager_first_name(o.seller_id), public.declutter_order_items_named(o.id)) ||
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_ms.manager_id AND pr.stripe_account_id IS NOT NULL) THEN
            'Next: set up payouts in Settings to get it. We send it as soon as you do and the sale is final.'
          WHEN p_by = 'admin' THEN 'It is on its way to your payout account.'
          ELSE 'We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.'
        END,
        '/declutter?tab=selling', o.seller_id);
    END IF;
  END IF;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) || v_split ||
    CASE
      WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      -- CHANGED (owner 2026-11-20): no ID check before a Declutter payout, so no "Verify your ID to get paid".
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
    END
    -- CHANGED (owner 2026-11-20): no setup fee out of the payout and no ID sheet link.
    ,
    '/declutter?tab=selling', o.buyer_id);
  -- 20261028232338: a caller that tells the buyer its own outcome (declutter_admin_decide_delivery_damage: refunded in full)
  -- names this order in declutter.no_enjoy_notice for its transaction, so the buyer never also reads "the sale is final".
  IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    format('The handover of %s is done', public.declutter_order_items_named(o.id)) ||
    CASE WHEN p_by = 'admin' THEN ' and the sale is final. Leave the seller a review.'
         ELSE '. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END
    || CASE WHEN public.declutter_delivery_tip_open(o.id) THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END,
    '/declutter?view=cart', o.seller_id);
  END IF;
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$function$;

-- 3 (cont.). The free claimer's fee-then-ID gate has no caller left.
DROP FUNCTION IF EXISTS public.declutter_free_claim_gate(uuid);

-- Grants, restated.
REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_offer_swap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_offer_swap(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_request_bundle(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_bundle(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_pick_free_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_pick_free_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_free_hold_charge_words(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_free_hold_charge_words(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_take_setup_fee(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_my_setup_fee() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_setup_fee() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

