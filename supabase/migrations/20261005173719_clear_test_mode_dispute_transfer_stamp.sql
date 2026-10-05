-- Q1280: a decided dispute whose split execute-dispute-split REFUSED because
-- its stamped transfer (disputes.execution_transfer_id) is a Stripe TEST-mode
-- object (409 "a prior execution ran in Stripe test mode; nothing moved now,
-- decide by hand") had no way out: rpc_supersede_dispute_decision reads any
-- execution_transfer_id as "money moved" and refuses, and every retry of the
-- split refuses again on the same stamp.
--
-- The hand path: an admin who has checked the stamp in Stripe (test mode)
-- clears it here, naming the exact transfer id (compare-and-set), with a
-- reason that goes in admin_audit_log. After that the decision can be
-- superseded (rpc_supersede_dispute_decision). Retry settlement only helps a
-- job paid wholly by gift card: a card-paid job whose escrow is itself a
-- test-mode object is refused again at the split's escrow check, so the new
-- decision is closed with rpc_settle_dispute_without_payment. This clears the
-- TRANSFER stamp only; a test-mode refund stamp (execution_refund_id) still
-- blocks supersede (lh-authz-rls review 2026-10-05, filed as its own item).
--
-- Why this cannot pay twice if the admin is wrong and the id was LIVE money:
-- execute-dispute-split's resume path asks Stripe's own transfer list for this
-- job's transfer_group and matches metadata.dispute_id before it pays, so a
-- real transfer is recovered and never repeated (the RPC only clears a row
-- whose execution_status is 'failed' or 'executing', so the next run IS a
-- resume and that lookup runs); and this RPC refuses while
-- any payout_transfers row carries the id (a ledger leg is reconciled by
-- hand, not cleared), or a settlement claim is live or stamped.
--
-- Lock order and gates mirror rpc_supersede_dispute_decision (jobs, then
-- disputes; admin only; not a party; escrow still held).

CREATE OR REPLACE FUNCTION public.rpc_clear_test_mode_dispute_stamp(
  _dispute_id uuid,
  _transfer_id text,
  _reason text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id_lookup uuid;
  _payment_status text;
  _customer uuid;
  _helper uuid;
  _d record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'clear_stamp_needs_reason'
      USING HINT = 'Say how you checked that this transfer is a Stripe test-mode object; it goes in the audit log.';
  END IF;
  IF length(btrim(COALESCE(_transfer_id, ''))) = 0 THEN
    RAISE EXCEPTION 'clear_stamp_needs_transfer_id';
  END IF;

  SELECT job_id INTO _job_id_lookup FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT payment_status, customer_id, helper_id
    INTO _payment_status, _customer, _helper
    FROM public.jobs
   WHERE id = _job_id_lookup
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, job_id, status, execution_status, execution_started_at, execution_error,
         execution_transfer_id, execution_refund_id
    INTO _d
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  -- Only a run that started (failed or died executing) can carry a stamp, and
  -- only then is the next run a resume that re-reads Stripe before paying.
  IF _d.status IS DISTINCT FROM 'decided'
     OR _d.execution_status IS NULL
     OR _d.execution_status NOT IN ('failed', 'executing') THEN
    RAISE EXCEPTION 'clear_stamp_not_decided'
      USING HINT = 'Only a decided dispute whose split has not executed carries a stamp to clear.';
  END IF;
  IF _uid = _customer OR _uid = _helper THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to do this.';
  END IF;
  -- Compare-and-set: the admin names the exact stamp they checked.
  IF _d.execution_transfer_id IS DISTINCT FROM btrim(_transfer_id) THEN
    RAISE EXCEPTION 'clear_stamp_mismatch'
      USING HINT = 'The dispute does not carry that transfer id (it may have changed); re-read it.';
  END IF;
  IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'clear_stamp_escrow_not_held';
  END IF;
  IF _d.execution_status = 'executing'
     AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _d.job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;
  -- A ledger row on this id is a leg the platform recorded as moved: that is
  -- reconciled by hand against Stripe, never cleared from here.
  IF EXISTS (SELECT 1 FROM public.payout_transfers t
              WHERE t.job_id = _d.job_id AND t.stripe_transfer_id = _d.execution_transfer_id) THEN
    RAISE EXCEPTION 'clear_stamp_ledger_has_transfer'
      USING HINT = 'payout_transfers records this transfer; reconcile it by hand.';
  END IF;

  -- The trail first, not wrapped.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _uid,
    'clear_test_mode_dispute_stamp',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'cleared_transfer_id', _d.execution_transfer_id,
      'reason', btrim(_reason),
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'payment_status', _payment_status
    )
  );

  UPDATE public.disputes
     SET execution_transfer_id = NULL,
         execution_error = left('test-mode transfer stamp ' || _d.execution_transfer_id
                                || ' cleared by an admin: ' || btrim(_reason), 1000)
   WHERE id = _d.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_stamp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_clear_test_mode_dispute_stamp(uuid, text, text) TO authenticated, service_role;
