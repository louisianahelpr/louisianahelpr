-- Declutter seed boundary (Cowork design audit 2026-10-20, item D1).
--
-- Measured on prod 2026-10-20 03:40Z: every 'live' declutter_items row (5) and
-- every 'pending_review' one (4) belongs to a test account ("Fixture rocking
-- chair [E2E-PRODAUDIT]", "Payout proof lamp"), all is_seed = true, and the
-- owner (an admin, not a test account) saw them on Browse. The items read
-- policy asked the 'declutter' switch and the banned-seller rule but never the
-- launch switch that hides test rows from discovery everywhere else
-- (open_jobs_browse: `NOT is_seed OR NOT seed_hidden_in_discovery()`).
--
-- Every Declutter read path a buyer has is this one table under RLS: Browse
-- (fetchLiveItems), the item page (fetchItem), "More from this seller"
-- (fetchSellerItems), "Similar items" (fetchSimilarItems), the moving-sale
-- page, the search box (it filters the Browse rows client-side), and the
-- photos (their policy is EXISTS over this table, so it inherits). One clause
-- here covers all of them.
--
-- Kept: the seller always reads their own listings (first branch); a test
-- account still sees test listings (seed_hidden_in_discovery's carve-out, so
-- the nightly two-account journeys keep working); with the launch switch off
-- nothing changes. Admins are NOT carved out, same as jobs discovery: the
-- owner browses as an admin and must see what the public sees. The admin
-- review queue reads through declutter_admin_pending_items (SECURITY DEFINER),
-- not this policy, so it is unaffected.
--
-- Replay-safe: DROP POLICY IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION. Guard:
-- src/test/declutterSeedBoundary.test.ts. PGlite proof:
-- src/test/pglite/declutterSeedBoundary.pglite.mjs (applied 3x).

DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT public.declutter_seller_hidden(seller_id)
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
  );

-- ---------------------------------------------------------------------------
-- 2. The WRITE side of the same boundary (lh-money-escrow review of this
-- migration, 2026-10-20): Buy now and Make an offer lock the item through
-- declutter_lock_buyable_item (SECURITY DEFINER, so the policy above never
-- applies), which did not ask is_seed. A real member holding a test item's id
-- (an old link, a notification) could reserve it and pay real money on Stripe
-- live for a fixture. Hidden from you = not found for you, the same refusal a
-- hidden (banned) seller's item gets. Restated from the live definition
-- (pg_get_functiondef, 2026-10-20) with the one added condition; both callers
-- (declutter_buy_now, declutter_make_offer) pass p_buyer = auth.uid(), the
-- caller seed_hidden_in_discovery() asks about.
CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_mode text;
  v_seed boolean;
BEGIN
  SELECT i.seller_id, i.current_price_cents, i.title, i.status, i.sale_mode, i.is_seed
    INTO o_seller_id, o_price_cents, o_title, v_status, v_mode, v_seed
    FROM public.declutter_items i
   WHERE i.id = p_item_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(o_seller_id, p_buyer)
     OR public.declutter_seller_out(o_seller_id)
     OR (v_seed AND public.seed_hidden_in_discovery()) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o_seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = p_buyer) THEN
    RAISE EXCEPTION 'card_required'
      USING ERRCODE = '42501', HINT = 'Save a card first. It is never charged until you check out.';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) TO service_role;
