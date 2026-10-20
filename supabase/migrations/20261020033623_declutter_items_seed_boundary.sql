-- Declutter seed boundary (Cowork design audit 2026-10-20, item D1).
--
-- Measured on prod 2026-10-20 03:40Z: every 'live' declutter_items row (5) and
-- every 'pending_review' one (4) belongs to a test account ("Fixture rocking
-- chair [E2E-PRODAUDIT]", "Payout proof lamp"), all is_seed = true, and the
-- owner (an admin, not a test account) saw them on Browse. The items read
-- policy asked the 'declutter' switch and the banned-seller rule but never the
-- launch switch that hides test rows from discovery everywhere else
-- (open_jobs_browse: `NOT is_seed OR NOT seed_hidden_in_discovery()`).
--
-- Every Declutter read path a buyer has is this one table under RLS: Browse
-- (fetchLiveItems), the item page (fetchItem), "More from this seller"
-- (fetchSellerItems), "Similar items" (fetchSimilarItems), the moving-sale
-- page, the search box (it filters the Browse rows client-side), and the
-- photos (their policy is EXISTS over this table, so it inherits). One clause
-- here covers all of them.
--
-- Kept: the seller always reads their own listings (first branch); a test
-- account still sees test listings (seed_hidden_in_discovery's carve-out, so
-- the nightly two-account journeys keep working); with the launch switch off
-- nothing changes. Admins are NOT carved out, same as jobs discovery: the
-- owner browses as an admin and must see what the public sees. The admin
-- review queue reads through declutter_admin_pending_items (SECURITY DEFINER),
-- not this policy, so it is unaffected.
--
-- The same boundary on the WRITE side (sections 2-4 below, from the
-- lh-money-escrow and lh-authz-rls reviews): Buy now / Make an offer (the
-- lock), a seller accepting an offer (declutter_take_item), asking a question
-- and watching all refuse a test item the person they act for may not see.
--
-- Replay-safe: DROP POLICY IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION. Guard:
-- src/test/declutterSeedBoundary.test.ts. PGlite proof:
-- src/test/pglite/declutterSeedBoundary.pglite.mjs (applied 3x).

DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT public.declutter_seller_hidden(seller_id)
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
  );

-- ---------------------------------------------------------------------------
-- 2. The WRITE side of the same boundary (lh-money-escrow review of this
-- migration, 2026-10-20): Buy now and Make an offer lock the item through
-- declutter_lock_buyable_item (SECURITY DEFINER, so the policy above never
-- applies), which did not ask is_seed. A real member holding a test item's id
-- (an old link, a notification) could reserve it and pay real money on Stripe
-- live for a fixture. Hidden from you = not found for you, the same refusal a
-- hidden (banned) seller's item gets. Restated from the live definition
-- (pg_get_functiondef, 2026-10-20) with the one added condition. It asks
-- seed_hidden_for(p_buyer), the buyer this lock is for (lh-authz-rls review:
-- not auth.uid(), which only happens to equal p_buyer in today's two callers,
-- declutter_buy_now and declutter_make_offer).
CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_mode text;
  v_seed boolean;
BEGIN
  SELECT i.seller_id, i.current_price_cents, i.title, i.status, i.sale_mode, i.is_seed
    INTO o_seller_id, o_price_cents, o_title, v_status, v_mode, v_seed
    FROM public.declutter_items i
   WHERE i.id = p_item_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(o_seller_id, p_buyer)
     OR public.declutter_seller_out(o_seller_id)
     OR (v_seed AND public.seed_hidden_for(p_buyer)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o_seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = p_buyer) THEN
    RAISE EXCEPTION 'card_required'
      USING ERRCODE = '42501', HINT = 'Save a card first. It is never charged until you check out.';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The other door into a cart (lh-authz-rls review, 2026-10-20): a seller
-- ACCEPTING an offer goes declutter_respond_offer -> declutter_take_item, which
-- never passes through the lock above. Measured live: an open offer from a
-- real member on a test seller's fixture; a test-account accept would have put
-- it in her cart for a real Stripe live checkout. The caller there is the
-- (test) seller, so the check asks about the BUYER: seed_hidden_for(p_buyer).
-- Restated from the live definition (2026-10-20) with the one added check,
-- before the item is reserved.
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
  v_price text := to_char(p_price / 100.0, 'FM999990.00');
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

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item no longer available',
      format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + interval '48 hours')
  RETURNING id INTO v_line;

  PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: check out within 48 hours',
    format('"%s" is in your cart for $%s. Check out within 48 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price),
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for $%s. The buyer has 48 hours to check out and pay.', v_title, v_price),
    '/declutter?view=offers', p_buyer);
  RETURN v_line;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Ask a question / watch (lh-authz-rls review, 2026-10-20): both SECURITY
-- DEFINER, granted to members, found the item by status only, so a real member
-- holding a test item's id could confirm it exists and attach a question or a
-- watch to it. Hidden from you = not found for you. Restated from the live
-- definitions (2026-10-20), one condition each; grants restated as live.
CREATE OR REPLACE FUNCTION public.declutter_ask_question(p_item_id uuid, p_question text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_seed boolean;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  SELECT seller_id, is_seed INTO v_seller, v_seed FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it; nor does a real member a test listing.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  -- One asker at a time, so parallel calls cannot all pass the cap.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_ask:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_questions q
       WHERE q.asker_id = v_uid AND q.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'question_rate_limited' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.declutter_questions (item_id, asker_id, question)
  VALUES (p_item_id, v_uid, btrim(p_question))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_ask_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_question(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_watch(p_item_id uuid, p_watch boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_seed boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  IF p_watch IS NOT TRUE THEN
    DELETE FROM public.declutter_watchlist WHERE user_id = v_uid AND item_id = p_item_id;
    RETURN 'not_watching';
  END IF;
  SELECT seller_id, is_seed INTO v_seller, v_seed FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it; nor does a real member a test listing.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_watchlist (user_id, item_id) VALUES (v_uid, p_item_id)
  ON CONFLICT (user_id, item_id) DO NOTHING;
  RETURN 'watching';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_set_watch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_watch(uuid, boolean) TO authenticated, service_role;
