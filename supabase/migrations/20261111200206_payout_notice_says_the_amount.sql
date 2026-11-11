-- F479 (whole-app audit 11-10, Worker 6, Medium): the "Payout released" notice (and the email the notifications
-- trigger sends from it, jobs_notice_email_type) said 'Your payout for "Trim the hedges" has been released to your
-- account.' with no amount, so the Helpr had to open the app to see what was sent.
--
-- Now: 'Your $42.00 payout for "Trim the hedges" has been released to your account.' The amount is the server's own
-- record of the transfer: the one live payout_transfers row for that job and that Helpr (unique index
-- payout_transfers_one_live_per_job_helper_v2; status pending or paid, the states a sent transfer is in when the job
-- flips to released: release-payout stamps the row paid and only then flips the job). Each crew member reads their
-- own row. No row (an old job, a $0 release, a path that never wrote one): the sentence keeps its old words, so no
-- amount is ever guessed or computed here. No arrival date is promised (F488: "lands on your usual payout schedule"
-- stays on the Money page). Display only: no amount, status, transfer or refund changes.
--
-- notify_on_payment_escrowed is restated VERBATIM from its newest definition (20261108201000), changing only the two
-- "Payout released" message expressions (marked CHANGED 20261111200206). Title, type, link, conditions, grants keep.
-- Replay-safe: CREATE OR REPLACE of an existing trigger function; triggers untouched; grants restated as live.
-- Proof: src/test/pglite/payoutNoticeSaysTheAmount.pglite.mjs (red without this migration, green with it, 3x).

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_member uuid;
  v_confirm_by timestamptz;
BEGIN
  -- Q1995: a cancelled (or completed) job promoted to escrow by a late bank settlement is refunded within the hour
  -- (void-cancelled-payments Part A); nobody is told their money is held for a job that is over.
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling'
     AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN
    v_title := 'Payment secured';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held and will be released after the job is completed.';

    IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
        -- A3-38: the Helpr's next step is the day-before confirm, owed until CONFIRM_DEADLINE_HOURS_BEFORE_START
        -- before the start (confirmDeadlineMs; a start with no time is midnight, as the sweep reads it). Not
        -- "Get to work!": the work may be days away. Already confirmed, or that instant passed: no next step.
        IF NEW.date_needed IS NOT NULL THEN
          v_confirm_by := ((NEW.date_needed + COALESCE(NEW.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
                          - interval '2 hours';
        END IF;
        v_msg := 'Payment for "' || NEW.title || '" is held.'
          || CASE WHEN NEW.helper_confirmed_at IS NULL AND v_confirm_by > now()
                  THEN ' Next: confirm you''ll be there by '
                       || to_char(v_confirm_by AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD "at" FMHH12:MI AM') || '.'
                  ELSE '' END;
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', v_msg, 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      -- CHANGED 20261111200206 (F479): the amount from this Helpr's live payout_transfers row; none -> the old words.
      VALUES (NEW.helper_id, 'Payout released',
        'Your ' || COALESCE((SELECT '$' || to_char(t.amount_cents / 100.0, 'FM999990.00') || ' ' FROM public.payout_transfers t
                              WHERE t.job_id = NEW.id AND t.helper_id = NEW.helper_id AND t.status IN ('pending', 'paid')
                              ORDER BY t.created_at DESC LIMIT 1), '')
          || 'payout for "' || NEW.title || '" has been released to your account.',
        'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  -- A crew (Q407): the payout fan-out releases the job once EVERY member is
  -- paid, so every member hears it, each on their own preference.
  IF NEW.is_group_job IS TRUE
     AND NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released'
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    FOR v_member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL
    LOOP
      IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        -- CHANGED 20261111200206 (F479): each member's own live payout_transfers row; none -> the old words.
        VALUES (v_member, 'Payout released',
          'Your ' || COALESCE((SELECT '$' || to_char(t.amount_cents / 100.0, 'FM999990.00') || ' ' FROM public.payout_transfers t
                                WHERE t.job_id = NEW.id AND t.helper_id = v_member AND t.status IN ('pending', 'paid')
                                ORDER BY t.created_at DESC LIMIT 1), '')
            || 'payout for "' || NEW.title || '" has been released to your account.',
          'financial_alerts', '/profile?tab=earnings', NEW.id);
        PERFORM public.log_notification(v_member, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;
