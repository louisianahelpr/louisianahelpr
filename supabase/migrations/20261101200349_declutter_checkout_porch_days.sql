-- B110 leftover 2 (lead 11-01): checkout's porch window chips came from the seller's pickup times only. For a seller
-- with no saved porch place, the server keeps a porch pickup to the seller's PORCH days (declutter_order_slot_in_windows
-- via declutter_order_is_porch_day, 20261031171727), so a chip on a pickup-time day that is not a porch day was
-- refused at Pay ("Pick a time inside the seller's pickup times").
--
-- declutter_checkout_porch_days(p_seller_id): the weekdays (0 = Sunday .. 6) that are porch days for that seller,
-- by the server's own rule (declutter_is_porch_day: the seller's porch days, else the days with pickup times). Asked
-- only by a buyer who holds a line from that seller in their cart now (declutter_is_porch_day is internal because
-- it would tell anyone a seller's days); anyone else gets an empty list. MONEY: none. REPLAY-SAFE: CREATE OR REPLACE,
-- grants by role name. Proof: src/test/pglite/declutterCheckoutPorchDays.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).
CREATE OR REPLACE FUNCTION public.declutter_checkout_porch_days(p_seller_id uuid)
RETURNS smallint[]
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
  IF p_seller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.declutter_cart_items c
     WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart') THEN
    RETURN ARRAY[]::smallint[];
  END IF;
  RETURN COALESCE((SELECT array_agg(d ORDER BY d) FROM generate_series(0, 6) AS g(d)
                    WHERE public.declutter_is_porch_day(p_seller_id, d::smallint)), ARRAY[]::smallint[])::smallint[];
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_porch_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_porch_days(uuid) TO authenticated, service_role;
