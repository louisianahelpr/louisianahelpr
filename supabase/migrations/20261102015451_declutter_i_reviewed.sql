-- A3-76 (audit 11-01): "Leave a review" came back on a second device, and the filled form failed with already_reviewed:
-- the reviewed mark lived in one device's localStorage because members cannot read declutter_reviews (service role only,
-- the blind rule). declutter_i_reviewed(order) answers ONE boolean: has the CALLER's side of this order left its review.
-- It says nothing about the other side's review (the blind rule holds), FALSE for an order the caller is not on (no
-- oracle: the same answer as an order that does not exist), and refuses signed-out callers. Read-only.
-- Applied 3x in PGlite (src/test/pglite/declutterIReviewed.pglite.mjs).

CREATE OR REPLACE FUNCTION public.declutter_i_reviewed(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) INTO v_side
    FROM public.declutter_orders o WHERE o.id = p_order_id;
  IF v_side IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.declutter_reviews r WHERE r.order_id = p_order_id AND r.reviewer_side = v_side);
END
$fn$;

REVOKE ALL ON FUNCTION public.declutter_i_reviewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_i_reviewed(uuid) TO authenticated, service_role;
