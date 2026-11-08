-- Declutter buy audit 11-08 (~/.lh-shots/handoffs-1108/declutter-buy-audit.md), Builder 4. Lead calls 11-08.
--
-- H1 (High): no Declutter notice was ever emailed. notification_logs, 30 days to 11-08, Declutter categories: push
-- only (52 skipped, 12 sent), 0 email rows; the real buyer of 11-06 had no push token, so "Reserved for you: check out
-- within 30 minutes" reached nobody. An accepted offer's "check out within 24 hours ... or you get a strike" was the
-- same. Now every notice of the four action kinds (declutter_offers, declutter_sales, declutter_pickups,
-- declutter_refunds) is ALSO emailed, through send_notice_email (20261108160000) and send-notification-email, which
-- reads the member's switch for the kind (email_declutter_offers / _sales / _pickups / _refunds, all DEFAULT true,
-- measured on prod 11-08 with information_schema) and the Email master, and refuses a test or seed recipient and a
-- seed subject. This trigger also skips a test member (is_test_member) before any call, and declutter_notify(_strict)
-- already writes nothing to a real member about a seed counterpart (Q137). Not emailed again here, because their
-- own email already goes: "Payment received" (the buyer's declutter_receipt), "Buyer paid" (the seller's
-- declutter_sold), "Your payout for ..." (declutter_payout_sent), "Refund on its way" (declutter_refund), "Delivery
-- pay raised" (the raise receipt), "Your raise is coming back" and "Shipping refund on its way" (tellBuyerRefunded,
-- declutter-money). Also not
-- emailed: each chat line ("New message about ...": the delayed "Unread message" reminder is), "Listing updated" /
-- "Listing changed" (edits to an item someone offered on), and "Card saved" (the payment page says it first, M4).
--
-- M1 (Medium): the seller was told "Sold: waiting for the buyer to pay" on every Buy now tap, though the buyer can
-- back out within 30 minutes with no strike (11-06: "Sold" at 05:11, "Buyer did not check out" at 05:54). Now
-- "Someone's buying your item" until the payment lands; "Buyer paid" (bell) and "You sold" (email) say it sold.
-- The bundle's "Bundle sold: waiting ..." is "Bundle accepted: waiting ...".
--
-- M3 (Medium): a free ask made with no pickup time (older app builds; declutter_request_free) never closed: prod ask
-- 48072da3 open since 11-01 17:40 UTC, pickup_at NULL. sweep_declutter_free_asks now also closes an ask with no time
-- 48 hours after it was made, telling the asker ("Your ask ended") and the giver ("An ask ended") in their own words.
--
-- M4 (Medium): the "Card saved" notice said "charged automatically" after a first $3 buy. It now uses the words the
-- payment page shows above Pay on a first buy (declutter-checkout custom_text): "We saved this card for your next
-- Declutter buy ...".
--
-- MONEY: none moved. declutter_save_card changes only its notice text; declutter_take_item and declutter_answer_bundle
-- change only seller notice text; holds, prices and statuses are verbatim. AUTHZ: no new member-callable function;
-- email_declutter_notice() is a trigger function (EXECUTE revoked from PUBLIC, anon, authenticated); every restated
-- function keeps its grants (restated by role name). REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/declutterNoticesEmail.pglite.mjs (applied 3x). Guard: src/test/declutterNoticesEmail.test.ts.

-- ── 1. H1: email the Declutter notices that ask for action or say what happened to an order. ──
CREATE OR REPLACE FUNCTION public.email_declutter_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- A test account is never emailed (send-notification-email refuses it too; this saves the call).
  IF NEW.user_id IS NULL OR public.is_test_member(NEW.user_id) THEN
    RETURN NULL;
  END IF;
  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, NEW.type, NEW.link, NULL);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.email_declutter_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_declutter_notice ON public.notifications;
CREATE TRIGGER trg_email_declutter_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('declutter_offers', 'declutter_sales', 'declutter_pickups', 'declutter_refunds')
        AND NEW.title NOT IN (
          -- their own email already goes (header)
          'Payment received', 'Buyer paid', 'Refund on its way',
          'Delivery pay raised', 'Your raise is coming back', 'Shipping refund on its way',
          -- the payment page said it first (M4)
          'Card saved',
          -- each chat line: the delayed "Unread message" reminder is emailed instead
          'New message about your order', 'New message about a handover', 'New message about a delivery',
          -- an edit to an item someone offered on
          'Listing updated', 'Listing changed')
        AND NEW.title NOT LIKE 'Your payout for %')
  EXECUTE FUNCTION public.email_declutter_notice();

