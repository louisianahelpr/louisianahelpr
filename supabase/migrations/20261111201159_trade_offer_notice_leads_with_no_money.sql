-- F482 (whole-app audit 11-10, Worker 6, Suggestion; words half): the "New trade offer" notice (bell, push and email)
-- ended with "No money changes hands.", the line a first-timer most needs. It now leads with it:
--   'No money changes hands. <First L.> offered "<their item>" in trade for "<your item>". Accept or decline within
--    48 hours.'
-- Item photos in the email are NOT added here: the notice email (send_notice_email -> send-notification-email) carries
-- only title, words and link, so a photo needs an email template change, logged under Builder 3 in
-- DECISIONS-FOR-OWNER-1111.md.
--
-- declutter_offer_swap is restated VERBATIM from its newest definition (20261108195151), changing only that sentence
-- (marked CHANGED 20261111201159). Checks, limits, insert, feature switch, link and grants keep.
-- Replay-safe: CREATE OR REPLACE of the same signature; grants restated as live.
-- Proof: src/test/pglite/tradeOfferNoticeLeadsWithNoMoney.pglite.mjs (red without, green with, 3x).

CREATE OR REPLACE FUNCTION public.declutter_offer_swap(p_item_id uuid, p_offered_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_ok record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_item_id IS NULL OR p_offered_item_id IS NULL OR p_item_id = p_offered_item_id THEN
    RAISE EXCEPTION 'invalid_trade' USING ERRCODE = '22023';
  END IF;
  -- The ID rule (OWNER-DECISIONS): the buyer's first purchase. A trader is a lister, so this normally passes at once.
  PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');
  SELECT * INTO v_ok FROM public.declutter_swap_items_ok(p_item_id, p_offered_item_id, v_uid);

  -- Unswept past-due offers never block a new one.
  UPDATE public.declutter_swap_offers SET status = 'expired', closed_at = now(), updated_at = now()
   WHERE status = 'open' AND respond_by <= now()
     AND ((item_id = p_item_id AND buyer_id = v_uid) OR offered_item_id = p_offered_item_id);
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.item_id = p_item_id AND s.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'trade_already_open' USING ERRCODE = '55000',
      HINT = 'You already offered a trade for this item. Wait for the answer or take it back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.offered_item_id = p_offered_item_id) THEN
    RAISE EXCEPTION 'offered_item_in_trade' USING ERRCODE = '55000',
      HINT = 'That item is already offered in another trade. Take that offer back first, or pick another item.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_swap_offers s
       WHERE s.buyer_id = v_uid AND s.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'trade_rate_limited' USING ERRCODE = '54000', HINT = 'You can offer 10 trades a day.';
  END IF;

  INSERT INTO public.declutter_swap_offers (item_id, offered_item_id, buyer_id, seller_id, respond_by, is_seed)
  VALUES (p_item_id, p_offered_item_id, v_uid, v_ok.o_seller_id, now() + interval '48 hours', coalesce(v_ok.o_seed, false))
  RETURNING id INTO v_id;
  -- CHANGED (#11): bell and email.
  PERFORM public.declutter_notify(v_ok.o_seller_id, 'declutter_offers', 'New trade offer',
    -- CHANGED 20261111201159 (F482): "No money changes hands." leads.
    format('No money changes hands. %s offered "%s" in trade for "%s". Accept or decline within 48 hours.',
           coalesce((SELECT public.member_display_name(p.full_name, 'A buyer') FROM public.profiles p WHERE p.user_id = v_uid), 'A buyer'),
           v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_offer_swap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_offer_swap(uuid, uuid) TO authenticated, service_role;
