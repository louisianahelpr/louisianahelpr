-- Q2660 (account audit 1102d row 20, the part left after BUY-30): "New offer" and "New counteroffer" link the bare
-- Selling or Buying tab, so with several offers on the tab the member has to find the one the notice is about.
-- BUY-30 (20261031111949) added &order=<id> for order notices; an offer is not an order, so it left them alone.
--
-- FIX: those notices already name their offer. Q2659 (20261102113853) puts "PERFORM public.declutter_notice_ref(<offer
-- id>)" before each of them (declutter_make_offer: "New offer" and the automatic "New counteroffer";
-- declutter_respond_offer: "New counteroffer"), and declutter_notify_strict computes its link in DECLARE, before it
-- clears that setting. declutter_notice_order_link, restated VERBATIM from its newest CREATE
-- (20261031111949_declutter_notices_open_the_order.sql; the newest on origin/main and on every origin branch, checked
-- 11-02 with git over all 1284 origin branches), gains one block, marked Q2660, before its order logic: it adds
-- &offer=<id> to the link when, and only when:
--   - declutter.notice_ref holds a well-formed uuid that is a declutter_offers row,
--   - that offer is between exactly this notice's member and its counterpart (seller and buyer),
--   - the link is the bare tab of the member's own side: ?tab=selling to the offer's seller, ?tab=buying to its buyer.
-- Otherwise it falls through to the BUY-30 order logic, unchanged. Never another offer's id; at worst today's link.
-- A cart line or order ref is not an offer row, so the take_item and porch notices are unchanged.
-- The app (src/components/declutter/useLinkedOrder.ts useLinkedOffer, DeclutterOffersSection.tsx) shows that offer's
-- card even inside the closed fold, scrolls to it and focuses it.
--
-- MONEY: none. AUTHZ: none; the helper stays service_role only (not a definer; it runs inside declutter_notify_strict,
-- which is). Notices already sent keep their link. REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/declutterOfferNoticesOpenTheOffer.pglite.mjs (3x; red with NEW_MIGRATION=skip).

CREATE OR REPLACE FUNCTION public.declutter_notice_order_link(p_user uuid, p_other uuid, p_link text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref text := NULLIF(current_setting('declutter.notice_order', true), '');
  v_tab text;
  -- Q2660: the offer an offer notice is about (declutter_notice_ref, set just before the notice).
  v_offer text := NULLIF(current_setting('declutter.notice_ref', true), '');
  v_offer_tab text;
BEGIN
  -- Q2660: an offer notice opens that offer, on the member's own bare tab, for this offer's two parties only.
  IF v_offer ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND p_user IS NOT NULL AND p_other IS NOT NULL AND p_link ~ '^/declutter\?tab=(selling|buying)$' THEN
    SELECT CASE WHEN f.seller_id = p_user AND f.buyer_id = p_other THEN 'selling'
                WHEN f.buyer_id = p_user AND f.seller_id = p_other THEN 'buying' END
      INTO v_offer_tab
      FROM public.declutter_offers f
     WHERE f.id = v_offer::uuid;
    IF v_offer_tab IS NOT NULL AND p_link = '/declutter?tab=' || v_offer_tab THEN
      RETURN p_link || '&offer=' || v_offer;
    END IF;
  END IF;
  IF v_ref IS NULL OR p_user IS NULL OR p_other IS NULL OR p_link IS NULL
     OR v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_link !~ '^/declutter\?tab=(selling|buying)$' THEN
    RETURN p_link;
  END IF;
  SELECT CASE WHEN o.seller_id = p_user AND o.buyer_id = p_other THEN 'selling'
              WHEN o.buyer_id = p_user AND o.seller_id = p_other THEN 'buying' END
    INTO v_tab
    FROM public.declutter_orders o
   WHERE o.id = v_ref::uuid;
  IF v_tab IS NULL OR p_link <> '/declutter?tab=' || v_tab THEN
    RETURN p_link;
  END IF;
  RETURN p_link || '&order=' || v_ref;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_order_link(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_order_link(uuid, uuid, text) TO service_role;
