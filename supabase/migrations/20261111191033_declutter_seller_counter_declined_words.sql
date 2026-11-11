-- Whole-app audit 11-10 F359m, WORDING ONLY: when the buyer says no to the seller's counter, the seller's notice read
-- "Your offer on ... was declined. Nothing was charged." The seller made no offer and is never charged. The seller now
-- reads "The buyer said no to your $X price on "<title>". Your listing is still up." (the last sentence only while
-- the item is live). The buyer's wording, the title, the type, the link and every status change are unchanged.
-- Body: the newest repo definition (20261110202142_notice_titles_by_outcome_plain_words.sql) with only that string
-- changed. Replay-safe: CREATE OR REPLACE keeps the function's grants.

CREATE OR REPLACE FUNCTION public.declutter_respond_offer(p_offer_id uuid, p_action text, p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item_id uuid;
  v_side text;
  o record;
  v_item record;
  v_other uuid;
  v_rules record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- Learn the item, then lock ITEM before the thread (lock order item ->
  -- offer): two answers on one item serialize on the item row.
  SELECT f.item_id INTO v_item_id FROM public.declutter_offers f
   WHERE f.id = p_offer_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT i.id, i.status, i.title, i.current_price_cents, i.accepts_offers INTO v_item
    FROM public.declutter_items i WHERE i.id = v_item_id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_offers f WHERE f.id = p_offer_id FOR UPDATE;
  IF o.status <> 'open' THEN
    RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000', HINT = 'This offer is already closed.';
  END IF;
  v_side := CASE WHEN o.buyer_id = v_uid THEN 'buyer' ELSE 'seller' END;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;

  IF p_action = 'withdraw' THEN
    IF v_side <> 'buyer' THEN
      RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;
    UPDATE public.declutter_offers SET status = 'withdrawn', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, 'buyer', 'withdraw');
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer withdrawn',
      format('The buyer took back their offer on "%s".', v_item.title), '/declutter?tab=selling', o.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF o.awaiting <> v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000', HINT = 'Waiting for the other side to answer.';
  END IF;
  IF o.respond_by <= now() THEN
    RAISE EXCEPTION 'offer_expired' USING ERRCODE = '55000', HINT = 'This offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_offers SET status = 'declined', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, v_side, 'decline');
    -- One wording for every decline (B26): never says why. F359m (audit 11-10): when the buyer says no to the
    -- seller's price, the seller made no offer and nothing could be charged to them, so their words say what happened.
    PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',
      CASE WHEN v_side = 'buyer'
        THEN format('The buyer said no to your $%s price on "%s".%s', to_char(o.amount_cents / 100.0, 'FM999990.00'),
               v_item.title, CASE WHEN v_item.status = 'live' THEN ' Your listing is still up.' ELSE '' END)
        ELSE format('Your offer on "%s" was declined. Nothing was charged.', v_item.title) END,
      CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?tab=selling' END, v_uid);
    RETURN 'declined';
  END IF;

  -- accept / counter: the item must still be for sale, both sides still in.
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer for sale.';
  END IF;
  IF public.declutter_seller_out(o.seller_id) OR public.are_users_blocked(o.seller_id, o.buyer_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF public.declutter_member_out(v_other) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'counter' THEN
    -- Smart offers (owner 2026-10-29): with offers off the seller takes Buy only; a buyer's counter is refused,
    -- open threads stay and the seller may still answer them.
    IF v_side = 'buyer' AND NOT v_item.accepts_offers THEN
      RAISE EXCEPTION 'offers_off' USING ERRCODE = '55000', HINT = 'This seller is not taking offers. You can still buy it.';
    END IF;
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > v_item.current_price_cents THEN
      RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023';
    END IF;
    IF v_side = 'buyer' AND p_amount_cents * 2 < v_item.current_price_cents THEN
      RAISE EXCEPTION 'offer_too_low' USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
    END IF;
    IF p_amount_cents = o.amount_cents THEN
      RAISE EXCEPTION 'counter_same_amount' USING ERRCODE = '22023', HINT = 'To agree to this amount, accept it.';
    END IF;
    -- Smart offers: the seller's automatic answer. A buyer's counter at or above the seller's lowest price, with
    -- auto on and that price below today's, is accepted at once below, exactly as the seller tapping Accept.
    IF v_side = 'buyer' THEN
      SELECT p.auto_offers, p.floor_price_cents INTO v_rules FROM public.declutter_item_private p WHERE p.item_id = o.item_id;
      IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.current_price_cents
         AND p_amount_cents >= v_rules.floor_price_cents THEN
        UPDATE public.declutter_offers SET amount_cents = p_amount_cents, updated_at = now()
         WHERE id = p_offer_id AND status = 'open';
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
        VALUES (p_offer_id, 'buyer', 'counter', p_amount_cents);
        o.amount_cents := p_amount_cents;
        v_side := 'seller';
        p_action := 'accept';
      END IF;
    END IF;
  END IF;

  IF p_action = 'counter' THEN
    UPDATE public.declutter_offers
       SET amount_cents = p_amount_cents,
           awaiting = CASE WHEN v_side = 'buyer' THEN 'seller' ELSE 'buyer' END,
           respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1,
           updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (p_offer_id, v_side, 'counter', p_amount_cents);
    PERFORM public.declutter_notice_ref(p_offer_id); -- Q2659
    PERFORM public.declutter_notify(v_other, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
    RETURN 'countered';
  END IF;

  -- accept. The buyer pays, so the buyer needs a card on file and to be 18+
  -- (row 53) even when it is the seller who accepts.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = o.buyer_id) THEN
    RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
      HINT = 'The buyer needs a saved card. It is never charged until checkout.';
  END IF;
  IF public.member_under_18(o.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- B28: an agreed amount above today's price (the price dropped since the
  -- counter) is charged at today's price: accepting never costs more than Buy.
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (p_offer_id, v_side, 'accept', least(o.amount_cents, v_item.current_price_cents));
  PERFORM public.declutter_take_item(o.item_id, o.buyer_id, least(o.amount_cents, v_item.current_price_cents), 'offer', p_offer_id);
  IF v_side = 'seller' AND v_uid = o.buyer_id THEN
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer accepted automatically',
      format('Accepted automatically at or above your lowest price: $%s for "%s".',
             to_char(least(o.amount_cents, v_item.current_price_cents) / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  RETURN 'accepted';
END;
$fn$;
