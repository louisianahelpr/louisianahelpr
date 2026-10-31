-- BUY-30 (last part, 2026-10-31): a Declutter notice about one order opens THAT order, not only its tab.
--
-- BROKEN: "Refund request", "A problem was reported", "You owe from a refund" and every other order notice link
-- /declutter?tab=selling or ?tab=buying. With several orders on the tab the member has to find the one the notice
-- is about.
--
-- FIX: every Declutter notice is written by declutter_notify_strict (declutter_notify wraps it). The order a
-- transaction's notices are about is already recorded there (declutter_notice_about, 20261028191646: every path
-- that locks an order, and the order insert/update trigger). A new helper, declutter_notice_order_link, adds
-- &order=<id> to the link when, and only when:
--   - an order is recorded for this transaction (a well-formed uuid),
--   - that order is between exactly this notice's member and its counterpart (the same rule that names the item),
--   - the link is the bare tab of the member's own side: ?tab=selling to the order's seller, ?tab=buying to its
--     buyer (a link with any other query, a sub-view, the other side's tab or a non-Declutter link is unchanged).
-- Otherwise the link is returned as it is: never another order's id, at worst today's tab link.
-- The app (src/components/declutter/useLinkedOrder.ts) scrolls to that order's card and opens it.
--
-- RESTATED FROM: declutter_notify_strict in 20261030133115_declutter_notice_links_one_format.sql (its newest
-- CREATE on origin/main and on every open land/wip branch, checked 2026-10-31). The one change is the v_link line,
-- marked "BUY-30". Grants as before: service_role only. The helper is not a definer (it runs inside
-- declutter_notify_strict, which is) and is executable by service_role only.
-- MONEY: none. Notices already sent keep their link.
-- REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/declutterNoticesOpenTheOrder.pglite.mjs (3x; red with NEW_MIGRATION=skip).

CREATE OR REPLACE FUNCTION public.declutter_notice_order_link(p_user uuid, p_other uuid, p_link text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref text := NULLIF(current_setting('declutter.notice_order', true), '');
  v_tab text;
BEGIN
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

CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  -- DC-17: one link format for the seller's and buyer's notices (?tab=selling / ?tab=buying).
  -- BUY-30: and the order it is about, when it is this member's order with this counterpart.
  v_link text := public.declutter_notice_order_link(p_user, p_other, public.declutter_notice_link(p_link));
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
  -- The item is named first (20261028191646), so two orders' notices differ.
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, v_link), p_title,
          public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;