-- ── 2. M1: declutter_take_item, restated VERBATIM from 20261107185819_declutter_free_pick_notice_first_timer.sql;
--       the only changes are the two seller notices marked M1. ──
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
        format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. %s',
               v_title, public.declutter_free_hold_charge_words(p_buyer)),
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
      -- M1 (audit 11-08): not "Sold" until the payment lands; the buyer can still back out with no strike.
      PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
        format('Someone is checking out "%s" for %s. It''s held for them for 30 minutes. We''ll tell you when they pay.', v_title, v_price),
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
    -- M1 (audit 11-08): not "Sold" until the payment lands.
    PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
      format('"%s" is held for the buyer at %s. They have 24 hours to check out and pay. We''ll tell you when they pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
    END IF;
  END IF;
  RETURN v_line;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- ── 3. M1: declutter_answer_bundle, restated VERBATIM from 20261104124645_declutter_bundle_take_quiet.sql; the only
--       change is the seller's title (marked M1). ──
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
    PERFORM public.declutter_notify(v_uid, 'declutter_sales', 'Bundle accepted: waiting for the buyer to pay', -- M1 (audit 11-08)
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

-- ── 4. M4: declutter_save_card, restated VERBATIM from 20261103130123_money_card_rent_seller_delivery_setup_fee_not_found_is_404.sql;
--       the only change is the notice's words (marked M4). ──
CREATE OR REPLACE FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, brand, last4, card_mode, saved_at)
  VALUES (p_user, p_customer, p_payment_method, left(p_brand, 20),
          CASE WHEN p_last4 ~ '^[0-9]{4}$' THEN p_last4 END, p_mode, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stripe_customer_id = EXCLUDED.stripe_customer_id, payment_method_id = EXCLUDED.payment_method_id,
        brand = EXCLUDED.brand, last4 = EXCLUDED.last4, card_mode = EXCLUDED.card_mode, saved_at = now();
  -- One wallet: the member's first stored customer in this mode wins.
  -- A cus_ already stored for ANOTHER member (never expected: the id comes
  -- from Stripe's signed event) is logged, not raised, so the webhook does not
  -- retry forever; the card is still saved (reviews: lh-authz-rls #1, lh-money-escrow #2).
  IF p_mode IN ('live', 'test') AND p_customer ~ '^cus_[A-Za-z0-9]+$' THEN
    BEGIN
      INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id)
      VALUES (p_user, p_mode, p_customer)
      ON CONFLICT (user_id, wallet_mode) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'one wallet: % is stored for another member; card saved, wallet unchanged', p_customer;
    END;
  END IF;
  -- M4 (audit 11-08): the same words as the consent line on the payment page (declutter-checkout CARD_SAVE_CONSENT).
  PERFORM public.declutter_notify(p_user, 'payment', 'Card saved',
    'We saved this card for your next Declutter buy. It''s charged only when you press Pay, or automatically where you turned on automatic charges.', '/declutter');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text) TO service_role;

-- ── 5. M3: sweep_declutter_free_asks, restated VERBATIM from 20261102011547_free_asks_close_when_their_time_passes.sql;
--       the changes are marked M3 (an ask with no time closes 48 hours after it was made, with its own words). ──
CREATE OR REPLACE FUNCTION public.sweep_declutter_free_asks(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ids uuid[];
  v_done integer := 0;
  r record;
  v_time text;
BEGIN
  -- a. CLOSE every open ask whose own time has passed.
  WITH closed AS (
    UPDATE public.declutter_free_requests q SET status = 'expired', closed_at = p_now
     WHERE q.status = 'open'
       AND ((q.pickup_at IS NOT NULL AND q.pickup_at <= p_now)
            -- M3 (audit 11-08): an ask with no pickup time (older app builds) ends 48 hours after it was made.
            OR (q.pickup_at IS NULL AND q.created_at <= p_now - interval '48 hours'))
    RETURNING q.id
  )
  SELECT array_agg(c.id) INTO v_ids FROM closed c;
  v_done := COALESCE(cardinality(v_ids), 0);
  IF v_done > 0 THEN
    FOR r IN
      SELECT q.requester_id, q.seller_id, q.item_id, COALESCE(NULLIF(btrim(i.title), ''), 'the free item') AS what,
             q.pickup_at IS NULL AS no_time
        FROM public.declutter_free_requests q
        JOIN public.declutter_items i ON i.id = q.item_id
       WHERE q.id = ANY (v_ids) AND COALESCE(i.is_seed, false) = false
    LOOP
      IF r.no_time THEN
        PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'Your ask ended',
          format('The giver didn''t pick anyone for "%s" within 48 hours. Ask again with a pickup time if it''s still up.', r.what),
          '/declutter/item/' || r.item_id::text, r.seller_id);
      ELSE
      PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'Your pickup time passed',
        format('The giver didn''t pick anyone for "%s" before your time. Ask again with a new time if it''s still up.', r.what),
        '/declutter/item/' || r.item_id::text, r.seller_id);
      END IF;
    END LOOP;
    FOR r IN
      SELECT q.seller_id, q.item_id, count(*)::int AS n, COALESCE(NULLIF(btrim(max(i.title)), ''), 'your free item') AS what,
             q.pickup_at IS NULL AS no_time
        FROM public.declutter_free_requests q
        JOIN public.declutter_items i ON i.id = q.item_id
       WHERE q.id = ANY (v_ids) AND COALESCE(i.is_seed, false) = false
       GROUP BY q.seller_id, q.item_id, (q.pickup_at IS NULL)
    LOOP
      PERFORM public.declutter_notify(r.seller_id, 'declutter_offers', 'An ask ended',
        format(CASE WHEN r.no_time THEN '%s for "%s" ended: nobody was picked within 48 hours. Anyone can ask again.'
                    ELSE '%s for "%s" ended: the pickup time passed before you picked. Anyone can ask again.' END,
               CASE WHEN r.n = 1 THEN '1 ask' ELSE r.n::text || ' asks' END, r.what),
        '/declutter/item/' || r.item_id::text, NULL);
    END LOOP;
  END IF;

  -- b. REMIND the giver about 2 hours before the earliest open asked time.
  IF public.needs_you_reminder_quiet(p_now) THEN
    RETURN v_done;
  END IF;
  FOR r IN
    SELECT DISTINCT ON (q.item_id) q.id, q.item_id, q.seller_id, q.pickup_at,
           COALESCE(NULLIF(btrim(i.title), ''), 'your free item') AS what,
           (SELECT count(*)::int FROM public.declutter_free_requests q2 WHERE q2.item_id = q.item_id AND q2.status = 'open') AS n
      FROM public.declutter_free_requests q
      JOIN public.declutter_items i ON i.id = q.item_id
     WHERE q.status = 'open' AND q.pickup_at > p_now AND q.pickup_at <= p_now + interval '2 hours'
       AND i.status = 'live' AND COALESCE(i.is_seed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_requests q3
                        WHERE q3.item_id = q.item_id AND q3.status = 'open' AND q3.giver_reminded_at IS NOT NULL)
     ORDER BY q.item_id, q.pickup_at, q.created_at
  LOOP
    v_time := to_char(r.pickup_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM');
    BEGIN
      UPDATE public.declutter_free_requests SET giver_reminded_at = p_now WHERE id = r.id;
      PERFORM public.declutter_notify_strict(r.seller_id, 'declutter_offers', 'Pick who gets it',
        CASE WHEN r.n = 1
          THEN format('1 person asked for "%s" and wants %s. Next: pick them by then, or the ask ends.', r.what, v_time)
          ELSE format('%s people asked for "%s"; the first wants %s. Next: pick someone by then.', r.n, r.what, v_time) END,
        '/declutter/item/' || r.item_id::text, NULL);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('sweep_declutter_free_asks', 'remind:' || r.id::text, SQLERRM,
        jsonb_build_object('request_id', r.id, 'item_id', r.item_id));
    END;
  END LOOP;
  RETURN v_done;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_declutter_free_asks(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_declutter_free_asks(timestamptz) TO service_role;
