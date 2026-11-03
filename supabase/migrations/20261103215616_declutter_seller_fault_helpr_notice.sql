-- Q1938 follow-up (lead 11-03): the Helpr's notice when a Declutter seller's fault cancels their setup job.
-- Since 20261103214533 a committed Helpr is paid the jobs late-cancel fee on that cancel, but the notice said
-- "It was not the poster's choice, so there is no payment for it." Now a Helpr who is paid reads "The seller
-- cancelled, so you'll be paid for your time."; otherwise a neutral line with no fee or payment words.
-- "Paid" is the same test void-cancelled-payments prices with (computeCancellationFee): a committed Helpr
-- (helper_confirmed_at), a budget, and cancellation_fee_percent(true, job_hours_until_start(..., now())) > 0,
-- now() being the cancelled_at this function writes.
--
-- A full restatement of prod's live body (md5(prosrc) 1135ac9aa2e6005a186d088f7f83f515, md5(pg_get_functiondef)
-- 8db4d2e208d7d0fa3339d2cbb37d979c, read-only SELECT 11-03; the PGlite rebuilds it from 20261017073146 +
-- 20261027172503 and checks that hash). Only the paid_for_time column and the Helpr notice change.
-- Replay-safe (CREATE OR REPLACE, same signature, grants kept); service role only, re-stated below.

