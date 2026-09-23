-- Q235: a decided dispute on a job with NO payment on file could never settle,
-- and an admin had no way to close it.
--
-- execute-dispute-split refuses a job with no PaymentIntent (and no checkout
-- session to find one through) and no redeemed gift card: "no payment intent
-- on file — cannot verify or split the escrow", 409, and marks the dispute
-- execution_status='failed'. That refusal is correct: there is no charge to
-- refund or transfer from. But nothing else closes the record, so the dispute
-- sat in Unsettled Settlements forever ("Retry settlement" can only fail the
-- same way), and release-payout's unsettled-dispute blocker kept the job
-- frozen. UnsettledSettlements.tsx is read-only on purpose; the dispute card
-- offered only the retry.
--
-- rpc_settle_dispute_without_payment is the admin's close for exactly that
-- case and no other. It records the settlement as executed with ZERO cents
-- either way, which is the truth when no charge exists, and refuses whenever
-- money could exist:
--   * the job has a stripe_payment_intent_id or a stripe_session_id
--     (execute-dispute-split can find and settle that charge: retry it);
--   * the job has a redeemed or reserved gift card (execute-dispute-split
--     settles a gift-funded escrow without a PaymentIntent);
--   * a settlement claim is live or a dead claim stamped a money step
--     (the same test rpc_decide_dispute makes);
--   * the dispute is not 'decided', or is already 'executed' / 'executing'.
-- An admin who is a party to the job is refused, like rpc_decide_dispute. A
-- written note is required and goes into admin_audit_log in the same
-- transaction (NOT swallowed, unlike the decision's audit row: this note is
-- the only record of why a money record was closed by hand).
--
-- The detector sweep_disputes_closed_without_payment pages on an 'executed'
-- dispute that recorded no money AND no reason while the job still reads
-- escrow/payout_pending. This close writes its reason into execution_error
-- ("closed by an admin, no payment on file: <note>"), so it does not page:
-- the row says why nothing moved. The job row is not touched. No money path
-- can pay it: release-payout refuses a job with no PaymentIntent and no gift
-- card, and process-scheduled-payouts skips any job with disputed_at set.
--
-- Lock order jobs -> disputes, as rpc_decide_dispute and
-- claim_dispute_settlement take it.
--
-- Replay-safe: CREATE OR REPLACE; tables it reads are guarded at call time.

CREATE OR REPLACE FUNCTION public.rpc_settle_dispute_without_payment(_dispute_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _note_clean text := left(NULLIF(btrim(COALESCE(_note, '')), ''), 500);
  _job_id uuid;
  _job record;
  _dispute record;
  _written int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _note_clean IS NULL THEN
    RAISE EXCEPTION 'settle_note_required'
      USING HINT = 'Say why there is no payment to move. It is the only record of this close.';
  END IF;

  SELECT job_id INTO _job_id FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT id, customer_id, helper_id, stripe_payment_intent_id, stripe_session_id
    INTO _job
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, status, execution_status
    INTO _dispute
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _dispute.status IS DISTINCT FROM 'decided' THEN
    RAISE EXCEPTION 'dispute_not_decided'
      USING HINT = 'Only a decided dispute can have its settlement closed.';
  END IF;

  IF _dispute.execution_status = 'executed' THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  IF _uid = _job.customer_id OR _uid = _job.helper_id THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to close its settlement.';
  END IF;

  IF _dispute.execution_status = 'executing'
     OR (to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.dispute_settlement_claims c
           WHERE c.job_id = _job.id
             AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
                  OR c.money_step_at IS NOT NULL)))
  THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;

  IF _job.stripe_payment_intent_id IS NOT NULL
     OR _job.stripe_session_id IS NOT NULL
     OR (to_regclass('public.gift_cards') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.gift_cards g
           WHERE g.job_id = _job.id
             AND g.status IN ('redeemed', 'reserved')))
  THEN
    RAISE EXCEPTION 'dispute_has_payment'
      USING HINT = 'This job has a payment on file, so the split has to move it. Use Retry settlement.';
  END IF;

  UPDATE public.disputes
     SET execution_status       = 'executed',
         executed_at            = now(),
         execution_transfer_id  = NULL,
         execution_refund_id    = NULL,
         execution_helper_cents = 0,
         execution_refund_cents = 0,
         execution_error        = 'closed by an admin, no payment on file: ' || _note_clean
   WHERE id = _dispute_id
     AND status = 'decided'
     AND execution_status IS DISTINCT FROM 'executed';
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> 1 THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    _uid,
    'settle_dispute_without_payment',
    _dispute_id,
    'dispute',
    jsonb_build_object(
      'job_id', _job.id,
      'previous_execution_status', _dispute.execution_status,
      'note', _note_clean
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_settle_dispute_without_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_settle_dispute_without_payment(uuid, text) TO authenticated;
