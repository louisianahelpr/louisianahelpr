-- Q450: a FULL refund made outside the dispute split (the Stripe Dashboard) on
-- a decided-but-unexecuted dispute left that dispute pending forever.
--
-- rpc_decide_dispute records the split and stamps execution_status='pending';
-- execute-dispute-split moves the money later, and its first attempt runs only
-- from a job whose payment_status is escrow/payout_pending. A full refund
-- issued from the Stripe Dashboard in between fires charge.refunded, whose
-- compare-and-set (Q343) moves the job to 'refunded'. From then on the split
-- refuses the job (a first attempt wants escrow/payout_pending; a resume
-- refuses over a refund it did not make), rpc_supersede_dispute_decision
-- refuses (escrow not held) and rpc_settle_dispute_without_payment refuses (a
-- PaymentIntent is on file). The decision had nothing left to split and no
-- terminal state, and the unsettled-dispute detectors kept paging.
--
-- settle_dispute_by_external_refund is the terminal close for exactly that
-- case, called by the stripe-webhook's charge.refunded handler only when every
-- live refund on the charge came from OUTSIDE the split (each refund
-- execute-dispute-split creates carries metadata.dispute_id; its own 100/0
-- split also fires charge.refunded and closes its own record). It records the
-- settlement as executed, with the refunded amount as what the poster got back
-- and nothing to the Helpr, and says why in execution_error (which also keeps
-- sweep_disputes_closed_without_payment quiet). It closes ONLY when nothing
-- else is owed or in flight:
--   * 'busy' (the webhook throws, so Stripe redelivers once it ends): a split
--     run executing inside the claim TTL, or a live settlement claim;
--   * 'needs_human' (the webhook pages ops and tells the admins):
--       - the job is not payment_status='refunded' (the flip this assumes);
--       - the refund did not return the whole charge (_refunded_cents <
--         _charge_cents): the rest is still owed under the decision;
--       - a gift card funded part of the job: the refund returned only the
--         card's part, and the decision still decides the gift's;
--       - a dead claim stamped at a money step (it may have moved money);
--       - money a split already moved for the job (a split leg id, a
--         payout_transfers row pending/paid/reversed, a 'dispute_split'
--         payment_refunds row, a gift restored from it).
-- No decided dispute awaiting its split answers 'no_unsettled_dispute'. A crew
-- decision (execution_status 'crew_fanout', 20260927012240) is not this
-- function's: process-scheduled-payouts' fan-out settles it, and its refunds
-- carry no dispute metadata.
--
-- The job row is not touched: payment_status stays 'refunded' (the truth).
--
-- Service role only (the webhook). Lock order jobs -> disputes, as
-- rpc_decide_dispute, claim_dispute_settlement and
-- settle_dispute_by_chargeback take it.
--
-- Replay-safe: CREATE OR REPLACE; tables read only on some deploys are guarded
-- with to_regclass at call time.

CREATE OR REPLACE FUNCTION public.settle_dispute_by_external_refund(
  _job_id uuid,
  _stripe_charge_id text,
  _refunded_cents bigint,
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
  IF _job_id IS NULL OR _stripe_charge_id IS NULL OR btrim(_stripe_charge_id) = '' THEN
    RAISE EXCEPTION 'job and stripe charge id required';
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
     AND (execution_status IS NULL OR execution_status IN ('pending', 'executing', 'failed'))
   ORDER BY decided_at DESC NULLS LAST
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_unsettled_dispute');
  END IF;

  -- A run in flight first: its own outcome (executed, or failed with a
  -- reason) is what the redelivery must judge, so nothing is decided now.
  IF (_d.execution_status = 'executing'
      AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl())
     OR (to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.dispute_settlement_claims c
           WHERE c.job_id = _job_id
             AND c.claimed_at >= now() - public.dispute_settlement_claim_ttl()))
  THEN
    RETURN jsonb_build_object('outcome', 'busy', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'a settlement of this job is running right now');
  END IF;

  IF _job.payment_status IS DISTINCT FROM 'refunded' THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'job payment_status is ' || COALESCE(_job.payment_status, 'null') || ', not refunded');
  END IF;

  IF _refunded_cents IS NULL OR _charge_cents IS NULL OR _charge_cents <= 0
     OR _refunded_cents < _charge_cents THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'the refund returned ' || COALESCE(_refunded_cents::text, '?') || ' of '
                || COALESCE(_charge_cents::text, '?') || ' cents; the rest is still owed under the decision');
  END IF;

  IF to_regclass('public.gift_cards') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.gift_cards g
        WHERE g.job_id = _job_id AND g.status IN ('redeemed', 'reserved')) THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'a gift card funded part of this job; the refund returned only the card part, and the decision still splits the gift');
  END IF;

  IF to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.dispute_settlement_claims c
        WHERE c.job_id = _job_id AND c.money_step_at IS NOT NULL) THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'an earlier settlement of this job stopped part-way after a money step');
  END IF;

  _moved := _d.execution_transfer_id IS NOT NULL
         OR _d.execution_refund_id IS NOT NULL
         OR (to_regclass('public.payout_transfers') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.payout_transfers t
               WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid', 'reversed')))
         OR (to_regclass('public.payment_refunds') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.payment_refunds r
               WHERE r.job_id = _job_id AND r.source = 'dispute_split'));
  IF NOT _moved AND to_regclass('public.gift_cards') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _job_id);
  END IF;
  IF _moved THEN
    RETURN jsonb_build_object('outcome', 'needs_human', 'dispute_id', _d.id,
      'payout_split', _d.payout_split,
      'reason', 'a split already moved money for this job; reconcile against Stripe by hand');
  END IF;

  UPDATE public.disputes
     SET execution_status       = 'executed',
         executed_at            = now(),
         execution_transfer_id  = NULL,
         execution_refund_id    = NULL,
         execution_helper_cents = 0,
         execution_refund_cents = LEAST(_refunded_cents, _charge_cents)::int,
         execution_error        = 'closed by a full refund made outside the split (' || _stripe_charge_id
                                  || '): the whole charge went back to the card holder, so no escrow was left to split'
   WHERE id = _d.id
     AND status = 'decided'
     AND (execution_status IS NULL OR execution_status IN ('pending', 'executing', 'failed'));
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> 1 THEN
    RETURN jsonb_build_object('outcome', 'no_unsettled_dispute');
  END IF;

  RETURN jsonb_build_object('outcome', 'closed', 'dispute_id', _d.id, 'payout_split', _d.payout_split);
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_dispute_by_external_refund(uuid, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dispute_by_external_refund(uuid, text, bigint, bigint) TO service_role;
