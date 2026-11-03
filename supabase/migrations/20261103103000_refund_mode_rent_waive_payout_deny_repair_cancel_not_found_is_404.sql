-- Q2390 packet 24 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for four money-adjacent functions that still raised P0002:
--   declutter_refund_set_mode   (service_role; stripe-webhook stamps the payment's
--                                Stripe mode on a refund row. Its set-once UPDATE
--                                matches no row when the refund is missing, so the
--                                raise leaves nothing written. The webhook throws
--                                on ANY rpc error with only the message, rolls back
--                                its dedupe row and answers 500 so Stripe
--                                redelivers: identical for PT404.)
--   rentals_waive_rent_charge   (landlord waives a rent charge; raise before the UPDATE)
--   admin_deny_payout_hold      (admin denies a payout hold; the UPDATE matched no
--                                row, raise before the audit INSERT)
--   rentals_cancel_request_job  (landlord cancels the request's unpaid job; raise
--                                before the job lock and poster_cancel_job)
-- The app maps the member/admin-facing ones by message (rpcErrorMessage), never
-- by SQLSTATE. No edge function maps these to an HTTP status. None creates an
-- order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_refund_set_mode              20261015042253 610e5fc5304add79eeb95d7397adb2d1
--   rentals_waive_rent_charge              20261019073106 a1292472a62728dd321dc236b4864e43
--   admin_deny_payout_hold                 20261004162921 57aba01479633b457a64b2604d0269a5
--   rentals_cancel_request_job             20261017220911 e8ca3f39f0492fb88b3c3407392c94fa
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (4 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_refund_set_mode(p_refund_id uuid, p_livemode boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mode boolean;
BEGIN
  IF p_livemode IS NULL THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;
  -- Set once: a later call with the other mode is a bug, never a rewrite.
  UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id AND payment_livemode IS NULL;
  SELECT r.payment_livemode INTO v_mode FROM public.declutter_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_mode IS DISTINCT FROM p_livemode THEN
    RAISE EXCEPTION 'refund_mode_conflict' USING ERRCODE = '55000';
  END IF;
  RETURN v_mode;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_refund_set_mode(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_set_mode(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_waive_rent_charge(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_c public.rental_rent_charges%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_c FROM public.rental_rent_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_c.tenancy_id, v_uid) IS DISTINCT FROM 'landlord' THEN
    RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_c.waived_at IS NULL THEN
    UPDATE public.rental_rent_charges SET waived_at = now() WHERE id = p_charge_id;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_waive_rent_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_waive_rent_charge(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_deny_payout_hold(p_helper_id uuid, p_reason text)
RETURNS public.payout_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.payout_holds;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  -- A denial is recorded ON a hold; there is nothing to deny without one.
  UPDATE public.payout_holds h
     SET denied_reason = left(v_reason, 1000),
         denied_by = v_uid,
         denied_at = now()
   WHERE h.helper_id = p_helper_id
  RETURNING h.* INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_payout_hold' USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_uid, 'payout_denied', p_helper_id::text, 'user', jsonb_build_object('reason', v_row.denied_reason));
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_deny_payout_hold(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deny_payout_hold(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_cancel_request_job(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.landlord_id = v_uid AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.jobs j
   WHERE j.id = v_job AND j.customer_id = v_uid AND j.status = 'open'
     AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')
     AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_cancellable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.poster_cancel_job(v_job, 'Rental repair: cancelled unpaid to post again');
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_cancel_request_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_cancel_request_job(uuid) TO authenticated, service_role;

