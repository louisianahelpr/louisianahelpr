-- A free Declutter claim counts as a first purchase (owner 2026-10-30, ruled again that evening: asking for a free item is
-- free. "The first-timer pays $2 and verifies only once the seller picks them, on the same one-time screen. If they
-- don't complete it, the seller can pick someone else; nothing auto-cancels without telling both." Item stays free.)
--
-- BEHIND THE SWITCH `identity_check`, which stays OFF: landing this changes nothing for anyone.
--
-- With it on, for an ordinary member:
--   * declutter_request_free is NOT touched: asking asks for nothing.
--   * The giver picks them. declutter_checkout_free, where the address opens, runs declutter_free_claim_gate: first
--     setup_fee_required_to_claim until profiles.onboarding_fee_paid is true (the app opens the one short screen and
--     pays through pay-onboarding-fee, the existing page and its one-winner webhook write; nothing is charged here), then
--     identity_required_to_claim until the ID is verified (the app opens the ID sheet). Later claims pass: once ever.
--   * Not completed: declutter_deadline_sweep, UNCHANGED, already puts the item back up at 48 hours with no strike and
--     tells both people. declutter_seller_cancel_sale, UNCHANGED, lets the giver end it sooner, no strike, and tells them.
--   * New here: picking closed everyone else's ask, so with the item back up the giver had nobody to pick. The asks the
--     pick closed reopen, and the giver and those people are told. An asker who is out of Declutter, blocked, paused or
--     already at 3 free items is left closed. Reopened only while the switch is on for the giver.
-- The item stays free: the order's own amounts are untouched, still $0.
-- Admins and enrolled test accounts are never asked.
--
-- LEAD-B49-REBUILD (Builder 28, 10-31): B49's 20261031003100_free_claim_fee_then_id (wip/l36-1030-b49-on-train), rebuilt
-- on main. declutter_checkout_free is restated VERBATIM from its newest CREATE on origin/main,
-- 20261031164337_declutter_door_pickup_uses_places (free pickups at the seller's home use the place's address), plus
-- the two gate lines B49 added after the seller-out / blocked check; nothing else in its body changed (diffed against
-- B49's copy, whose base 20261030164712 differs from 20261031164337 by one line: p_handover IN ('porch','pickup_home')).
-- declutter_free_claim_gate and declutter_free_asks_reopen_on_back_up (+ its trigger) are B49's, verbatim; every
-- function they call is on main (declutter_setup_fee_due_cents 20261026154738, is_identity_verified 20261019051407,
-- identity_check_exempt 20261023213857, is_server_context 20260915101102, has_role 20261012184600).
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, grants restated.
-- Proof: src/test/pglite/freeClaimFeeThenId.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red; MUTANT=nopickuphome red).

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
  -- Owner 2026-10-30: a first-timer the giver picked pays the one-time fee, then verifies, before the address opens.
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

-- A picked person did not complete it and the item is back up: the giver can pick someone else who asked.
CREATE OR REPLACE FUNCTION public.declutter_free_asks_reopen_on_back_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_reopened integer := 0;
  v_limit integer := (public.declutter_free_rules() ->> 'max_open_claims')::integer;
BEGIN
  IF NOT public.feature_enabled_for_user('identity_check', NEW.seller_id) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT q.id, q.requester_id
      FROM public.declutter_free_requests q
     WHERE q.item_id = NEW.id AND q.status = 'not_picked'
       AND NOT public.declutter_member_out(q.requester_id)
       AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                        WHERE (b.blocker_id = NEW.seller_id AND b.blocked_id = q.requester_id)
                           OR (b.blocker_id = q.requester_id AND b.blocked_id = NEW.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_pauses p
                        WHERE p.user_id = q.requester_id AND p.free_blocked_until > now())
       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_requests o
                        WHERE o.item_id = NEW.id AND o.requester_id = q.requester_id AND o.status = 'open')
     ORDER BY q.created_at
  LOOP
    -- The same 3 the ask itself counts.
    IF (SELECT count(*) FROM public.declutter_free_requests o WHERE o.requester_id = r.requester_id AND o.status = 'open')
       + (SELECT count(*) FROM public.declutter_cart_items c
           WHERE c.buyer_id = r.requester_id AND c.price_cents = 0 AND c.status = 'in_cart' AND c.checkout_by > now())
       + (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.buyer_id = r.requester_id AND c.status = 'paid' AND o.status = 'paid' AND o.paid_with = 'free') >= v_limit THEN
      CONTINUE;
    END IF;
    UPDATE public.declutter_free_requests SET status = 'open', closed_at = NULL WHERE id = r.id;
    v_reopened := v_reopened + 1;
    PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'Free item is open again',
      format('"%s" is free again and your ask still stands. The giver can pick you now.', NEW.title),
      '/declutter/item/' || NEW.id::text, NEW.seller_id);
  END LOOP;
  IF v_reopened > 0 THEN
    PERFORM public.declutter_notify(NEW.seller_id, 'declutter_offers', 'Pick someone else',
      format('Others still want "%s". Open it to pick someone else.', NEW.title),
      '/declutter/item/' || NEW.id::text);
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_asks_reopen_on_back_up() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_free_asks_reopen_on_back_up ON public.declutter_items;
CREATE TRIGGER declutter_free_asks_reopen_on_back_up
  AFTER UPDATE OF status ON public.declutter_items
  FOR EACH ROW
  WHEN (OLD.status = 'reserved' AND NEW.status = 'live' AND NEW.current_price_cents = 0)
  EXECUTE FUNCTION public.declutter_free_asks_reopen_on_back_up();
