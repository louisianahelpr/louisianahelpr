-- Q1978 (lead 11-01): a late bank-payment failure that lands while the Helpr's
-- payout is already moving must not cancel or un-escrow the job.
--
-- process-scheduled-payouts and release-payout send the Stripe transfer FIRST
-- and flip the job to 'released' after; execute-dispute-split keeps
-- payment_status 'escrow' under its dispute_settlement_claims row. stripe-webhook
-- (paymentIntentPaymentFailed, 62763c3623) now checks both before it calls this
-- function, but that is read-then-act. This puts the SAME two checks inside the
-- function, under the job's row lock, before anything is decided: any
-- payout_transfers row but a 'failed' one (a claim in flight, a sent or
-- reversed transfer) or a held settlement claim answers 'payout_moving' and
-- writes nothing. The webhook takes its released branch (page, write nothing)
-- on that answer.
--
-- Restated VERBATIM from prod's live definition (pg_get_functiondef read
-- 2026-11-01 ~11:55 PM CT, md5 917e544995f7f1ce5895243c96fb5f68; the repo's
-- 20261017205845 text is stale: 20261025203540 rewrote its poster sentence in
-- place). The only change is the Q1978 block. Grants restated as prod has
-- them: postgres + service_role only.

CREATE OR REPLACE FUNCTION public.cancel_job_after_failed_bank_payment(p_job_id uuid, p_payment_intent_id text, p_gift_card_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_crew boolean;
  v_hired boolean;
  v_told uuid[] := ARRAY[]::uuid[];
  v_helper uuid;
  v_rows int;
  v_title text;
  v_gift jsonb;
  v_gift_back boolean := false;
BEGIN
  IF p_job_id IS NULL OR NULLIF(btrim(COALESCE(p_payment_intent_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'job_and_payment_intent_required' USING ERRCODE = '22023';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.helper_confirmed_at, j.helper_completed_at,
         j.status, j.payment_status, j.stripe_payment_intent_id, j.is_group_job,
         j.offered_to_helper_id, j.direct_offer_status, j.recurrence_days, j.parent_job_id
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Decided under the row lock: a refund, cancel or release that committed
  -- first, or a new PaymentIntent, wins and nothing is written.
  IF v_job.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
     OR v_job.payment_status IS NULL
     OR v_job.payment_status NOT IN ('escrow', 'payout_pending') THEN
    RETURN jsonb_build_object('outcome', 'moved_on', 'payment_status', v_job.payment_status);
  END IF;

  -- Q1978: the Helpr's payout is already moving (a transfer claimed or sent
  -- before the job flips to 'released', or a dispute split under its
  -- settlement claim). Nothing is cancelled, un-escrowed or told here; the
  -- caller pages ops. A 'failed' payout row is money that never left.
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = v_job.id AND pt.status IS DISTINCT FROM 'failed')
     OR EXISTS (SELECT 1 FROM public.dispute_settlement_claims c
                 WHERE c.job_id = v_job.id) THEN
    RETURN jsonb_build_object('outcome', 'payout_moving', 'payment_status', v_job.payment_status);
  END IF;

  v_crew := v_job.is_group_job IS TRUE;
  IF v_crew THEN
    PERFORM 1 FROM public.group_job_helpers g WHERE g.job_id = v_job.id FOR UPDATE;
  END IF;

  v_hired := v_job.helper_id IS NOT NULL
    OR (v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending')
    OR (v_crew AND EXISTS (
          SELECT 1 FROM public.group_job_helpers g
           WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL));
  IF NOT v_hired THEN
    RETURN jsonb_build_object('outcome', 'not_hired');
  END IF;

  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress')
     OR v_job.payment_status = 'payout_pending'
     OR v_job.helper_completed_at IS NOT NULL
     OR v_job.recurrence_days IS NOT NULL
     OR v_job.parent_job_id IS NOT NULL
     OR (v_crew AND EXISTS (
          SELECT 1 FROM public.group_job_helpers g
           WHERE g.job_id = v_job.id AND g.helper_completed_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('outcome', 'not_cancellable', 'status', v_job.status::text);
  END IF;

  -- Who is told: a Helpr who had confirmed, or each confirmed crew member.
  IF v_crew THEN
    SELECT COALESCE(array_agg(DISTINCT g.helper_id), ARRAY[]::uuid[]) INTO v_told
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NOT NULL;
  ELSIF v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL THEN
    v_told := ARRAY[v_job.helper_id];
  END IF;

  PERFORM set_config('app.sanctioned_cancel', 'on', true);
  PERFORM set_config('app.payment_failed_cancel', 'on', true);
  PERFORM set_config('app.declutter_seller_fault_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         payment_status = 'failed',
         stripe_session_id = NULL,
         cancelled_by = NULL,
         cancelled_at = now(),
         cancellation_reason = 'The bank payment didn''t go through.',
         late_cancellation = false,
         cancellation_fee = 0,
         cancellation_fee_status = NULL,
         direct_offer_status = CASE WHEN direct_offer_status = 'pending' THEN 'expired' ELSE direct_offer_status END,
         direct_offer_expires_at = CASE WHEN direct_offer_status = 'pending' THEN NULL ELSE direct_offer_expires_at END
   WHERE id = v_job.id
     AND stripe_payment_intent_id = p_payment_intent_id
     AND payment_status IN ('escrow', 'payout_pending');
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM set_config('app.declutter_seller_fault_cancel', 'off', true);
  PERFORM set_config('app.payment_failed_cancel', 'off', true);
  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  IF v_rows <> 1 THEN
    -- Unreachable under the FOR UPDATE above; fail closed rather than notify.
    RAISE EXCEPTION 'payment_failed_cancel_matched_% rows (job_id=%)', v_rows, v_job.id;
  END IF;

  -- A job part-paid by a gift card (create-payment's ACH gift-shortfall
  -- checkout, pi.metadata.gift_card_id): the completed checkout spent the
  -- gift, and the bank money never arrived, so the gift goes back. Exactly
  -- once: return_bounced_gift_card (20261017074500, Q1876) puts back the SAME
  -- row only while it is still 'redeemed' on this job, under this job's lock,
  -- and only now that the job is 'failed' with no checkout open. A redelivery
  -- finds it 'sent' with no job and answers not_consumed. Called dynamically
  -- so this function deploys before or after that one; until it exists the
  -- caller is told (gift.outcome 'not_deployed') and pages ops.
  IF p_gift_card_id IS NOT NULL THEN
    IF to_regprocedure('public.return_bounced_gift_card(uuid,uuid)') IS NULL THEN
      v_gift := jsonb_build_object('outcome', 'not_deployed');
    ELSE
      EXECUTE 'SELECT public.return_bounced_gift_card($1, $2)' INTO v_gift USING v_job.id, p_gift_card_id;
    END IF;
    -- A gift whose donation was refunded comes back unspendable: say nothing
    -- about it rather than promise a usable gift.
    v_gift_back := v_gift->>'outcome' = 'returned' AND v_gift->>'payment_status' = 'paid';
  END IF;

  v_title := COALESCE(v_job.title, 'Your job');

  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      v_job.id,
      'Bank payment failed, job cancelled',
      format('Your bank payment for "%s" didn''t go through, so the job has been cancelled. You haven''t been charged anything.%s%s You can post it again any time.',
             v_title,
             CASE WHEN v_gift_back THEN ' Your gift card is back in your account.' ELSE '' END,
             CASE WHEN cardinality(v_told) > 1 THEN ' We''ve let your Helprs know.'
                  WHEN cardinality(v_told) = 1 THEN ' We''ve let your Helpr know.'
                  ELSE '' END),
      'warning',
      '/post-job'
    );
  END IF;

  FOREACH v_helper IN ARRAY v_told LOOP
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_helper,
      v_job.id,
      'Job cancelled',
      format('"%s" was cancelled because the payment for it didn''t go through.%s This doesn''t count against you.',
             v_title,
             CASE WHEN v_job.status::text = 'in_progress' THEN ' Please stop work on it.'
                  ELSE ' Please don''t start work on it.' END),
      'warning',
      '/jobs?job=' || v_job.id::text
    );
  END LOOP;

  RETURN jsonb_build_object(
    'outcome', 'cancelled',
    'from_status', v_job.status::text,
    'from_payment_status', v_job.payment_status,
    'helpers_told', to_jsonb(v_told),
    'gift', v_gift
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) TO service_role;
