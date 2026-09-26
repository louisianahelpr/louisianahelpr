-- Q342: a LOST card chargeback on a decided-but-unexecuted dispute left the
-- dispute pending forever.
--
-- rpc_decide_dispute records the split and stamps execution_status='pending';
-- execute-dispute-split moves the money later, and only from a job whose
-- payment_status is escrow/payout_pending (a first attempt). A card chargeback
-- filed in between flips the job to payment_status='chargeback'
-- (chargeDisputeCreated). When the bank then rules for the cardholder
-- (charge.dispute.closed, status 'lost') the charged money is gone for good:
-- there is nothing left in escrow for the split to transfer or refund. But
-- nothing closed the record. execute-dispute-split refuses a 'chargeback' job,
-- rpc_supersede_dispute_decision refuses (escrow not held), and
-- rpc_settle_dispute_without_payment refuses (a PaymentIntent is on file), so
-- the dispute sat decided/'pending' with no terminal state and kept paging the
-- unsettled-dispute detectors.
--
-- settle_dispute_by_chargeback is the terminal close for exactly that case,
-- called by the stripe-webhook's lost branch. It records the settlement as
-- executed with ZERO cents moved by the platform and says why in
-- execution_error (the reason is what keeps sweep_disputes_closed_without_payment
-- quiet, as for the no-payment close). It closes ONLY when nothing else is owed
-- or in flight, and otherwise answers 'needs_human' so the webhook pages ops:
--   * the job is not payment_status='chargeback' (the block this close assumes);
--   * the bank did not take back the whole charge (_disputed_cents <
--     _charge_cents): the rest is still on the platform and the split must
--     still move it, by hand;
--   * a gift card funded part of the job: that half was never charged, so no
--     chargeback returned it, and the decision still owes it;
--   * a split run is live or stopped part-way (execution 'executing' inside the
--     TTL, a live or money-stamped settlement claim);
--   * money already moved for the job (a split leg id, a payout_transfers row
--     pending/paid/reversed, a payment_refunds row, a gift restored from it):
--     the same test rpc_supersede_dispute_decision makes.
-- An internal dispute still OPEN on the charged-back job answers 'needs_human'
-- (rpc_decide_dispute refuses a 'chargeback' job, 20260926034348). No decided-
-- unexecuted or open dispute answers 'no_unsettled_dispute'.
--
-- The job row is not touched: payment_status stays 'chargeback' (the truth),
-- and no payer pays a 'chargeback' job.
--
-- Service role only (the webhook). Lock order jobs -> disputes, as
-- rpc_decide_dispute and claim_dispute_settlement take it.
--
-- Replay-safe: CREATE OR REPLACE; tables read only on some deploys are guarded
-- with to_regclass at call time.

CREATE OR REPLACE FUNCTION public.settle_dispute_by_chargeback(
  _job_id uuid,
  _stripe_dispute_id text,
  _disputed_cents bigint,
  _charge_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _job record;
  _d record;
  _moved boolean;
  _written int;
BEGIN
  IF _job_id IS NULL OR _stripe_dispute_id IS NULL OR btrim(_stripe_dispute_id) = '' THEN
    RAISE EXCEPTION 'job and stripe dispute id required';
  END IF;

  SELECT id, payment_status
    INTO _job
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_unsettled_dispute', 'reason', 'job not found');
  END IF;

  SELECT id, status, execution_status, execution_started_at,
         execution_transfer_id, execution_refund_id, payout_split
    INTO _d
    FROM public.disputes
   WHERE job_id = _job_id
     AND status = 'decided'
     AND execution_status IS DISTINCT FROM 'executed'
   ORDER BY decided_at DESC NULLS LAST
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    -- An internal dispute still OPEN on a charged-back job can never be
    -- decided and executed (rpc_decide_dispute refuses 'chargeback'), so it is
    -- a human's, not silence.
    IF _job.payment_status = 'chargeback' AND EXISTS (
         SELECT 1 FROM public.disputes o WHERE o.job_id = _job_id AND o.status = 'open') THEN
      RETURN jsonb_build_object('outcome', 'needs_human',
        'dispute_id', (SELECT o.id FROM public.disputes o WHERE o.job_id = _job_id AND o.status = 'open' LIMIT 1),
        'reason', 'an internal dispute is still open on this charged-back job; it cannot be decided or executed now');
    END IF;
    RETURN jsonb_build_object('outcome', 'no_unsettled_dispute');
  END IF;

  IF _job.payment_status IS DISTINCT FROM 'chargeback' THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'job payment_status is ' || COALESCE(_job.payment_status, 'null') || ', not chargeback');
  END IF;

  IF _disputed_cents IS NULL OR _charge_cents IS NULL OR _charge_cents <= 0
     OR _disputed_cents < _charge_cents THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'the bank took back ' || COALESCE(_disputed_cents::text, '?') || ' of '
                || COALESCE(_charge_cents::text, '?') || ' cents; the rest is still owed under the decision');
  END IF;

  IF to_regclass('public.gift_cards') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.gift_cards g
        WHERE g.job_id = _job_id AND g.status IN ('redeemed', 'reserved')) THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'a gift card funded part of this job; no chargeback returned that half');
  END IF;

  IF (_d.execution_status = 'executing'
      AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl())
     OR (to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.dispute_settlement_claims c
           WHERE c.job_id = _job_id
             AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
                  OR c.money_step_at IS NOT NULL)))
  THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'a settlement of this job is running or stopped part-way');
  END IF;

  _moved := _d.execution_transfer_id IS NOT NULL
         OR _d.execution_refund_id IS NOT NULL
         OR (to_regclass('public.payout_transfers') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.payout_transfers t
               WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid', 'reversed')))
         OR (to_regclass('public.payment_refunds') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job_id));
  IF NOT _moved AND to_regclass('public.gift_cards') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _job_id);
  END IF;
  IF _moved THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'money already moved for this job; reconcile against Stripe by hand');
  END IF;

  UPDATE public.disputes
     SET execution_status       = 'executed',
         executed_at            = now(),
         execution_transfer_id  = NULL,
         execution_refund_id    = NULL,
         execution_helper_cents = 0,
         execution_refund_cents = 0,
         execution_error        = 'closed by a lost card chargeback (' || _stripe_dispute_id
                                  || '): the bank returned the whole charge to the card holder, so no escrow was left to split'
   WHERE id = _d.id
     AND status = 'decided'
     AND execution_status IS DISTINCT FROM 'executed';
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> 1 THEN
    RETURN jsonb_build_object('outcome', 'no_unsettled_dispute');
  END IF;

  RETURN jsonb_build_object('outcome', 'closed', 'dispute_id', _d.id, 'payout_split', _d.payout_split);
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_dispute_by_chargeback(uuid, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dispute_by_chargeback(uuid, text, bigint, bigint) TO service_role;
