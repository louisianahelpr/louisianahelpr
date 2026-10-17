-- Q1876: give back the gift card an ACH checkout consumed when its bank debit
-- bounces.
--
-- checkoutSessionCompleted flips a reserved gift to 'redeemed' when a gift
-- shortfall Checkout Session completes. For a bank (ACH) payment that is days
-- BEFORE the debit settles. When the debit then fails, paymentIntentPaymentFailed
-- marks the job 'failed' and clears its session, so the job was never funded,
-- yet the gift stayed 'redeemed' on it and the recipient lost it.
--
-- Why not restore_gift_card_for_job (lh-money-escrow review of 6b06413c7, #1):
-- that MINTS a replacement row stamped restored_from_job_id, which is unique per
-- job. A failed job stays fundable, so after a re-fund with the replacement the
-- gift could never be returned again ('already_restored'), and a card re-fund
-- would leave the old 'redeemed' row counted as gift escrow by release-payout
-- and execute-dispute-split. Here the SAME gift row is put back exactly as it
-- was before it was reserved: status 'sent', no job, not redeemed.
--
-- Gates (all under the job's row lock, job before gift, the redeem_gift_card
-- lock order):
--   * the job's payment FAILED (payment_status 'failed', which the webhook
--     writes in the same handler before it calls this): never a state no one
--     has looked at, even for a call made by hand (lh-money-escrow re-review
--     of 2cd90f553, nit 3);
--   * no checkout is open on it (stripe_session_id null): an open one may be
--     about to fund it;
--   * nothing was ever paid out for it (no payout_transfers row).
-- Zero rows on the gift = already returned (or never consumed here): the
-- caller treats 'not_consumed' as done, so a webhook redelivery is a no-op.
-- Service role only.

CREATE OR REPLACE FUNCTION public.return_bounced_gift_card(p_job_id uuid, p_gift_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job      record;
  v_credit   record;
BEGIN
  IF p_job_id IS NULL OR p_gift_card_id IS NULL THEN
    RAISE EXCEPTION 'p_job_id and p_gift_card_id are required' USING errcode = '22023';
  END IF;

  SELECT id, payment_status, stripe_session_id
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;

  -- The gift first, so a call for a gift this job never consumed (a reserved
  -- shortfall gift behind a declined card, a gift already returned) answers
  -- 'not_consumed' and never pages ops about the job's gates.
  SELECT id INTO v_credit
    FROM public.gift_cards
   WHERE id = p_gift_card_id
     AND job_id = p_job_id
     AND status = 'redeemed'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_consumed', 'credit_id', p_gift_card_id);
  END IF;

  IF v_job.payment_status IS DISTINCT FROM 'failed' THEN
    RETURN jsonb_build_object('outcome', 'job_not_failed', 'job_payment_status', v_job.payment_status);
  END IF;
  IF v_job.stripe_session_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'checkout_open');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt WHERE pt.job_id = p_job_id) THEN
    RETURN jsonb_build_object('outcome', 'paid_out');
  END IF;

  UPDATE public.gift_cards
     SET status      = 'sent',
         job_id      = NULL,
         redeemed_at = NULL,
         -- The same floor restore_gift_card_for_job gives a returned gift: the
         -- recipient gets at least 90 more days to use it.
         expires_at  = greatest(coalesce(expires_at, now() + interval '90 days'),
                                now() + interval '90 days')
   WHERE id = p_gift_card_id
     AND job_id = p_job_id
     AND status = 'redeemed'
  RETURNING id, recipient_id, amount, payment_status INTO v_credit;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_consumed', 'credit_id', p_gift_card_id);
  END IF;

  RETURN jsonb_build_object(
    'outcome',       'returned',
    'credit_id',     v_credit.id,
    'recipient_id',  v_credit.recipient_id,
    'restore_cents', round(v_credit.amount * 100)::int,
    -- 'refunded' when the donation behind the gift went back to the donor:
    -- the row is back but redeem_gift_card will refuse it, so the caller must
    -- not tell the recipient it is spendable.
    'payment_status', v_credit.payment_status
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.return_bounced_gift_card(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_bounced_gift_card(uuid, uuid) TO service_role;
