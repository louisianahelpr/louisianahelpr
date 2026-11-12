-- Lead decision (11-11 ~8:00 PM, by recommendation, consistent with the owner's "names everywhere"; OWNER-DECISIONS.md):
-- on an offer answering a Wanted post, the buyer's (the Wanted poster's) "Reserved for you" notice from
-- declutter_take_item NAMES the seller again ("Sam S. ..."), matching My Wanted, which already shows the poster the
-- seller's "First L." (declutter_my_wanted.seller_name, 20261102013814). This undoes only the Wanted half of
-- 20261112010200; its block/ban half stays: once either side blocked the other or either is banned
-- (public.declutter_names_hidden), neither take_item notice names the other member. The seller's notice on a Wanted
-- thread still does not name the poster (unchanged; declutter_my_offers keeps that thread nameless for the seller).
--
-- declutter_take_item restated VERBATIM from its newest definition,
-- 20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql, with the changes marked
-- "CHANGED 20261112022921". Nothing else changes: titles, links, types, actors, status changes, checks and locks.
-- Replay-safe: CREATE OR REPLACE of the same signature keeps its grants.
-- Proof: src/test/pglite/declutterWantedReservedNoticeNamesSeller.pglite.mjs. Sensitive: authz (what one member sees of
-- another).

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
  -- F481 (audit 11-10 W6): the hold's deadline, said as a clock time ("Wed, Nov 11 at 2:00 PM").
  v_by timestamptz;
  v_by_words text;
  v_buyer text; -- CHANGED 20261112004748: "Ann S." on the seller's notice; NULL with no name or for an offer answering a Wanted post.
  -- CHANGED 20261112022921: true when the buyer's notice must not name the seller: a block either way or a ban on either
  -- side (declutter_names_hidden). A Wanted thread names the seller again (lead 11-11 ~8:00 PM), as My Wanted does.
  v_seller_anon boolean;
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
  RETURNING id, checkout_by INTO v_line, v_by;
  v_by_words := public.continue_day_label((v_by AT TIME ZONE 'America/Chicago')::date, (v_by AT TIME ZONE 'America/Chicago')::time);

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
    -- CHANGED 20261112004748 (owner 11-11 "everywhere"): the seller's notice names the buyer, except on a Wanted thread.
    -- CHANGED 20261112010200: and never across a block or a ban (either side): the old words.
    IF (p_offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL))
       AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN
      SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = p_buyer;
    END IF;
    -- CHANGED 20261112022921: the buyer's notice names the seller unless a block or a ban hides them (a Wanted thread too).
    v_seller_anon := public.declutter_names_hidden(p_buyer, v_seller);
    IF p_price = 0 THEN
      -- A free claim (20261027170717): the same 48 hours, nothing to pay.
      -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup time',
        format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. %s',
               v_title, public.declutter_free_hold_charge_words(p_buyer)),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
        CASE WHEN v_buyer IS NOT NULL
          THEN format('%s claimed "%s". They have 48 hours to choose a pickup.', v_buyer, v_title)
          ELSE format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title) END,
        '/declutter?view=selling', p_buyer);
    ELSIF p_source = 'buy' THEN
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved: check out within 30 minutes',
        format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
               v_title, v_price),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      -- M1 (audit 11-08): not "Sold" until the payment lands; the buyer can still back out with no strike.
      PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
        format('%s is checking out "%s" for %s. It''s held for them for 30 minutes. We''ll tell you when they pay.',
               COALESCE(v_buyer, 'Someone'), v_title, v_price),
        '/declutter?view=selling', p_buyer);
    ELSE
    -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
    -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out in 24 hours',
      CASE WHEN p_offer_id IS NOT NULL THEN
        format('%s accepted your %s offer for "%s". Check out by %s to keep it: choose pickup or delivery, pick a day and time, and pay. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',
               -- CHANGED 20261112022921: "The seller" only across a block or a ban.
               CASE WHEN v_seller_anon THEN 'The seller'
                    ELSE COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller') END,
               v_price, v_title, v_by_words)
      ELSE
      format('"%s" is in your cart for %s. Check out by %s to keep it. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',
             v_title, v_price, v_by_words) END,
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    -- M1 (audit 11-08): not "Sold" until the payment lands.
    PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
      format('"%s" is held for %s at %s. They have 24 hours to check out and pay. We''ll tell you when they pay.',
             v_title, COALESCE(v_buyer, 'the buyer'), v_price),
      '/declutter?view=selling', p_buyer);
    END IF;
  END IF;
  RETURN v_line;
END;
$function$;
