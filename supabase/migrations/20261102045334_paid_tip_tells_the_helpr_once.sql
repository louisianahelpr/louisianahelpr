-- A PAID TIP TELLS THE HELPR ONCE, AND NEVER "ALL OF IT IS YOURS" FOR A TIP BEING HELD BACK (Q2329).
--
-- What was wrong (read 2026-10-21, re-read on prod 2026-11-01 ~11:00 PM CT): a tip Checkout's webhook
-- (stripe-webhook checkoutSessionCompleted) flips tips.payment_status to 'paid', which fires trg_notify_helper_tip
-- (AFTER INSERT OR UPDATE on public.tips: "<Name> tipped you $X" / "All of it is yours, for ..."), and then the webhook
-- inserted its own "You received a tip!". Two notices for one tip. And for a Helpr on a payout hold the trigger still
-- said "All of it is yours" while the webhook pulled the tip back (Q1222, holdBackPaidTip); heldTipRepay tells them
-- again when it is kept or re-paid.
--
-- The fix: ONE producer per event. The trigger stays the producer (it also covers auto-tip-charge, whose paid write has
-- no notice of its own); the webhook's own notice is removed in the same change. The trigger skips a Helpr with a
-- payout_holds row (logged 'skipped', reason 'payout_hold'): that tip is held back by the webhook, and heldTipRepay
-- tells the Helpr when it reaches them.
--
-- Body verbatim from prod's pg_get_functiondef (newest repo text 20261021094843) plus that one block. Replay-safe:
-- CREATE OR REPLACE of an existing trigger function, trigger untouched. Grants restated: service_role only.
-- Proof: src/test/pglite/paidTipTellsTheHelprOnce.pglite.mjs. Guard: src/test/paidTipTellsTheHelprOnce.test.ts.

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

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;

    IF COALESCE(v_pref, true) THEN
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
