-- F356 follow-up (owner pop-ups 11-11 ~5:00 PM, OWNER-DECISIONS.md): the buyer's first name + last initial now shows in
-- the seller's offer NOTICES (bell, push and email), matching the seller's offer card (declutter_my_offers.buyer_display,
-- 20261111223500). Only the name, from member_display_name(full_name, NULL) ("Ann S."): no id, photo or link.
-- Seller-facing notices about a buyer's move, each with the old words kept as the fallback when the buyer has no name
-- (blank or gone account):
--   declutter_make_offer   New offer                     'Ann S. offered $40.00 on "Lamp". Accept, decline or send a
--                                                         different price within 48 hours.'
--                          Offer answered automatically  'Ann S. offered $30.00 on "Lamp". You answered automatically
--                                                         with your lowest price, $35.00.'
--                          Offer accepted automatically  'Ann S.'s $40.00 offer on "Lamp" was accepted automatically (at
--                                                         or above your lowest price).'
--   declutter_respond_offer New counteroffer (buyer's)   'Ann S. sent a $38.00 counteroffer on "Lamp". Accept, decline or
--                                                         send a different price within 48 hours.'
--                          Offer withdrawn               'Ann S. took back their offer on "Lamp".'
--                          Offer declined (buyer's no)   'Ann S. said no to your $45.00 price on "Lamp". Your listing is
--                                                         still up.'
--                          Offer accepted automatically  as in make_offer.
-- Unchanged: every buyer-facing notice; titles, types, links, actors, status changes, checks and locks. A thread that
-- answers a Wanted post (declutter_offers.wanted_id set) stays anonymous: there the buyer is the Wanted poster and
-- every notice keeps the old words (owner: Wanted-post replies stay anonymous). declutter_wanted_reply is not touched.
--
-- Out of date after this (old migrations are never edited): the export_my_data comments at
-- 20261103014109_crew_share_held_reason.sql:271 and 20261105184827_export_declutter_item_views.sql:252 ("any offer the
-- buyer made, never names the buyer to the seller before a deal"). Since 20261111223500 (offer card) and this migration
-- (notices) the seller IS shown the buyer's first name + last initial before a deal. What export_my_data does is
-- unchanged: the seller's export still carries no buyer_id on such an offer.
--
-- Bodies: declutter_make_offer VERBATIM from its newest definition 20261110202142_notice_titles_by_outcome_plain_words.sql,
-- declutter_respond_offer VERBATIM from 20261111191033_declutter_seller_counter_declined_words.sql, changes marked
-- "CHANGED 20261112003050". Replay-safe: CREATE OR REPLACE of the same signatures keeps their grants.
-- Proof: src/test/pglite/declutterOfferNoticesNameTheBuyer.pglite.mjs. Sensitive: authz (what one member sees of another).

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
  v_buyer text; -- CHANGED 20261112003050: "Ann S.", the buyer as the seller's offer card shows them; NULL = no name.
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
  -- CHANGED 20261112003050 (owner 11-11): the seller's notices name the buyer, first name + last initial.
  SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;

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
        CASE WHEN v_buyer IS NOT NULL
          THEN format('%s''s $%s offer on "%s" was accepted automatically (at or above your lowest price).',
                      v_buyer, to_char(v_charge / 100.0, 'FM999990.00'), v_item.o_title)
          ELSE format('Accepted automatically at or above your lowest price: $%s for "%s".',
                      to_char(v_charge / 100.0, 'FM999990.00'), v_item.o_title) END,
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
    PERFORM public.declutter_notice_ref(v_id); -- Q2659
    PERFORM public.declutter_notify(v_uid, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
             to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00'), v_item.o_title),
      '/declutter?tab=buying', v_item.o_seller_id);
    PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'Offer answered automatically',
      CASE WHEN v_buyer IS NOT NULL
        THEN format('%s offered $%s on "%s". You answered automatically with your lowest price, $%s.',
                    v_buyer, to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title,
                    to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00'))
        ELSE format('You got a $%s offer on "%s" and answered it automatically with your lowest price, $%s.',
                    to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title,
                    to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00')) END,
      '/declutter?tab=selling', v_uid);
    RETURN v_id;
  END IF;

  PERFORM public.declutter_notice_ref(v_id); -- Q2659
  PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'New offer',
    CASE WHEN v_buyer IS NOT NULL
      THEN format('%s offered $%s on "%s". Accept, decline or send a different price within 48 hours.',
                  v_buyer, to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title)
      ELSE format('You got a $%s offer on "%s". Accept, decline or send a different price within 48 hours.',
                  to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title) END,
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

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
  v_buyer text; -- CHANGED 20261112003050: "Ann S." on a seller's notice about a buyer's move; NULL on a Wanted reply.
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
  -- CHANGED 20261112003050 (owner 11-11): the buyer's first name + last initial, as declutter_my_offers.buyer_display
  -- shows it on the seller's offer card. Never on a Wanted reply (o.wanted_id set: that buyer is the Wanted poster).
  IF o.wanted_id IS NULL THEN
    SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = o.buyer_id;
  END IF;

  IF p_action = 'withdraw' THEN
    IF v_side <> 'buyer' THEN
      RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;
    UPDATE public.declutter_offers SET status = 'withdrawn', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, 'buyer', 'withdraw');
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer withdrawn',
      CASE WHEN v_buyer IS NOT NULL THEN format('%s took back their offer on "%s".', v_buyer, v_item.title)
           ELSE format('The buyer took back their offer on "%s".', v_item.title) END,
      '/declutter?tab=selling', o.buyer_id);
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
        THEN format('%s said no to your $%s price on "%s".%s', COALESCE(v_buyer, 'The buyer'),
               to_char(o.amount_cents / 100.0, 'FM999990.00'),
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
      CASE WHEN v_side = 'buyer' AND v_buyer IS NOT NULL
        THEN format('%s sent a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
                    v_buyer, to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title)
        ELSE format('You got a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
                    to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title) END,
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
      CASE WHEN v_buyer IS NOT NULL
        THEN format('%s''s $%s offer on "%s" was accepted automatically (at or above your lowest price).',
                    v_buyer, to_char(least(o.amount_cents, v_item.current_price_cents) / 100.0, 'FM999990.00'), v_item.title)
        ELSE format('Accepted automatically at or above your lowest price: $%s for "%s".',
                    to_char(least(o.amount_cents, v_item.current_price_cents) / 100.0, 'FM999990.00'), v_item.title) END,
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  RETURN 'accepted';
END;
$fn$;
