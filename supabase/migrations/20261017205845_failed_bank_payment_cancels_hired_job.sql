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
-- insert_job_status_system_message (newest definition 20261004001242, plus
-- one early return) skips its "✕ Job cancelled" thread row under the same
-- flag: that row notifies every thread participant (notify_message_recipient)
-- as if from the poster (lh-money-escrow review of 56346b5eb #1).
--
-- record_backout_notice (newest definition 20261017073146, unchanged) would
-- read this cancel as the poster's ("<name> cancelled") and email an
-- unconfirmed Helpr, and would tell the poster a retired direct offer
-- "expired". It already returns early while app.declutter_seller_fault_cancel
-- is on: the hatch for a cancel that is NOT the poster's and whose caller
-- writes its own notices, which is exactly this one. This function raises that
-- flag around its one UPDATE (and clears it right after) rather than restating
-- the trigger; the flag's other reader is that trigger alone (grep, 2026-10-17).
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

-- insert_job_status_system_message: newest definition (20261004001242) + the
-- Q1971 early return. Live md5(prosrc) before: 7b9df9c20d46f0dadc1e6489c55b0c14,
-- the same as 20261004001242's body (both measured 2026-10-17, read-only).
CREATE OR REPLACE FUNCTION public.insert_job_status_system_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
BEGIN
  -- Only fire on meaningful status transitions
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Q1971 (20261017205845): a job cancelled because its bank payment failed
  -- writes no "✕ Job cancelled" thread row. That row notifies every thread
  -- participant as if the poster sent it (notify_message_recipient), which
  -- would tell an unconfirmed Helpr the owner chose not to tell, and tell a
  -- confirmed one twice. cancel_job_after_failed_bank_payment tells the
  -- people who should hear, in the right words.
  IF COALESCE(current_setting('app.payment_failed_cancel', true), '') = 'on' THEN RETURN NEW; END IF;

  -- Q262: an ownerless job (poster deleted, customer_id SET NULL) has nobody
  -- to attribute the row to, and messages.sender_id is NOT NULL.
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Compare on ::text so an unknown label degrades to NULL (no message)
  -- instead of raising an enum-cast error that would abort the transition.
  v_content := CASE NEW.status::text
    WHEN 'accepted'    THEN '✓ Job awarded'
    WHEN 'in_progress' THEN '▶ Work started'
    WHEN 'completed'   THEN '✓ Job completed'
    WHEN 'cancelled'   THEN '✕ Job cancelled'
    WHEN 'disputed'    THEN '⚠ Dispute opened'
    ELSE NULL
  END;

  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Insert one system message per unique participant in this job's threads.
  -- `sender_id = NEW.customer_id` (poster) satisfies the NOT NULL
  -- constraint on the column; `is_system=true` is what marks the row as
  -- system-generated in the UI, so poster-attribution here is a semantic
  -- no-op — both parties see the same system-styled row.
  -- Q262: a participant is NULL when that account was deleted
  -- (messages_receiver_id_fkey ON DELETE SET NULL); nobody to tell.
  -- Q713: a participant blocked with the poster (either direction) is
  -- skipped, with the block trigger's own predicate: otherwise its RAISE
  -- aborts the status change itself.
  -- Q1169: the send limit no longer counts notices, and a party can flip a
  -- job in_progress <-> disputed at will, so the notice brakes itself (and the
  -- notification and push each one fires). A participant is skipped when
  -- (a) their LATEST notice on this job already says this (nothing changed for
  -- them), or (b) they got 6 notices on this job in the last 10 minutes (an
  -- alternating loop). A real move back (X -> Y -> X) is still told: (a) looks
  -- at the latest notice, not at any recent one.
  -- "Latest" orders by created_at, the inserting transaction's start time. Every
  -- status RPC locks the jobs row FOR UPDATE first, so two moves on one job
  -- commit in the order they started (round-3 review, note 3).
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NEW.customer_id,
    p.participant,
    v_content,
    false,
    true
  FROM (
    SELECT CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END AS participant
    FROM messages m
    WHERE m.job_id = NEW.id
      AND m.is_system = false
      AND m.sender_id IS NOT NULL
  ) p
  WHERE p.participant IS NOT NULL
    AND public.are_users_blocked(NEW.customer_id, p.participant) IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT d.content FROM messages d
        WHERE d.job_id = NEW.id
          AND d.is_system
          AND d.receiver_id = p.participant
        ORDER BY d.created_at DESC
        LIMIT 1
      ) last
      WHERE last.content = v_content
    )
    AND (
      -- A final state is never capped (round-3 review): cancelled has no way
      -- out and completed only leaves through an admin, so neither can loop,
      -- and a capped one would leave the thread showing a live job.
      NEW.status::text IN ('cancelled', 'completed')
      OR (
        SELECT count(*) FROM messages d
        WHERE d.job_id = NEW.id
          AND d.is_system
          AND d.receiver_id = p.participant
          AND d.created_at > now() - interval '10 minutes'
      ) < 6
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- A trigger function: the trigger machinery runs it, no role calls it.
REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;
