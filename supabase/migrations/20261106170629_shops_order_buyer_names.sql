-- Q2104 (NOT-LAUNCHED Shops; audit 11-05 M6): the Shop dashboard says who ordered. Shops stays behind its switch
-- (testers).
-- Before: shop_orders.buyer_id was the only buyer field the shop could read, so /shops/dashboard showed "New order"
-- with no name, and a maker could not tell who to hand the order to.
-- What this adds: shops_my_order_buyer_names(order ids) -> (order_id, first_name), ONE call for the dashboard's list.
--   - Only orders of the caller's own shop (seller_id = the caller); any other id is skipped, never an error, so the
--     answer says nothing about orders that are not theirs.
--   - The buyer's FIRST name only (the shop chat's rule, 20261105185006: never a full name or an id), 'A shopper'
--     when the profile has none.
--   - Nothing for a pair that has blocked each other either way, and nothing for an order whose buyer deleted their
--     account (buyer_id NULL).
--   - At most 100 ids a call (the dashboard reads its newest 100 orders).
-- AUTHZ: one new SECURITY DEFINER read (lh-authz-rls). MONEY: no.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated.
-- Proof: src/test/pglite/shopsOrderBuyerNames.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shops_my_order_buyer_names(p_order_ids uuid[])
RETURNS TABLE (order_id uuid, first_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_order_ids) > 100 THEN
    RAISE EXCEPTION 'too_many_orders' USING ERRCODE = '22023', HINT = 'Ask for at most 100 orders at a time.';
  END IF;
  RETURN QUERY
    SELECT o.id,
           COALESCE(NULLIF(split_part(btrim(COALESCE(p.full_name, '')), ' ', 1), ''), 'A shopper')
      FROM public.shop_orders o
      LEFT JOIN public.profiles p ON p.user_id = o.buyer_id
     WHERE o.id = ANY (p_order_ids)
       AND o.seller_id = v_uid
       AND o.buyer_id IS NOT NULL
       AND NOT COALESCE(public.are_users_blocked(v_uid, o.buyer_id), true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_order_buyer_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_order_buyer_names(uuid[]) TO authenticated, service_role;
