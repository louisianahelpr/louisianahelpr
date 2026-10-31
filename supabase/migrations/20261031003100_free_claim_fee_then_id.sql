-- A free Declutter claim counts as a first purchase (owner 2026-10-30: "Free claim fee: claimer pays $2 first, then
-- verifies, once ever. First-timers must be told plainly why it's required, once and never again. Item stays free.").
--
-- BEHIND THE SWITCH `identity_check`, which stays OFF: identity_check_exempt() is TRUE while it is off, so landing this
-- changes nothing for anyone.
--
-- With it on, for an ordinary member, the order is the owner's: the fee, then the ID.
--   1. declutter_free_claim_gate refuses with setup_fee_required_to_claim until profiles.onboarding_fee_paid is true.
--      The app opens the one short screen, and pays through pay-onboarding-fee: the existing page, whose payment the
--      stripe-webhook claims with the one-winner write every other path uses. Nothing is charged here.
--   2. It then refuses with identity_required_to_claim until the ID is verified. The app opens the ID sheet.
--   3. Later claims and purchases pass: once ever, for the fee and the check alike.
-- The item stays free: the order's own amounts are untouched, still $0.
--
-- Asked at both doors. declutter_request_free (and declutter_claim_free, which calls it) is the claim. The giver only ever
-- picks someone who asked; declutter_checkout_free, where the address opens, catches a member who asked BEFORE the check
-- went on. Admins and enrolled test accounts are never asked.
--
-- Restated from their newest definitions, each matching prod's md5 of whitespace-normalised prosrc on 2026-10-30:
--   declutter_request_free  80d627c26d0405a67da70c964477d87e (20261030064021)
--   declutter_checkout_free 755c1521757fad4f7c44457ea5c4407a (20261030164712)
-- Replay-safe: CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/freeClaimFeeThenId.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_free_claim_gate(p_member uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.is_server_context() OR auth.uid() IS NULL OR p_member IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;
  IF public.has_role(p_member, 'admin') OR public.identity_check_exempt(p_member) THEN
    RETURN;
  END IF;
  IF public.declutter_setup_fee_due_cents(p_member) > 0 THEN
    RAISE EXCEPTION 'setup_fee_required_to_claim' USING ERRCODE = '42501',
      HINT = 'Your first free item needs the one-time ID check. Pay it once, then verify. The item stays free.';
  END IF;
  IF NOT public.is_identity_verified(p_member) THEN
    RAISE EXCEPTION 'identity_required_to_claim' USING ERRCODE = '42501',
      HINT = 'Verify your ID with Stripe before your first free item. It takes about 2 minutes, once.';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_claim_gate(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_request_free(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_price integer;
  v_status text;
  v_mode text;
  v_seed boolean;
  v_title text;
  v_open integer;
  v_until timestamptz;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT i.seller_id, i.current_price_cents, i.status, i.sale_mode, i.is_seed, i.title
    INTO v_seller, v_price, v_status, v_mode, v_seed, v_title
    FROM public.declutter_items i WHERE i.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(v_seller, v_uid)
     OR public.declutter_seller_out(v_seller)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_price <> 0 THEN
    RAISE EXCEPTION 'not_free' USING ERRCODE = '22023', HINT = 'This item is not free any more. Check its price.';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  -- The 30-day pause after a missed free pickup (owner 2026-10-29).
  SELECT p.free_blocked_until INTO v_until FROM public.declutter_free_pauses p
   WHERE p.user_id = v_uid AND p.free_blocked_until > now();
  IF FOUND THEN
    RAISE EXCEPTION 'free_paused' USING ERRCODE = '42501',
      HINT = format('You can ask for free items again on %s.',
                    to_char(v_until AT TIME ZONE 'America/Chicago', 'FMMonth FMDD'));
  END IF;
  -- Owner 2026-10-30: a first claim pays the one-time fee first, then verifies. Off while identity_check is off.
  PERFORM public.declutter_free_claim_gate(v_uid);
  -- Serialised per member: the same advisory lock the old claim used.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_free_claims:' || v_uid::text, 0));
  SELECT r.id INTO v_id FROM public.declutter_free_requests r
   WHERE r.item_id = p_item_id AND r.requester_id = v_uid AND r.status = 'open';
  IF FOUND THEN
    RETURN v_id;
  END IF;
  -- At most 3 at a time: open asks + free lines still waiting for a pickup choice + free pickups not done yet.
  SELECT (SELECT count(*) FROM public.declutter_free_requests r WHERE r.requester_id = v_uid AND r.status = 'open')
       + (SELECT count(*) FROM public.declutter_cart_items c
           WHERE c.buyer_id = v_uid AND c.price_cents = 0 AND c.status = 'in_cart' AND c.checkout_by > now())
       + (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.buyer_id = v_uid AND c.status = 'paid' AND o.status = 'paid' AND o.paid_with = 'free')
    INTO v_open;
  IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN
    RAISE EXCEPTION 'free_claim_limit' USING ERRCODE = '54000',
      HINT = 'You have 3 free items asked for or waiting. Pick those up or take back an ask first.';
  END IF;
  INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id)
  VALUES (p_item_id, v_uid, v_seller)
  RETURNING id INTO v_id;
  -- Named, never "Someone" (owner 2026-10-21): the giver sees who asked on the item page anyway.
  PERFORM public.declutter_notify(v_seller, 'declutter_offers', 'New request for your free item',
    format('%s asked for "%s". Open it to see who asked and pick who gets it.',
           COALESCE((SELECT public.member_display_name(p.full_name, 'A neighbor') FROM public.profiles p WHERE p.id = v_uid), 'A neighbor'), v_title),
    '/declutter/item/' || p_item_id::text, v_uid);
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_request_free(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_free(uuid) TO authenticated, service_role;

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
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Owner 2026-10-30: a member who asked before the check went on is asked here, before the address opens.
  PERFORM public.declutter_free_claim_gate(v_uid);
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
  IF p_handover = 'porch'
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
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?tab=selling', v_uid);
  RETURN v_order;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;
