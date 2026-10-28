-- "N sold" on a seller's profile (lead 2026-10-28, for builder 2's DeclutterProfileSection).
--
-- declutter_seller_sold_count(p_seller_id) (new, read-only): how many items the seller has sold through
-- Declutter and handed over: cart lines of the seller's orders that reached 'handed_over', priced above $0
-- (a free giveaway is not a sale). One integer, nothing else: no buyers, amounts, dates or item names.
-- Any signed-in member, behind the 'declutter' switch (it is a Declutter number). A test (is_seed) seller's
-- count reads 0 to anyone the seed switch hides test accounts from (seed_hidden_for, Q137), so a fixture never
-- shows a real member a sales record.
-- STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC, anon; GRANT authenticated.
-- Proof: src/test/pglite/declutterSellerSoldCount.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: CREATE OR REPLACE (new function).

CREATE OR REPLACE FUNCTION public.declutter_seller_sold_count(p_seller_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_seller_id IS NULL THEN
    RETURN 0;
  END IF;
  IF COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = p_seller_id), false)
     AND public.seed_hidden_for(v_uid) THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(*)::integer
            FROM public.declutter_orders o
            JOIN public.declutter_cart_items c ON c.order_id = o.id
           WHERE o.seller_id = p_seller_id AND o.status = 'handed_over' AND c.price_cents > 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_sold_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_sold_count(uuid) TO authenticated, service_role;
