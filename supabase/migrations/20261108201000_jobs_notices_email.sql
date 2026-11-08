-- JOBS AUDIT 11-08, #2 (High) and #6 (Medium): ~/.lh-shots/handoffs-1108/jobs-audit.md.
--
-- #2  Push reaches 5 of 272 real members (1.8%, prod 11-08), so a Jobs notice with no email reaches almost nobody
--     outside the app. These had none: the Helpr's hire notice ("Job funded"), approved / released ("Job approved!",
--     "Job complete", "Helpr support approved your job", "Job completed!", "Payout released"), tips ("<name> tipped
--     you $X", "You received a tip!"), a dispute opened ("A dispute was opened", "Revision deadline passed — dispute
--     opened"), reschedule asked / answered / withdrawn / expired, the poster cancelled (to the Helpr), the no-check-in
--     notice at the start ("Start time passed", "Job day ended"), the last chance to approve ("Please review the
--     work"), and the new continue-day check-ins ("<name> is on the way back / is back at the job / started working
--     again", whose titles carry the name, so the continue-day trigger's fixed list misses them).
--     Now: one AFTER INSERT trigger on notifications emails exactly those through send_notice_email
--     (20261108160000), so whichever sender writes the row (SQL or an edge function), the email follows. The email
--     goes under the member's matching switch: money under Payments / Financial alerts (the row's own type), the rest
--     under Job updates or Work status. send-notification-email reads that switch and the email master switch, and
--     refuses test and seed recipients (Q840, Q137). Only rows actually written are emailed (a seed-boundary or
--     reminder-switch drop writes no row). Never an admin notice: "Job disputed" (the admins' copy) is not on the
--     list. Recurring visit notices are left out: the feature is unused on prod (0 visit payments, 0 series offers).
-- #6  A switch that was off skipped the in-app row itself (the thing 20261108160000 reversed for transit):
--     "Financial alerts" off dropped the Helpr's hire notice, "Payout released", "Payment secured" and tips; "Reviews"
--     off dropped "review received". notify_on_payment_escrowed (restated from 20261102084222), notify_helper_on_tip
--     (from 20261102045334) and notify_user_on_review (from 20261102230737) now always write the row; the same switch
--     still gates the push (notification_type_pref_map) and the email.
--
-- Proof: src/test/pglite/jobsNoticesEmail.pglite.mjs. Guard: src/test/jobsNoticesEmail.test.ts.

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
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
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
        VALUES (v_member, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
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

CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_job_title text;
  v_tipper text;
  v_amount text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    SELECT public.member_display_name(p.full_name, 'Someone') INTO v_tipper
      FROM public.profiles p WHERE p.user_id = NEW.tipper_id;
    v_amount := '$' || to_char(NEW.amount, 'FM999999990.00');
    v_title := COALESCE(v_tipper, 'Someone') || ' tipped you ' || v_amount;
    v_msg := 'All of it is yours, for "' || COALESCE(v_job_title, 'your work') || '".';

    -- Q2329: a Helpr on a payout hold is not told "All of it is yours": the webhook pulls the tip back
    -- (holdBackPaidTip) and heldTipRepay tells them when it reaches them.
    IF EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'skipped', v_title, NEW.job_id, 'payout_hold');
      RETURN NEW;
    END IF;

    IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/tips/' || NEW.id, NEW.job_id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helper_on_tip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_helper_on_tip() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_user_on_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_link text;
  v_job_title text;
  v_customer_id uuid;
  v_reviewer_name text;
  v_revealed boolean;
BEGIN
  SELECT title, customer_id INTO v_job_title, v_customer_id
    FROM public.jobs WHERE id = NEW.job_id;

  -- Is this review visible to its subject right now? The visibility trigger
  -- runs AFTER INSERT alongside this one, so read the reciprocal directly
  -- rather than trusting NEW.feedback_visible_at, which may not be set yet.
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE job_id = NEW.job_id
      AND reviewee_id = NEW.reviewer_id
      AND id <> NEW.id
  ) INTO v_revealed;

  IF v_revealed THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_reviewer_name
      FROM public.profiles WHERE user_id = NEW.reviewer_id;
    v_title := 'New review from ' || v_reviewer_name;
    v_msg := 'You got a ' || NEW.rating || '-star review for "'
             || COALESCE(v_job_title, 'a job') || '".';
    -- Nothing to write; the ask is "come read it".
    v_link := '/profile?tab=reviews';
  ELSE
    -- Held. Say who reviewed and nothing more: no rating, no text (Q2328,
    -- owner 2026-10-21: name the reviewer as "First L."; the review itself
    -- stays hidden until it is revealed). The subquery keeps a missing
    -- profile row a fallback name, never a NULL message.
    SELECT public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = NEW.reviewer_id), 'Someone')
      INTO v_reviewer_name;
    v_title := 'You have a new review';
    v_msg := v_reviewer_name || ' reviewed you for "' || COALESCE(v_job_title, 'a job')
             || '". It unlocks once you review them too, or in 14 days.';
    -- The ask IS to write one, so land on the surface that can.
    -- A job whose row has gone (or a review with no job) has no Activity card
    -- to land on, so it falls back to the read-only tab rather than to a
    -- /posts?job= link naming nothing.
    IF NEW.job_id IS NULL OR v_customer_id IS NULL THEN
      v_link := '/profile?tab=reviews';
    ELSIF NEW.reviewee_id = v_customer_id THEN
      v_link := '/posts?job=' || NEW.job_id;
    ELSE
      v_link := '/jobs?job=' || NEW.job_id;
    END IF;
  END IF;

  IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', v_link, NEW.job_id);
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_user_on_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user_on_review() TO service_role;

