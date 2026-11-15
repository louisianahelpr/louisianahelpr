-- Declutter "My orders" in one read (builder 1, 2026-11-15; handoff builder4b-1115 section 1b).
--
-- The Buying and Selling order lists asked the server once per order and per fact: declutter_my_handover,
-- declutter_order_problem, declutter_refund_request_view and the order row for the other person's id. For the
-- poster-e2e test account's 11 orders that was about 77 requests on one /declutter?tab=buying load (the
-- abuse-journeys request budget, 5.2 against 3.6).
--
-- declutter_my_order_cards(ids) answers all of them in one call, for the caller's OWN orders only:
--   * an id the caller is not the buyer or the seller of is left out (never an error that says it exists);
--   * admins get nothing extra here: their reads stay on the per-order functions;
--   * each part is the per-order function's own answer (called here, so the shape and its rules can never drift):
--       handover  declutter_my_handover(id), only for a paid or handed-over order (it refuses any other status);
--       problem   declutter_order_problem(id) (NULL when the order has none);
--       refund    declutter_refund_request_view(id), only while the declutter_refund_requests switch is on for the
--                 caller (that function starts with require_feature);
--       other_id  the other side's user id, as the order row both sides may read already gives it.
-- STABLE (a read: the press sweep lets only STABLE/IMMUTABLE RPCs through, myReadRpcsAreStable), at most 200 ids.

CREATE OR REPLACE FUNCTION public.declutter_my_order_cards(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_refunds boolean;
  o record;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_order_ids), 0) > 200 THEN
    RAISE EXCEPTION 'too_many_orders' USING ERRCODE = '22023';
  END IF;
  v_refunds := COALESCE(public.feature_enabled_for('declutter_refund_requests'), false);
  FOR o IN
    SELECT x.id, x.buyer_id, x.seller_id, x.status
      FROM public.declutter_orders x
     WHERE x.id = ANY (COALESCE(p_order_ids, '{}'::uuid[]))
       AND public.declutter_order_side(x.buyer_id, x.seller_id, v_uid) IS NOT NULL
     ORDER BY x.id
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'order_id', o.id,
      'other_id', CASE WHEN o.buyer_id = v_uid THEN o.seller_id ELSE o.buyer_id END,
      'handover', CASE WHEN o.status IN ('paid', 'handed_over') THEN public.declutter_my_handover(o.id) END,
      'problem', public.declutter_order_problem(o.id),
      'refund', CASE WHEN v_refunds THEN public.declutter_refund_request_view(o.id) END));
  END LOOP;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_order_cards(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_order_cards(uuid[]) TO authenticated, service_role;
