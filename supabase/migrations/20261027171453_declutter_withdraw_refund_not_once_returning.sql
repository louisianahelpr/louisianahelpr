-- A buyer can no longer withdraw a refund request once the seller agreed to a
-- full refund and the item is on its way back (status 'returning').
-- Restated from 20261026155251 (not yet on prod when written) with only the
-- status check changed.

CREATE OR REPLACE FUNCTION public.declutter_withdraw_refund(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  -- Money review 2026-10-27 (lh-money-escrow + lh-authz-rls, SHOULD-FIX): once the
  -- seller agreed to a full refund ('returning') the buyer may already have
  -- handed the item back; a withdraw then would leave the seller with the item
  -- AND the payout. From 'returning' only the seller's "I got it back" or the
  -- return_by deadline (Louisiana Helpr decides) moves it on.
  IF r.status NOT IN ('open', 'offered') THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  -- A write like any other: a banned or suspended buyer cannot change the request (Q281 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'withdrawn' WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Refund request withdrawn',
    'The buyer took back their refund request. You''re paid when the sale is final, 24 hours after the handover.',
    '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'withdrawn');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_refund(uuid) TO authenticated, service_role;
