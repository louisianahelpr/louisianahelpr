-- Q2328 (owner 2026-10-21, issue #3515: "the notice names the reviewer (First L.), and the stars and text stay
-- hidden until the review is revealed"). notify_user_on_review's HELD branch said 'Someone reviewed you for
-- "<job>". ...'; on a crew job the poster could not tell which Helpr to review back. It now reads
-- '<First L.> reviewed you for "<job>". It unlocks once you review them too, or in 14 days.' The rating and
-- the review text are still not in the notice, and RLS still hides the held review from its subject.
--
-- Restated from prod (md5(prosrc) 2587d13569f9a8359f85433e212aae79, length 2326, on 2026-11-02 = the body in
-- 20261021061341_member_display_name.sql) with only the held branch's name read and message changed. The
-- revealed branch, the links, the preference read and the trigger are unchanged. Grants as live (postgres,
-- service_role): CREATE OR REPLACE keeps them; restated below to be sure.
-- Guard: src/test/notificationsNameTheActor.test.ts (the notify_user_on_review exception is removed).

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

REVOKE ALL ON FUNCTION public.notify_user_on_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user_on_review() TO service_role;