-- ── #2 Which Jobs notices email, and under which switch (NULL = no email from here) ──────────────────────────────
-- Matched on the row's type and title as its sender writes them. Every listed title is a literal in a live sender
-- (src/test/jobsNoticesEmail.test.ts checks both ways for the SQL senders and the edge senders).
CREATE OR REPLACE FUNCTION public.jobs_notice_email_type(p_type text, p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Hired and paid (Payments / Financial alerts: the row's own type).
    WHEN p_type = 'financial_alerts' AND p_title IN ('Job funded', 'Payout released', 'You received a tip!') THEN p_type
    WHEN p_type = 'financial_alerts' AND p_title LIKE '% tipped you %' THEN p_type
    WHEN p_type IN ('payment', 'info') AND p_title IN ('Job approved!', 'Job complete', 'Helpr support approved your job', 'Job completed!') THEN p_type
    -- The poster cancelled (poster_cancel_job: 'payment' when the Helpr is paid for their time, else 'job_updates').
    WHEN p_type IN ('payment', 'job_updates') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN p_type
    -- A dispute opened (the parties' copies; 'A dispute was opened' is filed under job_updates before insert).
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Revision deadline passed — dispute opened') THEN 'job_updates'
    -- Reschedule asked, answered, withdrawn, not applied, unanswered.
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('New date or time requested', 'New date or time accepted',
      'New date or time declined', 'New date or time not possible', 'Offer to come back not answered in time',
      'Date or time request withdrawn', 'New date or time not applied', 'Your new time wasn''t answered') THEN 'job_updates'
    -- The start passed with no check-in; the last chance to approve.
    WHEN p_type = 'work_status' AND p_title IN ('Start time passed', 'Job day ended', 'Please review the work') THEN 'work_status'
    -- Continue-day check-ins (continue_day_check_in: the Helpr's first name leads the title).
    WHEN p_type = 'job_updates' AND (p_title LIKE '% is on the way back' OR p_title LIKE '% is back at the job'
                                     OR p_title LIKE '% started working again') THEN 'job_updates'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.jobs_notice_email_type(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jobs_notice_email_type(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.email_jobs_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, public.jobs_notice_email_type(NEW.type, NEW.title),
                                   NEW.link, NEW.job_id);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.email_jobs_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_email_jobs_notice ON public.notifications;
CREATE TRIGGER trg_email_jobs_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (public.jobs_notice_email_type(NEW.type, NEW.title) IS NOT NULL
        AND COALESCE(NEW.link, '') NOT LIKE '/declutter%'
        AND COALESCE(NEW.link, '') NOT LIKE '/admin%')
  EXECUTE FUNCTION public.email_jobs_notice();
