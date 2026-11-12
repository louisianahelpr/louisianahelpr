-- F356 follow-up, trades (owner pop-ups 11-11 ~5:00 PM "everywhere"; lead 11-11: the trade list counts): the seller's
-- trade cards (Selling's trade offers and the item page's ItemTradeOffers) name the trader as first name + last initial,
-- "From Ann S.", as the cash offer card (declutter_my_offers.buyer_display, 20261111223500) and the "New trade offer"
-- notice (declutter_offer_swap, 20261111201159) already do. Nothing else: no id, photo or link.
--
-- The trade list reads declutter_swap_offers through PostgREST (src/lib/declutter/trades.ts fetchMyTrades), and a
-- member cannot read another member's profile row, so the names come from one new caller-only read:
--   declutter_my_trade_buyer_names() -> (swap_id, buyer_display)
--   one row per trade offer where the CALLER is the seller, in the seller list's statuses (open, accepted); buyer_display
--   is member_display_name(the buyer's full_name, NULL), NULL for a blank name or a gone profile. Never a row for a
--   trade where the caller is the buyer (the buyer already knows the seller from the listing). Trades have no Wanted
--   path (declutter_swap_offers has no wanted_id), so there is no anonymous case to keep.
-- No test-data rule is added: the read returns names only for rows the seller can already read in declutter_swap_offers
-- (its RLS: buyer_id or seller_id = auth.uid()).
--
-- SECURITY DEFINER (profiles are not readable member to member); STABLE; search_path pinned; authenticated only.
-- Replay-safe: CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/declutterTradeBuyerNames.pglite.mjs. Sensitive: authz (what one member sees of another).

CREATE OR REPLACE FUNCTION public.declutter_my_trade_buyer_names()
RETURNS TABLE(swap_id uuid, buyer_display text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT s.id, public.member_display_name(bp.full_name, NULL)::text
    FROM public.declutter_swap_offers s
    LEFT JOIN public.profiles bp ON bp.user_id = s.buyer_id
   WHERE s.seller_id = (SELECT auth.uid())
     AND s.buyer_id IS DISTINCT FROM (SELECT auth.uid())
     AND s.status IN ('open', 'accepted')
   ORDER BY s.created_at DESC
   LIMIT 200;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_trade_buyer_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_my_trade_buyer_names() TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_my_trade_buyer_names() IS
  'F356 follow-up (owner 11-11): the caller''s own open/accepted trade offers as SELLER, each with the trader''s first name + last initial (member_display_name). Nothing else.';