CREATE OR REPLACE FUNCTION public.declutter_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  rf public.declutter_refunds;
  r record;
  j record;
  v_n integer := 0;
  v_src text;
  v_prev text := COALESCE(current_setting('app.sanctioned_cancel', true), 'off');
  -- The words for what the seller did (review #7): one phrase, every notice.
  v_why text;
BEGIN
  SELECT * INTO rf FROM public.declutter_refunds x WHERE x.id = p_refund_id;
  IF NOT FOUND OR rf.fee_policy IS DISTINCT FROM 'full_seller_pays_fee' THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  v_src := 'declutter_apply_seller_fault' || CASE WHEN rf.is_seed THEN '-seed' ELSE '' END;
  IF rf.order_id IS NULL THEN
    -- The order is gone (an account deletion): its links can no longer be
    -- found from the refund; say so instead of answering 0 (lh-silent-failure
    -- re-review of 24b71630a R2).
    RAISE EXCEPTION 'order_gone' USING ERRCODE = 'P0002',
      HINT = 'The refund''s order was deleted: settle its setup jobs by hand.';
  END IF;
  v_why := CASE rf.reason
    WHEN 'seller_no_show' THEN 'the seller did not show up for the pickup'
    WHEN 'not_as_described' THEN 'the item was not as described'
    WHEN 'seller_out' THEN 'the seller can no longer sell'
    ELSE 'the seller backed out' END;
  BEGIN
  FOR r IN
    SELECT l.job_id FROM public.declutter_order_jobs l
     WHERE l.order_id = rf.order_id AND l.purpose = 'setup' AND l.seller_fault_refund_id IS NULL
     ORDER BY l.job_id
  LOOP
    BEGIN
      SELECT jb.id, jb.title, jb.status::text AS status, jb.helper_id, jb.customer_id, jb.helper_completed_at,
             COALESCE(jb.is_group_job, false) AS crew,
             (jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL) AS committed
             , COALESCE(jb.payment_status::text, 'unpaid') AS pay
             -- Q1938: void-cancelled-payments pays a committed Helpr the jobs late-cancel fee on this cancel
             -- (computeCancellationFee: committed, a budget, and the ladder's percent at the cancel time, now()).
             , (jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL AND COALESCE(jb.budget, 0) > 0
                AND jb.date_needed IS NOT NULL
                AND public.cancellation_fee_percent(true, public.job_hours_until_start(jb.date_needed, jb.start_time, now())) > 0) AS paid_for_time
        INTO j FROM public.jobs jb WHERE jb.id = r.job_id FOR UPDATE;
      IF NOT FOUND OR j.status IN ('cancelled', 'completed') THEN
        CONTINUE;
      END IF;
      IF j.status NOT IN ('open', 'accepted', 'in_progress', 'revision_requested')
         OR j.helper_completed_at IS NOT NULL THEN
        -- Done, disputed or awaiting approval for an item the seller failed to
        -- deliver: worth a look, never a silent skip (review #6).
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (%s%s) of seller-fault Declutter refund %s was left as it is: an admin decides', r.job_id, j.status,
                 CASE WHEN j.helper_completed_at IS NOT NULL THEN ', marked done' ELSE '' END, rf.id));
        CONTINUE;
      END IF;
      -- Only a job whose money is at rest (never paid, or held in escrow): one
      -- mid-cancel ('cancelling'), in a chargeback or anything else is left
      -- for an admin (lh-money-escrow review of c57d948d0 #7).
      IF j.pay NOT IN ('unpaid', 'abandoned', 'failed', 'escrow') THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (payment %s) of seller-fault Declutter refund %s was not cancelled: an admin decides', r.job_id, j.pay, rf.id));
        CONTINUE;
      END IF;
      IF j.crew THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('crew setup job %s of seller-fault Declutter refund %s was not cancelled (a crew''s fee ledger is per member): settle it by hand (no fee, card fee to the seller)', r.job_id, rf.id));
        CONTINUE;
      END IF;
      IF rf.reason = 'seller_no_show' AND j.committed AND NOT p_include_committed THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s has a committed Helpr and its Declutter order was refunded on the buyer''s seller-no-show report (refund %s): not cancelled; normal job rules apply unless an admin runs declutter_admin_apply_seller_fault(%s, true)', r.job_id, rf.id, rf.id));
        -- The buyer is told it is still booked and being looked at (re-review note).
        PERFORM public.declutter_notify(j.customer_id, 'info', 'Your Helpr job is still booked',
          format('Your Declutter order was refunded, but "%s" still has a Helpr booked. We are reviewing it; until then the normal job rules apply.', COALESCE(j.title, 'your setup job')),
          '/jobs?job=' || r.job_id::text);
        CONTINUE;
      END IF;
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.declutter_seller_fault_cancel', 'on', true);
      UPDATE public.jobs
         SET status = 'cancelled',
             cancelled_by = NULL,
             cancelled_at = now(),
             cancellation_reason = format('On the Declutter order this job was booked for, %s, so it was cancelled with no fee.', v_why),
             late_cancellation = false,
             cancellation_fee = 0,
             cancellation_fee_status = NULL
       WHERE id = r.job_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'setup_job_not_cancelled' USING ERRCODE = '55000';
      END IF;
      PERFORM set_config('app.declutter_seller_fault_cancel', 'off', true);
      PERFORM set_config('app.sanctioned_cancel', v_prev, true);
      UPDATE public.declutter_order_jobs
         SET seller_fault_refund_id = rf.id, seller_fault_at = now()
       WHERE job_id = r.job_id AND seller_fault_refund_id IS NULL;
      v_n := v_n + 1;
      PERFORM public.declutter_notify(j.customer_id, 'info', 'Setup job cancelled, no fee',
        format('On your Declutter order, %s, so "%s" was cancelled. Nothing is owed for it, and anything you paid for it comes back in full (the one-time account setup fee excepted).', v_why, COALESCE(j.title, 'your setup job')),
        '/jobs?job=' || r.job_id::text);
      -- Q1938 (lead 11-03): a Helpr who is paid for their time is told so; otherwise a neutral line, no fee words.
      PERFORM public.declutter_notify(j.helper_id, 'warning', 'Job cancelled',
        CASE WHEN j.paid_for_time
          THEN format('"%s" was cancelled: on the Declutter order it was booked for, %s. The seller cancelled, so you''ll be paid for your time.', COALESCE(j.title, 'A job'), v_why)
          ELSE format('"%s" was cancelled: on the Declutter order it was booked for, %s. It was not the poster''s choice.', COALESCE(j.title, 'A job'), v_why)
        END,
        '/jobs?job=' || r.job_id::text);
    EXCEPTION WHEN OTHERS THEN
      -- The refund must land: record why this setup job was not cancelled.
      PERFORM public.log_cron_defect(v_src, r.job_id::text,
        format('could not cancel setup job %s of seller-fault Declutter refund %s: %s (%s); retry with declutter_admin_apply_seller_fault(%s)', r.job_id, rf.id, SQLERRM, SQLSTATE, rf.id));
    END;
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Even the list of linked jobs could not be read: the refund still lands.
    PERFORM public.log_cron_defect(v_src, rf.id::text,
      format('could not read the setup jobs of seller-fault Declutter refund %s: %s (%s)', rf.id, SQLERRM, SQLSTATE));
  END;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) TO service_role;
