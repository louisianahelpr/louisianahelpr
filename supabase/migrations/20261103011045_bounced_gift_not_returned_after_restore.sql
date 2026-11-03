-- Q2077 (lh-money-escrow delta review of the Q1971 merge at dcfde9884, #2): a
-- gift could be given back twice for one job.
--
-- restore_gift_card_for_job (a cancel's refund path) gives a job's gift back by
-- MINTING a new row (restored_from_job_id = the job) and leaves the original
-- 'redeemed' on the job. return_bounced_gift_card (a bounced bank debit) puts
-- the ORIGINAL back to 'sent' and never looked for that minted row. A job that
-- reached both (a poster-cancelled unhired job still cancelled/escrow, whose
-- restore ran, then a bank failure reaching the gift return through
-- cancel_job_after_failed_bank_payment's not_hired answer) left the poster
-- holding the gift twice. Prod exposure at the review: 0.
--
-- The fix: once the gift row is found, a job that already has a minted
-- replacement answers 'already_restored' and writes nothing. stripe-webhook's
-- paymentIntentPaymentFailed maps it to "nothing to do" (no page): the poster
-- already has the gift back.
--
-- Restated VERBATIM from prod's live definition (pg_get_functiondef read
-- 2026-11-02 ~7:20 PM CT, md5 6320407b16c9fd637b405af3725ce17d; the body is
-- 20261017074500's). The only change is the Q2077 block. Grants restated as
-- prod has them: postgres + service_role only.
--
-- Guard: src/test/bouncedGiftNotReturnedAfterRestore.test.ts; PGlite proof
-- src/test/pglite/bouncedGiftNotReturnedAfterRestore.pglite.mjs.

CREATE OR REPLACE FUNCTION public.return_bounced_gift_card(p_job_id uuid, p_gift_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Q2077: restore_gift_card_for_job already gave this job's gift back as a
  -- new row and left this one 'redeemed' on the job. Putting this one back
  -- too would give the poster the gift twice.
  IF EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = p_job_id) THEN
    RETURN jsonb_build_object('outcome', 'already_restored', 'credit_id', p_gift_card_id);
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
$function$;

REVOKE ALL ON FUNCTION public.return_bounced_gift_card(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_bounced_gift_card(uuid, uuid) TO service_role;
