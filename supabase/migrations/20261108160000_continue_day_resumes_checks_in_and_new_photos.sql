-- CONTINUE ANOTHER DAY, FINISHED PROPERLY (owner 11-08, Yusef's job 7b1da54b; audit
-- ~/.lh-shots/handoffs-1108/b5-jobs-notify-audit.md, every fix picked).
--
-- What was wrong, measured on prod 11-08:
--   F1  A continue day whose time had passed held the job for good: stalled-completion-reminder and auto-release
--       skip every job with a 'proposed'/'set' row, and a 'set' row closes only on done, approval or a status change.
--       7b1da54b's day (11/06 3:15 PM) passed ~40 h earlier: no nudge to either side, no admin queue, escrow held.
--       (The edge half of that fix is _shared/continueDay.ts: the hold now ends at the day's start + a grace.)
--   F2  On the new day the poster could get no "on the way", "arrived" or "started": those stamps keep day 1's value
--       (COALESCE) and the status is already in_progress.
--   F3  Agreeing a day cleared jobs.helper_completed_at but left job_tracking.status = 'done', so the rail showed
--       Done for both sides and the tracker offered no next step.
--   Q2  Mark done on the new day passed the photo gate on day 1's photos (of unfinished work).
--   F4  Continue-day notices were push + in-app only; a Helpr with no push device got nothing outside the app.
--   F5  "Helpr on the way" off skipped the in-app row too; its email switch did nothing.
--   F6  "Marked the job complete" never emailed.
--
-- What this does:
--   1. job_continue_days.new_after_photo_at: the first after photo added once the new day's check-in window is open
--      (2 hours before its start, the same window On my way uses). Stamped by a trigger on jobs.proof_after_urls.
--   2. refuse_done_before_continue_day (restated from 20261101231015) also refuses the Helpr's done on a set day
--      until that photo exists (continue_day_needs_new_after_photo), when the job needs photos. Day-1 photos stay.
--   3. When a day is agreed (status -> 'set'): the job's tracking row goes back to 'job_confirmed', so the new day
--      runs On my way -> I've arrived -> Start working -> Mark it done again (an older app shows Start working), and
--      an un-escalated stalled-nudge ledger row is cleared so the ladder starts over for the new day.
--   4. Check-ins on the new day: On my way / I've arrived / Start working (job_tracking status) write
--      job_continue_events and tell the poster as job_updates (never the transit switch), once per step per day.
--      Before the window opens they are refused (continue_day_not_yet).
--   5. sweep_job_continue_day_reminders (restated from 20261101231015) adds the evening check-in to both sides.
--   6. send_notice_email(): one fire-and-forget call to send-notification-email (which reads the email switch for
--      the type, the master switch, and refuses test/seed recipients). Continue-day notices email through a trigger
--      on their fixed titles; notify_poster_on_status_change (restated from 20261102235342) always writes the in-app
--      row and emails on the way / arrived (email_transit_updates) and marked complete (email_work_status).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS before each CREATE TRIGGER, and the
-- nudge ledger is touched only when it exists. Proof: src/test/pglite/continueDayResumes.pglite.mjs (applied 3x).
-- Guard: src/test/continueDayResumes.test.ts.

ALTER TABLE public.job_continue_days ADD COLUMN IF NOT EXISTS new_after_photo_at timestamptz;

-- ── 6. One email call ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_notice_email(p_user_id uuid, p_title text, p_message text, p_type text, p_link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'send_notice_email: vault secrets missing, email not sent (%: %)', p_type, p_title;
    PERFORM public.log_notification(p_user_id, p_type, 'email', 'failed', p_title, NULL, 'vault secrets missing');
    RETURN;
  END IF;
  -- An email that cannot be queued must never roll back the job change that caused it (a Helpr's Mark done). It is
  -- not silent: the warning reaches the Postgres log and the failure is a notification_logs row.
  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/send-notification-email',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'message', p_message, 'type', p_type, 'link', p_link)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_notice_email: % (%: %)', SQLERRM, p_type, p_title;
    PERFORM public.log_notification(p_user_id, p_type, 'email', 'failed', p_title, NULL, left(SQLERRM, 300));
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.send_notice_email(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_notice_email(uuid, text, text, text, text) TO service_role;

-- Continue-day notices (their fixed titles; every sender is server-built words) email under "Job updates".
CREATE OR REPLACE FUNCTION public.email_continue_day_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, NEW.type, NEW.link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.email_continue_day_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_continue_day_notice ON public.notifications;
CREATE TRIGGER trg_email_continue_day_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type = 'job_updates' AND NEW.job_id IS NOT NULL
        AND NEW.title IN (
          -- propose_job_continue_day
          'New day to finish', 'Your Helpr needs another day',
          -- answer_job_continue_day
          'New day accepted', 'New day declined', 'Another day confirmed', 'Another day declined',
          -- confirm_job_continue_day
          'Your Helpr confirmed',
          -- sweep_job_continue_day_reminders
          'Back on your job in 2 hours', 'Your Helpr is back in 2 hours', 'Confirm you''ll be back today',
          'Your Helpr hasn''t confirmed today', 'Did you finish today?', 'Not marked done yet'))
  EXECUTE FUNCTION public.email_continue_day_notice();

-- ── 1. The new after photo ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_continue_day_after_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(NEW.proof_after_urls, '{}'::text[])) AS u(path)
     WHERE COALESCE(btrim(u.path), '') <> ''
       AND u.path <> ALL (COALESCE(OLD.proof_after_urls, '{}'::text[]))
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE public.job_continue_days c
     SET new_after_photo_at = now()
   WHERE c.job_id = NEW.id
     AND c.status = 'set'
     AND c.new_after_photo_at IS NULL
     AND now() >= ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') - interval '2 hours';
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.stamp_continue_day_after_photo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_stamp_continue_day_after_photo ON public.jobs;
CREATE TRIGGER trg_stamp_continue_day_after_photo
  AFTER UPDATE OF proof_after_urls ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_continue_day_after_photo();

-- ── 2. Done on a set day needs that photo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refuse_done_before_continue_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_day date;
  v_new_photo timestamptz;
  v_found boolean;
BEGIN
  IF public.is_server_context() OR NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.new_date, c.new_after_photo_at, true INTO v_day, v_new_photo, v_found
    FROM public.job_continue_days c
   WHERE c.job_id = OLD.id AND c.status = 'set';
  IF v_day IS NOT NULL AND (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
    RAISE EXCEPTION 'continue_day_ahead' USING ERRCODE = '23514',
      HINT = 'This job continues on ' || to_char(v_day, 'FMDy FMMM/FMDD') || '. Mark it done once you finish that day.';
  END IF;
  -- CHANGED 20261108160000 (owner 11-08): the finished work is shown by a photo from the new day. Day 1's photos stay
  -- on the job as history; they no longer count for the done.
  IF COALESCE(v_found, false) AND COALESCE(NEW.require_photo_proof, true) AND v_new_photo IS NULL THEN
    RAISE EXCEPTION 'continue_day_needs_new_after_photo' USING ERRCODE = '23514',
      HINT = 'Add an after photo from today before you mark it done. Your earlier photos stay on the job.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_done_before_continue_day() FROM PUBLIC, anon, authenticated;

-- ── 3. A day agreed: the tracker starts the new day; the stalled ladder starts over ──
CREATE OR REPLACE FUNCTION public.continue_day_on_agreed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status <> 'set' OR (TG_OP = 'UPDATE' AND OLD.status = 'set') THEN
    RETURN NULL;
  END IF;
  -- Rows written on day 1 only: 'job_confirmed' is the step before On my way, never a gated step.
  UPDATE public.job_tracking
     SET status = 'job_confirmed', updated_at = now()
   WHERE job_id = NEW.job_id AND status IN ('on_the_way', 'arrived', 'working', 'done');
  -- A nudge cycle that never reached an admin restarts from the new day. An escalated row stays (a person has it).
  IF to_regclass('public.job_completion_nudges') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.job_completion_nudges WHERE job_id = $1 AND escalated_at IS NULL' USING NEW.job_id;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.continue_day_on_agreed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_continue_day_on_agreed ON public.job_continue_days;
CREATE TRIGGER trg_continue_day_on_agreed
  AFTER INSERT OR UPDATE OF status ON public.job_continue_days
  FOR EACH ROW EXECUTE FUNCTION public.continue_day_on_agreed();

-- ── 4. Check-ins on the new day ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.continue_day_check_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row record;
  v_job record;
  v_action text;
  v_name text;
  v_title text;
  v_msg text;
  v_starts timestamptz;
BEGIN
  IF NEW.status NOT IN ('on_the_way', 'arrived', 'working') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  SELECT c.id, c.new_date, c.new_start_time INTO v_row
    FROM public.job_continue_days c
   WHERE c.job_id = NEW.job_id AND c.status = 'set';
  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.is_group_job INTO v_job FROM public.jobs j WHERE j.id = NEW.job_id;
  IF v_job.id IS NULL OR v_job.is_group_job IS TRUE OR v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN
    RETURN NULL;
  END IF;
  v_starts := (v_row.new_date + v_row.new_start_time) AT TIME ZONE 'America/Chicago';
  IF now() < v_starts - interval '2 hours' THEN
    IF public.is_server_context() THEN
      RETURN NULL; -- a server writer is never refused, and nothing is announced before the day
    END IF;
    RAISE EXCEPTION 'continue_day_not_yet' USING ERRCODE = '23514',
      HINT = 'This job continues ' || public.continue_day_label(v_row.new_date, v_row.new_start_time)
             || '. You can check in from 2 hours before.';
  END IF;
  v_action := CASE NEW.status WHEN 'on_the_way' THEN 'helpr_on_the_way' WHEN 'arrived' THEN 'helpr_arrived' ELSE 'helpr_started' END;
  IF EXISTS (SELECT 1 FROM public.job_continue_events e WHERE e.continue_id = v_row.id AND e.action = v_action) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
  VALUES (NEW.job_id, v_row.id, NEW.helper_id, v_action, '{}'::jsonb);
  IF v_job.customer_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(NULLIF(split_part(public.member_display_name(p.full_name, NULL), ' ', 1), ''), 'Your Helpr') INTO v_name
    FROM public.profiles p WHERE p.user_id = NEW.helper_id;
  v_name := COALESCE(v_name, 'Your Helpr');
  IF NEW.status = 'on_the_way' THEN
    v_title := v_name || ' is on the way back';
    v_msg := v_name || ' is heading back to finish "' || COALESCE(v_job.title, 'your job') || '". Next: nothing for you to do until they arrive.';
  ELSIF NEW.status = 'arrived' THEN
    v_title := v_name || ' is back at the job';
    v_msg := v_name || ' is back to finish "' || COALESCE(v_job.title, 'your job') || '". Next: nothing for you to do; they mark it done when they finish.';
  ELSE
    v_title := v_name || ' started working again';
    v_msg := v_name || ' started working on "' || COALESCE(v_job.title, 'your job') || '" again. They mark it done when they finish.';
  END IF;
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (v_job.customer_id, NEW.job_id, v_title, v_msg, 'job_updates', '/posts?job=' || NEW.job_id::text);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.continue_day_check_in() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_continue_day_check_in ON public.job_tracking;
CREATE TRIGGER trg_continue_day_check_in
  AFTER INSERT OR UPDATE OF status ON public.job_tracking
  FOR EACH ROW EXECUTE FUNCTION public.continue_day_check_in();

-- ── 5. The evening check-in (restated from 20261101231015; only the two evening kinds are new) ──
CREATE OR REPLACE FUNCTION public.sweep_job_continue_day_reminders(p_now timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  rec record;
  v_claimed integer;
  v_sent integer := 0;
BEGIN
  FOR rec IN
    WITH active AS (
      SELECT c.id AS continue_id, c.new_date, c.new_start_time, c.helper_confirmed_at,
             j.id AS job_id, j.title, j.customer_id, j.helper_id,
             ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') AS starts_at,
             -- CHANGED 20261108160000 (owner 11-08, Yusef's job): the evening check-in on the new day, 7 PM Central or
             -- 2 hours after the start, whichever is later.
             GREATEST(((c.new_date + time '19:00') AT TIME ZONE 'America/Chicago'),
                      ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') + interval '2 hours') AS evening_at
        FROM public.job_continue_days c
        JOIN public.jobs j ON j.id = c.job_id
       WHERE c.status = 'set'
         AND j.status::text = 'in_progress'
         AND j.helper_id IS NOT NULL
         AND j.helper_completed_at IS NULL
    )
    SELECT a.*, k.kind
      FROM active a
      CROSS JOIN LATERAL (VALUES
        -- 2 hours before, up to 15 minutes late (cron every 10), to each side.
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_helpr' END),
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_poster' END),
        -- The day-of confirm ask: from 7 AM Central on the new day (or 3 hours before an earlier start), until the start.
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= LEAST(((a.new_date + time '07:00') AT TIME ZONE 'America/Chicago'), a.starts_at - interval '3 hours')
               AND v_now < a.starts_at THEN 'confirm_ask' END),
        -- 30 minutes past the new start without the Helpr's confirm: tell the poster (nothing is marked).
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= a.starts_at + interval '30 minutes'
               AND v_now < a.starts_at + interval '6 hours' THEN 'not_confirmed_poster' END),
        -- CHANGED 20261108160000: the evening of the new day, still not marked done: ask the Helpr and tell the poster.
        (CASE WHEN v_now >= a.evening_at AND v_now < a.evening_at + interval '6 hours' THEN 'evening_not_done_helpr' END),
        (CASE WHEN v_now >= a.evening_at AND v_now < a.evening_at + interval '6 hours' THEN 'evening_not_done_poster' END)
      ) AS k(kind)
     WHERE k.kind IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.job_continue_reminder_sends s WHERE s.continue_id = a.continue_id AND s.kind = k.kind)
     ORDER BY a.starts_at
     LIMIT 300
  LOOP
    INSERT INTO public.job_continue_reminder_sends (continue_id, kind, sent_at)
    VALUES (rec.continue_id, rec.kind, v_now)
    ON CONFLICT (continue_id, kind) DO NOTHING;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    CONTINUE WHEN v_claimed = 0;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask', 'evening_not_done_helpr') THEN rec.helper_id ELSE rec.customer_id END,
      rec.job_id,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN 'Back on your job in 2 hours'
        WHEN 'two_hours_poster' THEN 'Your Helpr is back in 2 hours'
        WHEN 'confirm_ask' THEN 'Confirm you''ll be back today'
        WHEN 'evening_not_done_helpr' THEN 'Did you finish today?'
        WHEN 'evening_not_done_poster' THEN 'Not marked done yet'
        ELSE 'Your Helpr hasn''t confirmed today'
      END,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN format('"%s" continues today at %s.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'two_hours_poster' THEN format('Your Helpr comes back to finish "%s" today at %s.', COALESCE(rec.title, 'your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'confirm_ask' THEN format('"%s" continues today at %s. Confirm you''ll be there.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'evening_not_done_helpr' THEN format('"%s" was set to finish today. Done? Add an after photo from today and mark it done. Not done? Set another day.', COALESCE(rec.title, 'Your job'))
        WHEN 'evening_not_done_poster' THEN format('Your Helpr hasn''t marked "%s" done today. Message them, or set another day. Your payment stays held.', COALESCE(rec.title, 'your job'))
        ELSE format('"%s" was set to continue at %s and your Helpr hasn''t confirmed. Message them, or set another day.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
      END,
      'job_updates',
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask', 'evening_not_done_helpr') THEN '/jobs?job=' ELSE '/posts?job=' END || rec.job_id::text
    );
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (rec.job_id, rec.continue_id, NULL, 'reminder', jsonb_build_object('kind', rec.kind));
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) TO service_role;

-- ── F5/F6: the poster's status notices (restated VERBATIM from 20261102235342 except its in-app tail) ──
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
    PERFORM public.send_notice_email(NEW.customer_id, v_title, v_msg, v_category, v_link);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_poster_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_poster_on_status_change() TO service_role;
