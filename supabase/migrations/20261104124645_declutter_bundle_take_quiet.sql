-- Q2731 (from the Q2268 money review, lh-money-escrow@6572b840ab#1, lead 11-04): an accepted bundle sent the buyer and
-- the seller one "Reserved for you" / "Sold" notice PER ITEM on top of the bundle notice.
-- declutter_take_item is restated from its newest definition
-- (20261103222939_q2390_helpr_answer_take_item_report_problem_answer_no_show_fault_report_copy_not_found_is_404.sql),
-- whose body md5 a77f6b2b4a44805faaa6d77744dda26a (5224 chars) equals prod's pg_proc.prosrc md5 (read 2026-11-04
-- 6:50 AM CT), VERBATIM except that its closing notice block (free claim / Buy now / offer) is wrapped, re-indented,
-- in IF current_setting('declutter.bundle_take') <> 'on'. declutter_answer_bundle (20261104103528) sets that setting
-- transaction-locally around its loop and sends one notice to each side itself. Every other caller is unchanged (the
-- setting is unset). Money: nothing about the hold, the price, the line or the voided offers changes. Grants as before.
--
-- declutter_answer_bundle is restated from 20261104103528 (its only definition; not yet on prod) with three changes:
--   1. set_config('declutter.bundle_take', 'on', true) around its take loop, and ONE seller notice for the bundle
--      ('Bundle sold: waiting for the buyer to pay', typed declutter_sales) beside the buyer's one;
--   2. "Save a card to get your bundle" goes to the buyer at most once per request: declutter_bundle_requests gains
--      card_asked_at (a timestamp, not a person), stamped on the first no-card answer;
--   3. nothing else (grants as there).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE. PROOF: src/test/pglite/declutterBundleTakeQuiet.pglite.mjs.

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

  -- Q2731 (Q2268 money review 11-04): a bundle answer (declutter_answer_bundle) sends ONE notice to each side for the
  -- whole bundle, so these per-item "reserved" / "sold" notices are skipped while it takes its items (the
  -- transaction-local setting declutter.bundle_take, which only that function sets). The voided-offer notices above
  -- still go to every other buyer.
  IF coalesce(current_setting('declutter.bundle_take', true), '') <> 'on' THEN
    IF p_price = 0 THEN
      -- A free claim (20261027170717): the same 48 hours, nothing to pay.
      -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
        format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. Nothing is charged.',
               v_title),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
        format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
        '/declutter?view=selling', p_buyer);
    ELSIF p_source = 'buy' THEN
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 30 minutes',
        format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
               v_title, v_price),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
        format('"%s" sold for %s. The buyer has 30 minutes to check out and pay.', v_title, v_price),
        '/declutter?view=selling', p_buyer);
    ELSE
    -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
    -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 24 hours',
      CASE WHEN p_offer_id IS NOT NULL THEN
        format('%s accepted your %s offer for "%s". Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay, or it goes back up for sale and you get a strike. Your card is not charged until you check out.',
               COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller'),
               v_price, v_title)
      ELSE
      format('"%s" is in your cart for %s. Check out within 24 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
             v_title, v_price) END,
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
      format('"%s" sold for %s. The buyer has 24 hours to check out and pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
    END IF;
  END IF;
  RETURN v_line;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

ALTER TABLE public.declutter_bundle_requests ADD COLUMN IF NOT EXISTS card_asked_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_answer_bundle(p_request_id uuid, p_accept_item_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req record;
  v_all boolean := p_accept_item_ids IS NULL;
  v_row record;
  v_item record;
  v_line uuid;
  v_accepted integer := 0;
  v_gone integer := 0;
BEGIN
  -- Q281 ban gate (lander 11-04): a banned account cannot ask for, or answer, a bundle (the same refusal as declutter_request_free).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_req FROM public.declutter_bundle_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.seller_id <> v_uid THEN
    RAISE EXCEPTION 'bundle_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.status <> 'open' OR v_req.respond_by <= now() THEN
    RAISE EXCEPTION 'bundle_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  IF NOT v_all AND EXISTS (SELECT 1 FROM unnest(p_accept_item_ids) x
                            WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_bundle_request_items bi
                                                             WHERE bi.request_id = p_request_id AND bi.item_id = x)) THEN
    RAISE EXCEPTION 'bundle_item_not_in_request' USING ERRCODE = '22023';
  END IF;

  IF NOT v_all AND cardinality(p_accept_item_ids) = 0 THEN
    UPDATE public.declutter_bundle_requests SET status = 'declined', closed_at = now() WHERE id = p_request_id;
    UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked' WHERE request_id = p_request_id;
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request declined',
      'The seller said no to your bundle request this time. Nothing was charged.', '/declutter?tab=buying', v_uid);
    RETURN 0;
  END IF;

  IF public.member_under_18(v_req.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- Review 11-04: the buyer's saved card once, before anything is held. A buyer who removed it is asked to save one,
  -- and the request stays open so the seller can answer again: nothing held, nothing charged. -1 tells the seller.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = v_req.buyer_id) THEN
    -- Q2731: asked at most once per request (card_asked_at), however often the seller taps.
    UPDATE public.declutter_bundle_requests SET card_asked_at = now() WHERE id = p_request_id AND card_asked_at IS NULL;
    IF FOUND THEN
      PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Save a card to get your bundle',
        'The seller wants to accept your bundle request. Save a card in Declutter so they can; it is charged only when you check out.',
        '/declutter?tab=buying', v_uid);
    END IF;
    RETURN -1;
  END IF;

  -- Q2731: one notice to each side for the whole bundle: declutter_take_item (20261104124645) skips its per-item
  -- ones while this is 'on'. Transaction-local; turned off again after the loop.
  PERFORM set_config('declutter.bundle_take', 'on', true);
  FOR v_row IN
    SELECT bi.item_id, bi.price_cents FROM public.declutter_bundle_request_items bi
     WHERE bi.request_id = p_request_id ORDER BY bi.item_id
  LOOP
    IF NOT v_all AND NOT (v_row.item_id = ANY (p_accept_item_ids)) THEN
      UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      CONTINUE;
    END IF;
    BEGIN
      -- The buyer's checks again (card, blocks, seed rules, still live), as the buyer.
      SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_row.item_id, v_req.buyer_id);
      -- Review 11-04: a price under $1 today (made free meanwhile) is never taken through the bundle.
      IF v_item.o_seller_id <> v_uid OR least(v_row.price_cents, v_item.o_price_cents) < 100 THEN
        RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000';
      END IF;
      v_line := public.declutter_take_item(v_row.item_id, v_req.buyer_id, least(v_row.price_cents, v_item.o_price_cents),
                                           'offer', NULL);
      UPDATE public.declutter_bundle_request_items SET outcome = 'accepted', line_id = v_line
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_accepted := v_accepted + 1;
    EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'PT404' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
      -- Sold, held for someone else, hidden, blocked, or no longer an offers-mode sale (22023, review 11-04)
      -- meanwhile: never charged; the rest of the bundle goes on.
      UPDATE public.declutter_bundle_request_items SET outcome = 'unavailable'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_gone := v_gone + 1;
    END;
  END LOOP;
  PERFORM set_config('declutter.bundle_take', 'off', true);

  UPDATE public.declutter_bundle_requests
     SET status = CASE WHEN v_accepted > 0 THEN 'answered' ELSE 'declined' END, closed_at = now()
   WHERE id = p_request_id;
  PERFORM public.declutter_notice_ref(p_request_id); -- Q2659
  IF v_accepted > 0 THEN
    PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Bundle accepted: pay within 24 hours',
      format('The seller accepted %s of your items%s. They are in your cart; pay within 24 hours or they go back on sale.',
             v_accepted, CASE WHEN v_gone > 0 THEN format(' (%s sold meanwhile)', v_gone) ELSE '' END),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notice_ref(p_request_id); -- Q2659
    PERFORM public.declutter_notify(v_uid, 'declutter_sales', 'Bundle sold: waiting for the buyer to pay',
      format('You accepted %s of the items. The buyer has 24 hours to check out and pay.', v_accepted),
      '/declutter?tab=selling', v_req.buyer_id);
  ELSE
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request closed',
      'The items you asked for are no longer available. Nothing was charged.', '/declutter?tab=buying', v_uid);
  END IF;
  RETURN v_accepted;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_answer_bundle(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_bundle(uuid, uuid[]) TO authenticated, service_role;
