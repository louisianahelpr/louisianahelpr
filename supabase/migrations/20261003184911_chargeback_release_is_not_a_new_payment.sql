-- A job leaving a card-dispute ('chargeback') block is not a new payment, and
-- the payment notices said it was (Q805 (2), and the lh-money-escrow review of
-- Q449, 2026-10-03).
--
-- notify_on_payment_escrowed() (trigger trg_notify_payment_escrowed, AFTER
-- UPDATE ON public.jobs, no WHEN clause) announces any change INTO 'escrow'
-- ("Payment secured in escrow" to the poster, "Job funded ... Get to work!"
-- to the Helpr) and any change INTO 'released' ("Payout released" to the
-- Helpr, and to every crew member). Three webhook paths leave the block on
-- the SAME money, so each fired a false notice:
--   * charge.dispute.closed 'won' after a clawback was paid back
--     ('chargeback' -> 'released', Q202): the Helpr got "Payout released" next
--     to the accurate "Disputed payment returned to you";
--   * charge.dispute.closed 'won' on a job whose decided split had not run
--     ('chargeback' -> 'escrow', Q449): "Payment secured" + "Job funded ... Get
--     to work!" on a decided, often cancelled, job;
--   * a dismissed inquiry, 'warning_closed' ('chargeback' -> 'escrow', the
--     pre-chargeback state): the same two notices for a payment that never
--     moved.
-- Each block now also requires OLD.payment_status IS DISTINCT FROM
-- 'chargeback'. Nothing else changes: the body is the live definition
-- (pg_get_functiondef md5 c8e96c1034864b3909e9fdb929abb240, 2026-10-03, equal
-- to 20260925154606_group_crew_has_no_lead.sql's text) with those three
-- predicates added, so every other transition (a checkout funding escrow, a
-- payout releasing) notifies exactly as before.
--
-- Replay-safe: CREATE OR REPLACE of a function every replay already has; the
-- trigger itself is untouched.

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
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')
     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN
    v_title := 'Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL
     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  -- A crew (Q407): the payout fan-out releases the job once EVERY member is
  -- paid, so every member hears it, each on their own preference.
  IF NEW.is_group_job IS TRUE
     AND NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released'
     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN
    FOR v_member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL
    LOOP
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = v_member;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_member, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
        PERFORM public.log_notification(v_member, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;
