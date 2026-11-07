-- 11-07 free-claim trace (owner posting free Declutter items in local groups; lead lexilombas-de): the notice a member
-- gets when a giver picks them for a free item said "Nothing is charged." With the ID check on (identity_check
-- 'everyone', setup fee 200 cents on prod 11-07), a member who has never paid the one-time fee or never verified is
-- next asked for both by declutter_checkout_free (declutter_free_claim_gate) before the address opens, so for them it
-- was false. The app's own lines already avoid it for that member (DeclutterFreeClaim.tsx oneTimeCheckAhead).
--
--   1. public.declutter_free_hold_charge_words(p_buyer): the closing words of that notice, by the gate's own rule
--      (declutter_free_claim_gate, 20261031211922): no ID check ahead (an admin, an exempt member, or the fee paid and
--      the ID verified) -> "Nothing is charged." (unchanged); otherwise "The item stays free. Your first free item has
--      a one-time ID check before you get the address; we show you the cost first." The admin role is read from
--      user_roles directly (has_role is scoped to the caller, and the caller here is the giver). Service role only.
--   2. declutter_take_item: restated VERBATIM from its newest CREATE (20261104124645_declutter_bundle_take_quiet.sql);
--      the ONLY change is that free-claim notice's last sentence, now the helper's words. Proof of verbatim:
--      src/test/declutterFreeHoldNoticeFirstTimer.test.ts (the restated body equals the previous one with that one
--      substitution undone).
--
-- MONEY: none (notice text only; no amount, status, hold or fee changes). AUTHZ: the helper is service_role only;
-- declutter_take_item keeps its grants. REPLAY-SAFE: CREATE OR REPLACE, grants by role name.
-- Proof: src/test/pglite/declutterFreeHoldNoticeFirstTimer.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_free_hold_charge_words(p_buyer uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_buyer IS NULL
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_buyer AND ur.role = 'admin')
      OR public.identity_check_exempt(p_buyer)
      OR (public.declutter_setup_fee_due_cents(p_buyer) = 0 AND public.is_identity_verified(p_buyer))
    THEN 'Nothing is charged.'
    ELSE 'The item stays free. Your first free item has a one-time ID check before you get the address; we show you the cost first.'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_hold_charge_words(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_free_hold_charge_words(uuid) TO service_role;

-- declutter_take_item: restated VERBATIM from 20261104124645_declutter_bundle_take_quiet.sql; one notice sentence changed.
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
