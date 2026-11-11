-- F444 (whole-app audit 11-10, Bell > All as a Helpr): the same "Two jobs booked
-- at the same time" notice showed three times in the bell (1 h, 10 h and 12 h
-- ago). notify_helpr_of_booking_clash (20261012171958, title changed by
-- 20261110205345) inserted a new row every time one of its triggers fired: a
-- re-hire after an unassign, a date/time/length change, a crew seat re-taken.
-- Nothing checked whether the Helpr had already been told about that clash.
--
-- Fix (decided by recommendation, owner may reverse; DECISIONS-FOR-OWNER-1111):
-- no new notice while the Helpr already has one about the same pair of jobs
-- (on either job of the pair) that is still unread or is less than 24 hours
-- old. A clash between a different pair is always told, even if it shares a
-- job with an earlier one. A clash raised again after they read it and a day has passed is
-- told again, so a real new clash is never lost. The card notice
-- (my_schedule_clashes) is unchanged and still shows every live clash.
-- The old title is matched too, so unread rows written before 20261110205345
-- also count.
--
-- Body copied from the newest definition (20261110205345_push_titles_fit_lock_screen)
-- with only the IF EXISTS check added, right after the job's own title is
-- read (the check needs it). CREATE OR REPLACE: replay-safe; the
-- triggers and the REVOKE from 20261012171958 are unchanged and re-stated.
-- Proof: src/test/pglite/helprBookingClashNoticeOnce.pglite.mjs.

CREATE OR REPLACE FUNCTION public.notify_helpr_of_booking_clash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_helper uuid := NEW.helper_id;
  v_job uuid;
  v_title text;
  v_date date;
  v_other record;
  v_seed boolean;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    v_job := NEW.id;
  ELSE
    v_job := NEW.job_id;
  END IF;
  IF v_helper IS NULL OR v_job IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT o.id, o.title INTO v_other
      FROM public.helpr_booking_clashes(v_helper) c
      JOIN public.jobs o ON o.id = c.other_job_id
     WHERE c.job_id = v_job
     ORDER BY o.date_needed, o.start_time
     LIMIT 1;
    IF v_other.id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT j.title, j.date_needed, j.is_seed INTO v_title, v_date, v_seed FROM public.jobs j WHERE j.id = v_job;
    -- F444: told once. An unread or under-a-day-old notice about THIS pair
    -- already says it. The pair is read from the notice itself: it sits on one
    -- job of the pair and its message opens '"<its job>" and "<the other>"'
    -- (the format below, unchanged since 20261012171958), so a new clash that
    -- shares only one job with an earlier one is still told (review 11-11).
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = v_helper
         -- This title and the one before 20261110205345 both end so.
         AND n.title ILIKE '%two jobs%at the same time'
         AND (n.read = false OR n.created_at > now() - interval '24 hours')
         AND ((n.job_id = v_job
               AND starts_with(n.message, format('"%s" and "%s"', COALESCE(v_title, 'This job'), COALESCE(v_other.title, 'another job'))))
           OR (n.job_id = v_other.id
               AND starts_with(n.message, format('"%s" and "%s"', COALESCE(v_other.title, 'This job'), COALESCE(v_title, 'another job')))))
    ) THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_helper, v_job,
      'Two jobs booked at the same time',
      format('"%s" and "%s" overlap on %s. Please get one of them rescheduled: open either job and tap "Ask for a new date or time".',
             COALESCE(v_title, 'This job'), COALESCE(v_other.title, 'another job'),
             to_char(v_date, 'FMDy FMMon FMDD')),
      'job_updates',
      '/jobs?job=' || v_job::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never refuse a hire because its heads-up could not be written; the
    -- in-app notice on the card (my_schedule_clashes) still shows the clash.
    -- Recorded where ops reads (error_logs), best effort.
    RAISE WARNING 'notify_helpr_of_booking_clash: % (job %, user %)', SQLERRM, v_job, v_helper;
    BEGIN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES ('error', 'Double-booking notice not sent: ' || SQLERRM,
              format('/admin?view=jobs&job=%s', v_job),
              -- A seed/E2E job's failure goes to the daily digest, not the page
              -- (error_log_is_seed reads tags.seed); unknown counts as real.
              jsonb_build_object('source', 'notify_helpr_of_booking_clash', 'origin', 'server',
                                 'seed', COALESCE(v_seed, false)),
              jsonb_build_object('job_id', v_job, 'helper_id', v_helper));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the WARNING above is the last resort; a hire is never refused for a log row
    END;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_helpr_of_booking_clash() FROM PUBLIC, anon, authenticated;
