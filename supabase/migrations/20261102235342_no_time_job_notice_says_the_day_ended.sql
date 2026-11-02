-- A JOB WITH NO START TIME IS TOLD ITS DAY ENDED, NOT "START TIME PASSED" (Q2640, lead 11-02, Q2588 follow-up).
--
-- What was wrong: 20261102100421 made auto_start_due_jobs start a job whose start_time is NULL at the Central midnight
-- that ENDS its day (jobIsOverdue's instant, src/lib/anyTimeThatDay.ts). notify_poster_on_status_change's in_progress
-- branch then told the poster "Start time passed — <Helpr> hasn't checked in" for a job that never had a start time.
-- On prod, 368 of 535 jobs posted in the 60 days before 20261102100421 had no start time (its header).
--
-- Now: inside the same no-arrival case, start_time IS NULL first: title "Job day ended",
-- "<Helpr> hasn't checked in for "<job>", and its day is over. Open the job to message them or report a no-show."
-- A job WITH a start time keeps "Start time passed" word for word; an arrival keeps "Work has started".
--
-- How: restated VERBATIM from prod's pg_get_functiondef (read 2026-11-02 ~5:55 PM CT, md5
-- 3f0df0f3c708b148cc02eab8420c5c32, which is 20261102043115's body), changing only that IF. No other branch,
-- preference, link, type or trigger moves. Grants restated as live (proacl {postgres=X, service_role=X}).
--
-- Replay-safe: CREATE OR REPLACE of an existing trigger function; triggers untouched.
-- Proof: src/test/pglite/noTimeJobNoticeDayEnded.pglite.mjs. Guard: src/test/noTimeJobNoticeDayEnded.test.ts.

CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_pref_in_app boolean;
  v_link text;
  v_after int;
  v_approve_by text;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/posts?job=' || NEW.id::text;
  SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;
  -- No profiles row: SELECT INTO leaves NULL (member_display_name never runs), every sentence would be NULL, and
  -- notifications.title/message are NOT NULL, so the INSERT would roll back the Helpr's own jobs UPDATE (mark done
  -- included). Same words as member_display_name's fallback. (code-review on this migration, 2026-10-23.)
  v_helper_name := COALESCE(v_helper_name, 'Your Helpr');

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    -- A3-36: says whether the poster has anything to do.
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '". Next: nothing for you to do until they arrive.';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '". Next: nothing for you to do; they mark it done when they finish.';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    -- CHANGED 20261029160717 (audit 2026-10-29 A2-B12): auto_start_due_jobs
    -- sets in_progress at the start time whether or not the Helpr came. With
    -- no arrival recorded (theirs or the poster's word) the notice says so,
    -- never that work started.
    -- CHANGED 20261102235342 (Q2640): a job with no start time is started at the Central midnight that ENDS its day
    -- (20261102100421), so it has no start time to have passed; the notice says its day is over.
    IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN
      IF NEW.start_time IS NULL THEN
        v_title := 'Job day ended';
        v_msg := v_helper_name || ' hasn''t checked in for "' || NEW.title || '", and its day is over. Open the job to message them or report a no-show.';
      ELSE
        v_title := 'Start time passed';
        v_msg := v_helper_name || ' hasn''t checked in for "' || NEW.title || '". Open the job to message them or report a no-show.';
      END IF;
    ELSE
      v_title := 'Work has started';
      v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';
    END IF;

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    -- A3-36: the approval deadline the job page counts down (autoCompleteAt: helper_completed_at +
    -- APPROVAL_WINDOW_HOURS), in Louisiana time.
    v_approve_by := to_char((NEW.helper_completed_at + interval '24 hours') AT TIME ZONE 'America/Chicago',
                            'Dy, Mon FMDD "at" FMHH12:MI AM');
    -- Q2361: the photos waiting for the poster, counted from the row the completion wrote. Blank or NULL entries
    -- are not photos (cardinality() would count them).
    v_after := (SELECT count(*) FROM unnest(COALESCE(NEW.proof_after_urls, '{}'::text[])) AS p(path) WHERE COALESCE(btrim(p.path), '') <> '');
    IF v_after > 0 THEN
      v_msg := v_helper_name || ' finished "' || NEW.title || '" and added ' || v_after::text
        || CASE WHEN v_after = 1 THEN ' after photo' ELSE ' after photos' END
        || '. Next: review them and approve by ' || v_approve_by || ', or Helpr support steps in.';
    ELSE
      v_msg := v_helper_name || ' has finished "' || NEW.title || '". Next: check the work and approve by '
        || v_approve_by || ', or Helpr support steps in.';
    END IF;
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/posts?job=' || NEW.id::text;

  ELSE
    RETURN NEW;
  END IF;

  -- Check in-app pref for poster
  SELECT
    CASE v_category
      WHEN 'transit_updates' THEN COALESCE(transit_updates, true)
      WHEN 'work_status' THEN COALESCE(work_status, true)
      ELSE true
    END INTO v_pref_in_app
  FROM public.notification_preferences WHERE user_id = NEW.customer_id;

  IF COALESCE(v_pref_in_app, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);
  ELSE
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'skipped', v_title, NEW.id, 'preference_off');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_poster_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_poster_on_status_change() TO service_role;
