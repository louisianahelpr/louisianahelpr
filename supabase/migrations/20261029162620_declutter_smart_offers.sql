-- Smart offers and "No offers" (owner 2026-10-29; design approved by the lead). Builder 28, item 2 (a)+(b).
--
--   (a) declutter_items.accepts_offers boolean NOT NULL DEFAULT true (public: the item page hides Make an offer).
--       Off = Buy only: declutter_make_offer and a BUYER's counter (declutter_respond_offer) refuse 'offers_off';
--       open threads stay, and the seller may still answer them.
--   (b) declutter_item_private.auto_offers boolean NOT NULL DEFAULT false (the seller's own row). The threshold is
--       the existing floor_price_cents ("lowest you'll take"). Only when auto_offers is on AND the floor is below
--       today's price: an offer (or a buyer's counter) at or above the floor is accepted at once through the same
--       steps as the seller tapping Accept (card on file, 18+, the accept event, declutter_take_item and its
--       notices, plus "Accepted automatically at or above your lowest price"), charged least(amount, price), never
--       above today's price; a new offer below the floor gets a seller counter AT THE FLOOR (48 h, counter_count + 1,
--       actor_side 'seller').
--   declutter_set_offer_rules(item, accepts_offers, auto_offers): the seller's own live or paused item.
--   (Reading auto_offers back for the seller's screen is not in this slice: see the branch report.)
--
-- Bodies restated from their NEWEST definitions (20261028223036_declutter_notice_links_open_the_right_tab):
-- declutter_respond_offer, declutter_make_offer. Only the lines marked "Smart offers" change.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE with unchanged signatures, grants restated by role name.
-- Proof: PGlite, applied 3x (pending, see the branch report).

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS accepts_offers boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.declutter_items.accepts_offers IS
  'Smart offers (2026-10-29): false = Buy only; declutter_make_offer and buyer counters refuse offers_off.';
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS auto_offers boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.declutter_item_private.auto_offers IS
  'Smart offers (2026-10-29): accept offers at or above floor_price_cents at once; counter lower ones at the floor.';

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
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
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
    -- One wording for every decline (B26): never says why.
    PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',
      format('Your offer on "%s" was declined. Nothing was charged.', v_item.title),
      CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?tab=selling' END, v_uid);
    RETURN 'declined';
  END IF;

  -- accept / counter: the item must still be for sale, both sides still in.
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer for sale.';
  END IF;
  IF public.declutter_seller_out(o.seller_id) OR public.are_users_blocked(o.seller_id, o.buyer_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
    PERFORM public.declutter_notify(v_other, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
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
REVOKE ALL ON FUNCTION public.declutter_respond_offer(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_offer(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_make_offer(p_item_id uuid, p_amount_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_id uuid;
  v_rules record;
  v_charge integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid);
  -- Smart offers (owner 2026-10-29): offers off = Buy only.
  -- IS NOT TRUE, not NOT (...): a NULL accepts_offers must refuse, never skip the RAISE.
  IF (SELECT i.accepts_offers FROM public.declutter_items i WHERE i.id = p_item_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'offers_off' USING ERRCODE = '55000', HINT = 'This seller is not taking offers. You can still buy it.';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents >= v_item.o_price_cents THEN
    RAISE EXCEPTION 'invalid_offer_amount'
      USING ERRCODE = '22023', HINT = 'Offer less than the price. To pay the price, use Buy.';
  END IF;
  IF p_amount_cents * 2 < v_item.o_price_cents THEN
    RAISE EXCEPTION 'offer_too_low'
      USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o
              WHERE o.item_id = p_item_id AND o.buyer_id = v_uid AND o.status = 'open') THEN
    RAISE EXCEPTION 'offer_already_open'
      USING ERRCODE = '55000', HINT = 'You already have an offer on this item. Change it from your offers.';
  END IF;
  -- B27: at most 3 threads per buyer per item per 24 h.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.item_id = p_item_id AND o.buyer_id = v_uid
         AND o.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'offer_rate_limited'
      USING ERRCODE = '54000', HINT = 'You can make 3 offers a day on one item.';
  END IF;

  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  VALUES (p_item_id, v_uid, v_item.o_seller_id, p_amount_cents, 'seller', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'buyer', 'offer', p_amount_cents);

  -- Smart offers: the seller's automatic answer, only with auto on and the lowest price below today's price
  -- (the item row is locked by declutter_lock_buyable_item).
  SELECT p.auto_offers, p.floor_price_cents INTO v_rules FROM public.declutter_item_private p WHERE p.item_id = p_item_id;
  IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.o_price_cents THEN
    IF p_amount_cents >= v_rules.floor_price_cents THEN
      -- At or above the lowest price: accepted at once, exactly as the seller tapping Accept (declutter_respond_offer):
      -- the buyer's card and 18+ (the lock checked the card, strikes and blocks), the accept event, declutter_take_item
      -- with its notices, charged least(amount, price): never above today's price.
      IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = v_uid) THEN
        RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
          HINT = 'The buyer needs a saved card. It is never charged until checkout.';
      END IF;
      IF public.member_under_18(v_uid) THEN
        RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
      END IF;
      v_charge := least(p_amount_cents, v_item.o_price_cents);
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
      VALUES (v_id, 'seller', 'accept', v_charge);
      PERFORM public.declutter_take_item(p_item_id, v_uid, v_charge, 'offer', v_id);
      PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'Offer accepted automatically',
        format('Accepted automatically at or above your lowest price: $%s for "%s".',
               to_char(v_charge / 100.0, 'FM999990.00'), v_item.o_title),
        '/declutter?tab=selling', v_uid);
      RETURN v_id;
    END IF;
    -- Below it: the seller counters at the lowest price (48 hours, as a seller's counter).
    UPDATE public.declutter_offers
       SET amount_cents = v_rules.floor_price_cents, awaiting = 'buyer', respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1, updated_at = now()
     WHERE id = v_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (v_id, 'seller', 'counter', v_rules.floor_price_cents);
    PERFORM public.declutter_notify(v_uid, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
             to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00'), v_item.o_title),
      '/declutter?tab=buying', v_item.o_seller_id);
    PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'Offer answered automatically',
      format('You got a $%s offer on "%s" and answered it automatically with your lowest price, $%s.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title,
             to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00')),
      '/declutter?tab=selling', v_uid);
    RETURN v_id;
  END IF;

  PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'New offer',
    format('You got a $%s offer on "%s". Accept, decline or counter within 48 hours.',
           to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_make_offer(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_make_offer(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_offer_rules(p_item_id uuid, p_accepts_offers boolean, p_auto_offers boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_accepts_offers IS NULL OR p_auto_offers IS NULL THEN
    RAISE EXCEPTION 'invalid_offer_rules' USING ERRCODE = '22023';
  END IF;
  SELECT i.status INTO v_status FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_items SET accepts_offers = p_accepts_offers, updated_at = now() WHERE id = p_item_id;
  -- Auto answers only while offers are taken.
  UPDATE public.declutter_item_private SET auto_offers = (p_accepts_offers AND p_auto_offers), updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_offer_rules(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_offer_rules(uuid, boolean, boolean) TO authenticated, service_role;
