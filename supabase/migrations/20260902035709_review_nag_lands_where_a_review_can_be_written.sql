-- The held-review notification asks for a reciprocal review and links to a
-- page that cannot write one.
--
-- notify_user_on_review (20260831162131) has two branches. The REVEALED one is
-- fine and stays exactly as it is:
--
--   title: 'New review from Marie B.'  →  /profile?tab=reviews
--
-- "here is the review you received" pointing at the list of reviews received
-- is the right destination, and a reconciliation sweep that called this link
-- dead was wrong about it.
--
-- The HELD branch is the defect:
--
--   title:   'You have a new review'
--   message: '… It unlocks once you review them too, or in 14 days.'
--   link:    /profile?tab=reviews
--
-- That message is an instruction — write your side and this unlocks — and the
-- destination is READ-ONLY. `/profile?tab=reviews` lists reviews RECEIVED, and
-- the held review is by definition filtered out of it, so the reader arrives at
-- a screen that shows them neither the thing they were told about nor any way
-- to do the thing they were asked to do. The clearer the copy got, the more it
-- lied. It is also self-defeating: the double-blind hold releases on the
-- reciprocal review, so the one call to action that ends the wait is the one
-- the notification made unreachable.
--
-- The write surfaces are the two Activity routes, and which one depends on
-- which side of the job the reviewee is:
--
--   poster  → /my-posts  (PostedJobsTab → onReview → ReviewForm)
--   helper  → /my-jobs   (AppliedJobsTab → onHelperReview → ReviewForm)
--
-- Both parse `?job=` (src/pages/Activity.tsx) and open on the bucket that job
-- is actually in. `supabase/functions/review-nag-cron/index.ts` is repointed at
-- the same two surfaces in this change for the same reason.
--
-- WHY `job_id` IS ALSO SET EXPLICITLY. notifications.job_id (20260901035600)
-- is a real reference, and notificationDestination() re-derives the live bucket
-- from it at TAP time rather than trusting a bucket frozen at write time. The
-- fill trigger would recover it from the `?job=` in the link anyway, but only
-- for the held branch — the revealed branch's `/profile?tab=reviews` carries no
-- id at all, so that row would keep losing a reference it has in hand. Setting
-- it directly covers both, and notifications_fill_job_id() returns early when
-- job_id is already non-null, so the two do not fight.

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
    SELECT COALESCE(full_name, 'Someone') INTO v_reviewer_name
      FROM public.profiles WHERE user_id = NEW.reviewer_id;
    v_title := 'New review from ' || v_reviewer_name;
    v_msg := 'You got a ' || NEW.rating || '-star review for "'
             || COALESCE(v_job_title, 'a job') || '".';
    -- Nothing to write; the ask is "come read it".
    v_link := '/profile?tab=reviews';
  ELSE
    -- Held. Say a review exists and nothing more — no rating, no name.
    v_title := 'You have a new review';
    v_msg := 'Someone reviewed you for "' || COALESCE(v_job_title, 'a job')
             || '". It unlocks once you review them too, or in 14 days.';
    -- The ask IS to write one, so land on the surface that can.
    -- A job whose row has gone (or a review with no job) has no Activity card
    -- to land on, so it falls back to the read-only tab rather than to a
    -- /my-posts?job= link naming nothing.
    IF NEW.job_id IS NULL OR v_customer_id IS NULL THEN
      v_link := '/profile?tab=reviews';
    ELSIF NEW.reviewee_id = v_customer_id THEN
      v_link := '/my-posts?job=' || NEW.job_id;
    ELSE
      v_link := '/my-jobs?job=' || NEW.job_id;
    END IF;
  END IF;

  SELECT COALESCE(reviews, true) INTO v_pref
  FROM public.notification_preferences WHERE user_id = NEW.reviewee_id;

  IF COALESCE(v_pref, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', v_link, NEW.job_id);
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger unchanged; CREATE OR REPLACE above swaps the body in place.
