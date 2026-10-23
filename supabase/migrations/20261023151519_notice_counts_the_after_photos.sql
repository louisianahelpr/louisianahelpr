-- THE "MARKED THE JOB COMPLETE" NOTICE SAYS HOW MANY PHOTOS ARE WAITING (owner, 2026-10-23, Q2361).
--
-- Report: "ben also did not receive any before or after pictures" (Mow two lawns 7c6deb77). The poster's bell
-- said 'Yusef H. has finished "Mow two lawns". Please review and confirm.' and nothing told him photos were
-- there to look at before approving. Now, when the Helpr's completion carries after photos:
--   'Yusef H. finished "Mow two lawns" and added 2 after photos. Review them and confirm.'
-- One photo reads "1 after photo". No after photo (a job that does not ask for photos) keeps the old sentence.
--
-- The body is prod's notify_poster_on_status_change as read with pg_get_functiondef on 2026-10-23 (newest in the
-- tree: 20261021061341_member_display_name.sql), with ONLY the completed branch's v_msg changed. Same signature,
-- same SECURITY DEFINER / search_path, same trigger: CREATE OR REPLACE keeps every grant and the trigger binding.
-- A crew job's photos live per member (group_job_helpers), not on jobs.proof_after_urls, so a crew notice keeps
-- the old sentence (the count would be 0).
-- Proof: src/test/pglite/noticeCountsTheAfterPhotos.pglite.mjs (3x replay, red with LH_PROOF_REVERT=1).

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
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    -- Q2361: the photos waiting for the poster, counted from the row the completion wrote. Blank or NULL entries
    -- are not photos (cardinality() would count them).
    v_after := (SELECT count(*) FROM unnest(COALESCE(NEW.proof_after_urls, '{}'::text[])) AS p(path) WHERE COALESCE(btrim(p.path), '') <> '');
    IF v_after > 0 THEN
      v_msg := v_helper_name || ' finished "' || NEW.title || '" and added ' || v_after::text
        || CASE WHEN v_after = 1 THEN ' after photo' ELSE ' after photos' END || '. Review them and confirm.';
    ELSE
      v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';
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
