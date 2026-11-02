-- Q1995 (lh-money-escrow@af0fbedd6#1): paymentIntentSucceeded promotes a CANCELLED unfunded job to escrow when its
-- bank debit settles late, on purpose (void-cancelled-payments Part A refunds it within the hour). The jobs trigger
-- notify_on_payment_escrowed had no status guard, so the poster first read "Payment secured: your payment ... is
-- safely held and will be released after the job is completed" (and a Helpr on it "Job funded") for a job that is
-- over, before the refund notice. The escrow notices now skip a job whose status is 'cancelled' or 'completed'.
--
-- Restated from prod (md5(prosrc) 7f57daa46bd58ad6cf2cc60d8b044407 on 2026-11-02 = 20261005064123's body with the
-- later copy rewrites, e.g. 20261030220537) with one added condition. The payout-released branches, the trigger
-- itself and the grants are unchanged (privileges restated as live: postgres and service_role only).
-- Proof: src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs.

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
  -- Q1995: a cancelled (or completed) job promoted to escrow by a late bank settlement is refunded within the hour
  -- (void-cancelled-payments Part A); nobody is told their money is held for a job that is over.
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling'
     AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN
    v_title := 'Payment secured';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held and will be released after the job is completed.';

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
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is held safely. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
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
