-- Q1972 (owner decision, pop-up 2026-10-17 ~21:00Z): when a job's bank (ACH)
-- payment fails AFTER a Helpr was hired, the job is cancelled right away.
--
--   * No cancellation fee and no strike to anyone: nobody chose to cancel, the
--     money simply never arrived.
--   * The direct offer and the pending applications are retired (the
--     applications by trg_close_pending_applications_on_job_cancel, the cancel's
--     own side effect; the offer here).
--   * A Helpr who had confirmed (and every confirmed crew member) is told the
--     job was cancelled because the payment didn't go through. A hired Helpr
--     who never confirmed is not told (owner, job 7440a72d).
--   * The poster is told plainly: the bank payment failed, the job is
--     cancelled, and they can post again. No refund is owed: no money arrived.
--   * A gift card the checkout spent (an ACH gift-shortfall job) goes back to
--     the poster's gift balance exactly once, in the same transaction
--     (return_bounced_gift_card, Q1876; lead, 2026-10-17).
--
-- The incident: real job 7440a72d (ACH, insufficient_funds on 10-15) stayed in
-- escrow and was hired. Q1970 (ready/ach-escrow-1017) takes such a job out of
-- escrow (payment_status 'failed') but leaves it hired. This RPC is the
-- cancel half: stripe-webhook's paymentIntentPaymentFailed calls it first and
-- falls back to Q1970's un-fund when the job is not a hired, still-live job.
--
-- WHY AN RPC: the cancel must run the sanctioned-cancel path in ONE
-- transaction (app.sanctioned_cancel, which trg_cancellation_requires_rpc and
-- notify_on_job_update read), write its own notices, and keep the generic
-- trigger notices from going out a second time. PostgREST cannot set a
-- transaction-local GUC around a table UPDATE, so the edge function calls this.
--
-- WHAT IS NOT CANCELLED (returned to the caller, which keeps Q1970's un-fund):
--   * nobody hired, offered or on the crew ('not_hired');
--   * work marked done, or a status past in_progress (completed, disputed,
--     revision_requested, payout_pending): the Helpr did the work, so a person
--     decides ('not_cancellable');
--   * a recurring series parent or a visit of one ('not_cancellable'): its
--     holds and dates have their own exits;
--   * a job that moved on (another PI, or no longer escrow/payout_pending):
--     'moved_on', nothing written.
--
-- record_backout_notice (restated verbatim from its newest definition,
-- 20261017073146, plus one early return) would read this cancel as the
-- poster's ("<name> cancelled") and email an unconfirmed Helpr, and would tell
-- the poster a retired direct offer "expired". It skips while
-- app.payment_failed_cancel is on; only this function sets it, and clears it
-- right after its UPDATE.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, signatures new or unchanged.

CREATE OR REPLACE FUNCTION public.cancel_job_after_failed_bank_payment(p_job_id uuid, p_payment_intent_id text, p_gift_card_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
      format('Your bank payment for "%s" didn''t go through, so the job has been cancelled. You haven''t been charged and there''s no cancellation fee.%s%s You can post it again any time.',
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
      format('"%s" was cancelled because the poster''s payment didn''t go through.%s This doesn''t count against you.',
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
$fn$;

REVOKE ALL ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) TO service_role;

-- record_backout_notice: newest definition (20261017073146) + the Q1972 early
-- return. Live md5(prosrc) before: 51500f6d2f0eb31a4f458c5c480eb49f, the same
-- as 20261017073146's body (both measured 2026-10-17, read-only).
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A10 (20261017073146): a setup job the Declutter seller's backing out
  -- cancelled is not the poster's cancel; declutter_refund_cancels_setup_jobs
  -- tells the Helpr itself, in the right words (lh-silent-failure review of
  -- c57d948d0 #2: this said "<poster> cancelled").
  IF COALESCE(current_setting('app.declutter_seller_fault_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  -- Q1972 (20261017205845): a job cancelled because its bank payment failed is
  -- nobody's back-out; cancel_job_after_failed_bank_payment tells the poster and
  -- any confirmed Helpr itself, and an unconfirmed Helpr is not told.
  IF COALESCE(current_setting('app.payment_failed_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(btrim(p.full_name), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;
