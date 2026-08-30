-- Reviews had a complete notification-preferences UI category ("Reviews")
-- and the push fan-out trigger already mapped type 'review' -> prefs.reviews,
-- but nothing ever produced a `notifications` row on review insert: no
-- trigger on public.reviews, and neither review-submission call site
-- (CompletionPrompts.tsx, reviewPanel/ReviewForm.tsx) wrote a companion
-- notification. The "Reviews" toggle governed nothing.
--
-- This adds the missing producer, following notify_helper_on_tip()'s exact
-- shape (SECURITY DEFINER, search_path pinned, preference-gated insert into
-- public.notifications, log_notification audit row, DROP+CREATE trigger).
--
-- Notifies the reviewee (person being reviewed), never the reviewer.

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
  v_job_title text;
  v_reviewer_name text;
BEGIN
  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
  SELECT COALESCE(full_name, 'Someone') INTO v_reviewer_name
    FROM public.profiles WHERE user_id = NEW.reviewer_id;

  v_title := 'New review from ' || v_reviewer_name;
  v_msg := 'You got a ' || NEW.rating || '-star review for "' || COALESCE(v_job_title, 'a job') || '".';

  SELECT COALESCE(reviews, true) INTO v_pref
  FROM public.notification_preferences WHERE user_id = NEW.reviewee_id;

  IF COALESCE(v_pref, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', '/profile');
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_user_on_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_user_on_review ON public.reviews;
CREATE TRIGGER trg_notify_user_on_review
AFTER INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.notify_user_on_review();
