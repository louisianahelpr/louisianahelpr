-- Declutter notice copy, from the Declutter audit's read of live notice text
-- (lead 2026-10-28). Four asks, measured on prod (read-only) first:
--
--   2. "It's yours: check out within 48 hours" said the item was the buyer's
--      before they paid. Now "Reserved for you: check out within 48 hours"
--      (owner's wording: reserved, not paid yet). declutter_take_item.
--   3. Notices wrote "$30.00" where the app shows "$30"
--      (src/lib/declutter/distance.ts formatPrice: whole dollars without cents,
--      "$30.50" with). declutter_price_text(cents) is that rule in SQL;
--      declutter_price_words(text) applies it to a whole message and runs in
--      declutter_notify_strict, the one writer of Declutter notices, so the ~20
--      other callers that format with to_char(..., 'FM999990.00') read right
--      without being restated. declutter_price_drop_alert (writes its own row)
--      uses declutter_price_text. The rule reads the whole message, so a listing
--      titled "Vintage $5.00 bill" reads "$5 bill" in a notice (cosmetic, the
--      app's own price style; lh-money-escrow review note 1).
--   4. "Card saved: ... or automatically where you turned on automatic charges":
--      VERIFIED, no change. The card saved on the Declutter card page becomes the
--      one-wallet default card (stripe-webhook _walletDefaultCard.ts), which
--      auto-tip-charge charges off-session for a member who turned on automatic
--      tips (You > After a job, src/pages/profile/AutoTip.tsx; profiles
--      auto_tip_mode, 1 member on prod 2026-10-28). The Terms (TermsSection.tsx)
--      and the card_required error say the same.
--   5. "Buyer paid" (both paths in declutter_mark_order_paid) and "Sold: waiting
--      for the buyer to pay" (and its free twin "Someone claimed your free
--      item") are the seller's, and linked ?view=offers, which opens Buying
--      when only a counter waits on the member. They link ?view=selling now.
--
-- Bodies restated from their newest definitions, md5-equal to prod's
-- pg_proc.prosrc (read 2026-10-28): declutter_take_item (20261027170717),
-- declutter_mark_order_paid (20261026155251); declutter_notice_type,
-- declutter_notify_strict and declutter_price_drop_alert from 20261028162048.
-- Only the lines named above change.
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; every object exists on prod and
-- in every earlier migration's world.

-- The app's price rule: "$30" for whole dollars, "$30.50" otherwise. bigint, so an integer
-- column and a sum() both resolve (lh-money-escrow review note 2).
CREATE OR REPLACE FUNCTION public.declutter_price_text(p_cents bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_cents IS NULL THEN NULL
              WHEN p_cents % 100 = 0 THEN '$' || (p_cents / 100)::text
              ELSE '$' || to_char(p_cents / 100.0, 'FM999999990.00') END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_text(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_text(bigint) TO service_role;

-- The same rule over a whole message: "$30.00" -> "$30", "$30.50" unchanged.
CREATE OR REPLACE FUNCTION public.declutter_price_words(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT regexp_replace(p_text, '\$([0-9]+)\.00(?![0-9])', '$\1', 'g');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_words(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_words(text) TO service_role;

-- 3. Which kind: the renamed title (Sales).
CREATE OR REPLACE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    -- The caller already chose a Declutter kind.
    WHEN p_type IN ('declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
                    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted') THEN p_type
    -- Not a Declutter screen: Shops orders, setup jobs, admin alerts, earnings.
    WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type
    -- A Helpr's delivery work is work, not their own buying or selling.
    WHEN p_link LIKE '/declutter?view=deliver%' OR p_link LIKE '/declutter?tab=deliver%' THEN p_type
    -- Saved-search matches have their own per-search switches.
    WHEN p_type = 'job_match' THEN p_type
    WHEN p_title IN ('Listing sent for review', 'Your listing is live', 'Your listing needs a change',
                     'Your item is now free', 'Haul-away is open', 'Haul-away not booked',
                     'Haul-away refunded', 'Back on sale', 'Donation receipt',
                     -- Listing rounds (sell flow, 20261028164424, lands after this file)
                     'Your listing goes back up soon', 'Your listing comes down soon',
                     'Back up for another 30 days', 'Your listing came down')
      THEN 'declutter_listings'
    WHEN p_title IN ('New offer', 'New counteroffer', 'Offer declined', 'Offer withdrawn', 'Offer expired',
                     'Item no longer available', 'Item paused', 'Item taken down', 'Item off sale',
                     'Now free', 'New question', 'The seller answered', 'Item came down')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'Reserved for you: check out within 48 hours',
                     'It''s yours: pick a pickup within 48 hours', 'Free item claimed',
                     'Someone claimed your free item', 'Sold: waiting for the buyer to pay',
                     'Check out within 24 hours', '2 hours left to check out', 'Checkout closed',
                     'Buyer did not check out', 'The seller cancelled', 'This sale was cancelled',
                     'Sale cancelled', 'Free pickup cancelled', 'Payment received', 'Buyer paid',
                     'Card saved', 'Handover done', 'Enjoy your item', 'Amount owed', 'Amount owed added',
                     'An amount owed comes out of your next payout', 'Setup fee coming back',
                     'Delivery pay raised', 'Your raise is coming back')
      THEN 'declutter_sales'
    WHEN p_title IN ('Pickup booked', 'Pickup time changed', 'Pickup time cancelled', 'You missed your pickup',
                     'Your buyer is at the meeting spot', 'The seller is at the meeting spot',
                     'Your item is on the porch', 'Your item was picked up', 'Picked up', 'Delivered',
                     'Delivery booked', 'Delivery changed', 'Delivery coming up', 'Delivery time kept',
                     'Delivery time changed', 'New delivery time asked', 'Pick a new delivery time',
                     'Buyer is picking a delivery time', 'Your items were delivered', 'Your item is on its way',
                     'A Helpr took your delivery', 'A Helpr will pick it up', 'Helpr pickup booked',
                     'Finding another Helpr', 'The Helpr couldn''t pick up', 'Your delivery is on hold',
                     'Your delivery fell through', 'No Helpr took your delivery', 'The buyer will pick it up')
      THEN 'declutter_pickups'
    WHEN p_title IN ('Refund request', 'Refund request withdrawn', 'Refund on its way', 'Buyer refunded',
                     'Your refund did not go through', 'Your refund is being sent by hand',
                     'The seller agreed to a full refund', 'Full refund agreed',
                     'The seller offered a part refund', 'The seller said no',
                     'Louisiana Helpr will decide', 'Louisiana Helpr decided',
                     'A problem was reported on your sale', 'You got a Declutter strike',
                     'Your strike was removed')
      THEN 'declutter_refunds'
    WHEN p_title IN ('A seller has a match')
      THEN 'declutter_wanted'
    -- A title nobody listed yet still lands in the Declutter group, by its old type.
    WHEN p_type IN ('new_offers', 'expired') THEN 'declutter_offers'
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'transit_updates') THEN 'declutter_pickups'
    WHEN p_type IN ('warning', 'system_alert') THEN 'declutter_refunds'
    WHEN p_type IN ('payment', 'financial_alerts') THEN 'declutter_sales'
    WHEN p_type IN ('info', 'success') THEN 'declutter_listings'
    ELSE p_type
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_type(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_type(text, text, text) TO service_role;

-- 3. The one writer applies the price rule.
CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Q137: a seed (test) counterpart never notifies a real member.
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  -- Prices read the way the app shows them (src/lib/declutter/distance.ts
  -- formatPrice): whole dollars drop ".00", so "$30.00" is "$30" and "$30.50"
  -- stays. Every Declutter notice passes here, so callers that still format
  -- with to_char(..., 'FM999990.00') read right without being restated.
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, p_link), p_title,
          public.declutter_price_words(p_message), p_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;

-- 3. Price drops write their own row.
CREATE OR REPLACE FUNCTION public.declutter_price_drop_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w record;
  v_free boolean := NEW.current_price_cents = 0;
  v_title text;
  v_message text;
  v_link text := '/declutter/item/' || NEW.id::text;
  v_notified uuid;
BEGIN
  -- A seller out of Declutter keeps 'live' rows hidden (seller_hidden): their watchers cannot open them (review #3).
  IF NEW.status <> 'live' OR NEW.seller_hidden OR NEW.current_price_cents >= OLD.current_price_cents THEN
    RETURN NEW;
  END IF;
  v_title := CASE WHEN v_free THEN 'Now free' ELSE 'Price dropped' END;
  v_message := CASE WHEN v_free THEN format('"%s" is now free.', NEW.title)
                    ELSE format('"%s" dropped to %s.', NEW.title, public.declutter_price_text(NEW.current_price_cents)) END;
  FOR w IN
    SELECT wl.user_id
      FROM public.declutter_watchlist wl
      LEFT JOIN public.profiles wp ON wp.user_id = wl.user_id
     WHERE wl.item_id = NEW.id
       AND wl.user_id IS DISTINCT FROM NEW.seller_id
       -- Q137: a seed (test) listing never alerts a real watcher.
       AND (NOT NEW.is_seed OR COALESCE(wp.is_seed, false))
       AND NOT public.are_users_blocked(wl.user_id, NEW.seller_id)
       -- One per item per watcher every 3 days ("now free" always goes: it is the last drop).
       AND (v_free OR NOT EXISTS (SELECT 1 FROM public.declutter_price_alerts a
                                   WHERE a.item_id = NEW.id AND a.user_id = wl.user_id AND a.sent_at > now() - interval '3 days'))
       -- At most 5 price notices per watcher a day, across items.
       AND (SELECT count(*) FROM public.declutter_price_alerts a
             WHERE a.user_id = wl.user_id AND a.sent_at > now() - interval '1 day') < 5
  LOOP
    BEGIN
      v_notified := NULL;
      INSERT INTO public.notifications (user_id, type, title, message, link)
      VALUES (w.user_id, 'declutter_price_drops', v_title, v_message, v_link)
      RETURNING id INTO v_notified;
      -- The seed boundary trigger can suppress the bell: then nothing was told, nothing is counted, no email (review #4).
      IF v_notified IS NOT NULL THEN
        INSERT INTO public.declutter_price_alerts (item_id, user_id, price_cents) VALUES (NEW.id, w.user_id, NEW.current_price_cents);
        -- The email in its own block: a failed email never takes the bell and the ledger with it (review #1).
        BEGIN
          IF to_regnamespace('net') IS NOT NULL THEN
            PERFORM net.http_post(
              url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
              body := jsonb_build_object('user_id', w.user_id, 'title', v_title, 'message', v_message, 'type', 'declutter_price_drops', 'link', v_link));
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'declutter_price_drop_alert: item % watcher % email not queued: %', NEW.id, w.user_id, SQLERRM;
          PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,
            jsonb_build_object('watcher', w.user_id, 'step', 'email'));
        END;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A price change never fails because a watcher could not be told; the defect is logged where ops sees it (review #2).
      RAISE WARNING 'declutter_price_drop_alert: item % watcher % not told: %', NEW.id, w.user_id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,
        jsonb_build_object('watcher', w.user_id, 'step', 'notice'));
    END;
  END LOOP;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_alert() FROM PUBLIC, anon, authenticated;

-- 2, 3, 5. Reserved, not yours; whole-dollar prices; the seller's notices open Selling.
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

  IF p_price = 0 THEN
    -- A free claim (20261027170717): the same 48 hours, nothing to pay.
    PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
      format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or you get a strike and it goes back up. Nothing is charged.',
             v_title),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
      format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
      '/declutter?view=selling', p_buyer);
  ELSE
  -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
  PERFORM public.declutter_notify(p_buyer, 'payment', 'Reserved for you: check out within 48 hours',
    format('"%s" is in your cart for %s. Check out within 48 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price),
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for %s. The buyer has 48 hours to check out and pay.', v_title, v_price),
    '/declutter?view=selling', p_buyer);
  END IF;
  RETURN v_line;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- 3, 5. Whole-dollar prices; "Buyer paid" opens Selling.
CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_honour boolean := false;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_sale_ok boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  -- 141d: a replayed payment event for a HANDED-OVER sale is the same payment, never a new one to refund
  -- (before this it fell through to 'order_closed' and refunded the whole sale while the seller was paid).
  IF o.status IN ('paid', 'refunded', 'handed_over') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  -- Q2352: the page charged the sale plus the one-time setup fee frozen on the order, or the sale alone: a page
  -- opened by a declutter-checkout that did not know the fee yet (the migration deploys before the edge,
  -- functions-deploy.yml waits for db-deploy; lh-money-escrow review of the Q2352 branch #1). Then the fee was
  -- not charged: it is marked so, nothing is claimed, and the account pays it at its next first-time step.
  IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes; the sale stands if
      -- every item is still unsold and the seller can still sell to them.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      v_sale_ok := v_items_ok
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      v_honour := v_sale_ok AND NOT v_cant;
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
        -- thing that stops the sale, the seller (not us) owes the card fee; the
        -- buyer still gets every cent. An item that went elsewhere is ours.
        -- As in path (c): a seller who is out wins over a BUYER who blocked
        -- them; a seller who blocked the buyer is left as before (filed in docs/OPEN.md).
        v_reason := CASE WHEN v_items_ok AND v_cant
                               AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                                                WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                         THEN 'seller_out' ELSE 'sold_elsewhere' END;
        v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
        IF v_reason = 'seller_out' THEN
          PERFORM public.declutter_seller_out_fee_notice(v_refund);
        END IF;
        RETURN public.declutter_refund_answer(v_refund);
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status IN ('live', 'paused');
        FOR v_void IN
          UPDATE public.declutter_offers SET status = 'voided', closed_at = now(), updated_at = now()
           WHERE item_id = r.item_id AND status = 'open'
          RETURNING id, buyer_id
        LOOP
          INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (v_void.id, 'system', 'void');
          PERFORM public.declutter_notify(v_void.buyer_id, 'new_offers', 'Item no longer available',
            format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', r.title),
            '/declutter/item/' || r.item_id::text, o.seller_id);
        END LOOP;
      END LOOP;
      UPDATE public.declutter_cart_items SET status = 'paid', closed_at = now()
       WHERE order_id = p_order_id AND status = 'missed';
      UPDATE public.declutter_orders
         SET status = 'paid', close_reason = NULL, closed_at = NULL, paid_at = now(), stripe_paid_at = p_paid_at,
             stripe_payment_intent_id = p_payment_intent_id,
             card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
       WHERE id = p_order_id AND status = 'expired';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
        format('You paid %s in time, so the sale stands and there is no strike. Next: pick up your items at the time you chose.',
               public.declutter_price_text(p_amount_cents)),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for %s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               public.declutter_price_text(o.items_cents)),
        '/declutter?view=selling', o.buyer_id);
      PERFORM public.declutter_claim_setup_fee(p_order_id);
      RETURN jsonb_build_object('result', 'paid');
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid %s. Next: pick up your items at the time you chose.', public.declutter_price_text(p_amount_cents)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for %s of your items. You get paid when the buyer has them.', public.declutter_price_text(o.items_cents)),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;
