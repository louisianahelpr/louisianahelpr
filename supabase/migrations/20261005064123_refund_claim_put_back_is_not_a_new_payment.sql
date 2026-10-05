-- Putting a refund claim back is not a new payment (Q1319; lh-money-escrow
-- review of Q1290, 2026-10-05).
--
-- 'cancelling' is a refund-in-flight claim: cancel_escrow takes it from
-- 'escrow', and since Q1290 a full admin refund (create-payment
-- admin_refund_general) takes it from whatever the job read. Every stop
-- before a refund can exist puts the claim BACK ('cancelling' -> the state it
-- was taken from), and notify_on_payment_escrowed() (trigger
-- trg_notify_payment_escrowed, AFTER UPDATE ON public.jobs, no WHEN clause)
-- read that as a change INTO the state:
--   * 'cancelling' -> 'escrow': "Payment secured in escrow" to the poster and
--     "Job funded ... Get to work!" to the Helpr, for a payment that never
--     moved (cancel_escrow's put-back and an admin refund refused on an
--     escrowed job);
--   * 'cancelling' -> 'released': "Payout released" to the Helpr (and every
--     crew member) when an admin full refund of a released job is refused
--     by the payout-ledger check.
-- Each block now also requires OLD.payment_status IS DISTINCT FROM
-- 'cancelling'. Nothing else changes: the body is the live definition
-- (pg_get_functiondef md5 f88f50a74c793756e1538e0e8b660bbf, read 2026-10-05,
-- equal to 20261003184911_chargeback_release_is_not_a_new_payment.sql) with
-- those three predicates added. No real funding or payout ever comes FROM
-- 'cancelling': a claim only ends in a put-back or in 'refunded'/'cancelled'.
--
-- Replay-safe: CREATE OR REPLACE of a function every replay already has; the
-- trigger itself is untouched; privileges restated as live (postgres and
-- service_role only).

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
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
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
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
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
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
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
