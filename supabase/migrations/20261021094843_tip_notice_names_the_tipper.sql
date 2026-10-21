-- Board 181: the tip notice names who tipped and opens the tip moment.
--
-- Was: "You got a $13.5 tip!" / "A poster left you a $13.5 tip for ...", linked
-- to /profile?tab=earnings. Now: "Lexi L. tipped you $13.50" (First L., the
-- member-name rule, through the shared member_display_name), "All of it is
-- yours, for "<job>".", linked to /tips/<id> (the Helpr's moment: the tip, the
-- job's pay, Say thanks). Amounts always carry two decimals. Everything else is
-- the live body (pg_get_functiondef 2026-10-21): the paid transition, the
-- financial_alerts preference, the job_id and the log row.

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
