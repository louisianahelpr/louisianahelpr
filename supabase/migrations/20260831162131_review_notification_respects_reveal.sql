-- The review notification defeated the double-blind hold it sits next to.
--
-- reviews already reveal correctly (20260506192638): a reciprocal review on
-- the same job reveals BOTH immediately, otherwise the first side is held for
-- 14 days. That hold exists to stop tit-for-tat — neither party should be able
-- to read a review about themselves before writing their own.
--
-- But notify_user_on_review (20260830234327) fired on INSERT and put the star
-- count AND the reviewer's name straight into the notification:
--
--   title:   'New review from Marie B.'
--   message: 'You got a 3-star review for "Haul yard debris".'
--
-- So the recipient learned the rating and the author the moment it was
-- written, while feedback_visible_at was still two weeks out. The hold
-- protected the review body and nothing else. Observed 2026-08-31: reveal
-- date 2026-09-14, notification delivered instantly with rating and name.
--
-- Fix: notify on the same schedule the reveal uses.
--   * Reciprocal already exists  -> both are revealing now, so name the
--     reviewer and the rating. Nothing is being withheld.
--   * First side to review       -> say only that a review exists and when it
--     unlocks. No rating, no reviewer.
-- Also links to /profile?tab=reviews rather than bare /profile, which landed
-- on a page where the row is still filtered out — a dead end.

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
  v_revealed boolean;
BEGIN
  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;

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
    SELECT COALESCE(full_name, 'Someone') INTO v_reviewer_name
      FROM public.profiles WHERE user_id = NEW.reviewer_id;
    v_title := 'New review from ' || v_reviewer_name;
    v_msg := 'You got a ' || NEW.rating || '-star review for "'
             || COALESCE(v_job_title, 'a job') || '".';
  ELSE
    -- Held. Say a review exists and nothing more — no rating, no name.
    v_title := 'You have a new review';
    v_msg := 'Someone reviewed you for "' || COALESCE(v_job_title, 'a job')
             || '". It unlocks once you review them too, or in 14 days.';
  END IF;

  SELECT COALESCE(reviews, true) INTO v_pref
  FROM public.notification_preferences WHERE user_id = NEW.reviewee_id;

  IF COALESCE(v_pref, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', '/profile?tab=reviews');
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger unchanged; CREATE OR REPLACE above swaps the body in place.
