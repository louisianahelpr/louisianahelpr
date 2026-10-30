-- DA-6 (Declutter audit 2026-10-30, browse-free REPORT.md): after buying or claiming an item, its buyer opened the
-- item page and was told "This item isn't available." The items read policy lets a member read an item only while it
-- is live or reserved (or as its seller), and a paid or claimed item is 'sold' (then 'completed' after the handover).
-- And declutter_item_pickup_windows answered "not found" as SQLSTATE P0002, which PostgREST sends as HTTP 500.
--
-- 1. Items read policy: restated from 20261021142959_declutter_seller_hidden_column.sql (the newest; equal to the
--    live pg_policies qual read 2026-10-30) with ONE new OR branch: the member holds a PAID cart line for this item
--    (declutter_cart_items.status = 'paid' is set by both declutter_mark_order_paid and declutter_checkout_free,
--    pg_get_functiondef read 2026-10-30). Only the buyer's own line counts (buyer_id = auth.uid()); the cart table's
--    own policy ("the two sides read") references no declutter_items, so there is no policy recursion. The buyer then
--    reads the same columns any member reads (column grants are unchanged), and through the two policies that read
--    "with their item" (declutter_item_photos, declutter_questions) that item's photos and public Q&A. Nothing else.
--    The buyer_id test is also enforced by the cart table's own read policy (a member sees only lines they are a side
--    of), so it is a second lock that does not depend on that policy. The lookup is covered by the unique index
--    declutter_cart_one_active (item_id) WHERE status IN ('in_cart', 'paid').
-- 2. declutter_item_pickup_windows: restated from 20261028195840_declutter_pickup_window_reads.sql (equal to the
--    live pg_get_functiondef read 2026-10-30) with only the not-found SQLSTATE changed, P0002 -> PT404 (PostgREST
--    sends a PTnnn SQLSTATE as HTTP nnn). The message stays 'item_not_found', which is what the app reads.
-- Proof: src/test/pglite/declutterBuyerReadsOwnItem.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: DROP POLICY IF EXISTS + CREATE POLICY; CREATE OR REPLACE FUNCTION (same signature and return type).

DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT seller_hidden
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
    OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                WHERE c.item_id = declutter_items.id
                  AND c.buyer_id = (SELECT auth.uid())
                  AND c.status = 'paid')
  );

CREATE OR REPLACE FUNCTION public.declutter_item_pickup_windows(p_item_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT i.seller_id INTO v_seller FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.status IN ('live', 'reserved') AND NOT i.seller_hidden;
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = v_seller
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_pickup_windows(uuid) TO authenticated, service_role;
