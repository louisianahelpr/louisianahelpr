-- F435 (whole-app audit 11-10, Worker 5, Low): three "Hallie H. has arrived" notices for three different jobs looked
-- the same in the bell and on the lock screen; only the line under the title named the job. The arrival title now
-- leads with the job: "Paint a fence: Hallie H. has arrived". A job title longer than 22 characters is cut to 21 (trailing space dropped) and
-- an ellipsis, so the news ("has arrived") still fits a lock-screen title; the full title stays in the message.
--
-- notify_poster_on_status_change is restated VERBATIM from its newest definition (20261110202142, wording only),
-- changing only the arrival v_title line. No branch, link, type, email path or grant moves. The title is not keyed on
-- anywhere (sms_kind_for / jobs_notice_email_type / declutter_notice_type read transit_updates by type, not title);
-- the departed-member scrub (20261103022806) replaces a name anywhere in the text, so it still works.
--
-- Replay-safe: CREATE OR REPLACE of an existing trigger function; trigger untouched; grants restated as live.
-- Proof: src/test/pglite/arrivalNoticeLeadsWithTheJob.pglite.mjs (red without this migration, green with it, 3x).

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
  v_link text;
  v_after int;
  v_approve_by text;
  v_moved_day date;
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
    -- CHANGED 20261111194335 (F435): the title leads with the job, so arrivals on different jobs differ at a glance.
    v_title := CASE WHEN char_length(btrim(COALESCE(NEW.title, ''))) > 22
                    THEN rtrim(left(btrim(NEW.title), 21)) || '…'
                    ELSE NULLIF(btrim(COALESCE(NEW.title, '')), '') END;
    v_title := COALESCE(v_title || ': ', '') || v_helper_name || ' has arrived';
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
        || '. Next: review them and approve by ' || v_approve_by || '. If you don''t, our team reviews it and tells you what happens next.';
    ELSE
      v_msg := v_helper_name || ' has finished "' || NEW.title || '". Next: check the work and approve by '
        || v_approve_by || '. If you don''t, our team reviews it and tells you what happens next.';
    END IF;
    -- CHANGED 20261108160000 (lead 11-08): a done on a continue day without a new after photo says so first.
    SELECT c.new_date INTO v_moved_day
      FROM public.job_continue_days c
     WHERE c.job_id = NEW.id AND c.done_without_new_photo_at = NEW.helper_completed_at
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_moved_day IS NOT NULL THEN
      v_msg := 'No new photos from ' || to_char(v_moved_day, 'FMDy FMMM/FMDD') || ' — check the work before approving. ' || v_msg;
    END IF;
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/posts?job=' || NEW.id::text;

  ELSE
    RETURN NEW;
  END IF;

  -- CHANGED 20261108160000 (owner 11-08, F5): the in-app row is ALWAYS written. The poster's switch for the category
  -- ("Helpr on the way" = transit_updates, "Work status" = work_status) gates the PUSH only, which
  -- fan_out_push_on_notification already does through notification_type_pref_map. Before, a switch that was off
  -- skipped the row itself, so the notifications list had no record that the Helpr set out or arrived.
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
  PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);

  -- CHANGED 20261108160000 (F5/F6): on the way and arrived email under "Helpr on the way" (email_transit_updates),
  -- marked complete under "Work status" (email_work_status). send-notification-email reads the switch for the type,
  -- the email master switch, and refuses test and seed recipients; "Work has started" keeps its own path.
  IF v_category = 'transit_updates'
     OR (NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL) THEN
    PERFORM public.send_notice_email(NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_poster_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_poster_on_status_change() TO service_role;
