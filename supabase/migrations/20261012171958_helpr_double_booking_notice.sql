-- Q1326 (owner decision 2026-10-12): a Helpr MAY be hired for two jobs at
-- overlapping times. When it happens, the Helpr is told clearly that they are
-- already booked at that time and need to get one of the jobs rescheduled:
-- an in-app notice on the job card (my_schedule_clashes(), read by the
-- Activity cards) and a notification (job_updates, which the existing
-- notification system delivers in-app and by push).
--
-- So no hire path is refused for a clash (accept_application,
-- respond_to_direct_offer and accept_group_application are unchanged). A date
-- or time CHANGE still refuses a clash (request/respond_job_schedule_change,
-- Q736/Q925): that rule is a different promise (never move a booking INTO a
-- clash), and it stands.
--
-- "A clash", built on the overlap rule Q736 uses for schedule changes: two of
-- the Helpr's bookings on the same date, both with a start time, whose
-- [start, start + estimated_hours (1 h when unset)) windows overlap. A
-- time-less booking ("any time that day") is flexible and never clashes.
-- A booking is
--   * their own hire: jobs.helper_id = them, accepted or in progress, not
--     marked done (jobs.helper_completed_at IS NULL); or
--   * an accepted crew seat: a group_job_helpers row 'accepted' they have not
--     marked done (its own helper_completed_at), on a crew job that is still
--     filling ('open') or booked ('accepted'/'in_progress'). A crew stays
--     'open' while its seats fill (accept_group_application inserts the seat
--     first and never sets jobs.helper_id), so a seat counts from the moment
--     it is taken (lh-authz-rls review, 2026-10-12).
-- Only bookings dated today (Louisiana) or later: a clash that is over is not
-- worth a "get one rescheduled".
-- The schedule-change checks (request/respond_job_schedule_change) keep their
-- own copy of the older rule (no still-filling crew seat, no seat-level done):
-- aligning them is Q1676.
--
-- Replay-safe: CREATE OR REPLACE / DROP TRIGGER IF EXISTS throughout.

-- ── 1. The rule (internal) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.helpr_booking_clashes(p_helper_id uuid)
RETURNS TABLE (job_id uuid, other_job_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH b AS (
    SELECT j.id,
           j.date_needed,
           j.date_needed + j.start_time AS starts,
           j.date_needed + j.start_time
             + make_interval(mins => round(COALESCE(j.estimated_hours, 1) * 60)::int) AS ends
      FROM public.jobs j
     WHERE p_helper_id IS NOT NULL
       AND j.date_needed IS NOT NULL
       AND j.date_needed >= (now() AT TIME ZONE 'America/Chicago')::date
       AND j.start_time IS NOT NULL
       AND ((j.helper_id = p_helper_id
             AND j.status::text IN ('accepted', 'in_progress')
             AND j.helper_completed_at IS NULL)
            OR (j.status::text IN ('open', 'accepted', 'in_progress')
                AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                             WHERE g.job_id = j.id AND g.helper_id = p_helper_id
                               AND g.status = 'accepted'
                               AND g.helper_completed_at IS NULL)))
  )
  SELECT a.id, o.id
    FROM b a
    JOIN b o ON o.id <> a.id AND o.date_needed = a.date_needed
   WHERE (a.starts, a.ends) OVERLAPS (o.starts, o.ends);
$fn$;

REVOKE ALL ON FUNCTION public.helpr_booking_clashes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_booking_clashes(uuid) TO service_role;

-- ── 2. The in-app notice's read (the caller's own bookings only) ────────────
CREATE OR REPLACE FUNCTION public.my_schedule_clashes()
RETURNS TABLE (job_id uuid, other_job_id uuid, other_title text, other_date date, other_start_time time)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT c.job_id, c.other_job_id, o.title, o.date_needed, o.start_time
    FROM public.helpr_booking_clashes(auth.uid()) c
    JOIN public.jobs o ON o.id = c.other_job_id
   WHERE auth.uid() IS NOT NULL
   ORDER BY c.job_id, o.date_needed, o.start_time;
$fn$;

REVOKE ALL ON FUNCTION public.my_schedule_clashes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_schedule_clashes() TO authenticated;

-- ── 3. The notification, when a booking starts or moves into a clash ────────
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
    SELECT j.title, j.date_needed INTO v_title, v_date FROM public.jobs j WHERE j.id = v_job;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_helper, v_job,
      'You''re booked for two jobs at the same time',
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
    RAISE WARNING 'notify_helpr_of_booking_clash: % (job %, helper %)', SQLERRM, v_job, v_helper;
    BEGIN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES ('error', 'Double-booking notice not sent: ' || SQLERRM,
              format('/admin?view=jobs&job=%s', v_job),
              jsonb_build_object('source', 'notify_helpr_of_booking_clash', 'origin', 'server'),
              jsonb_build_object('job_id', v_job, 'helper_id', v_helper));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the WARNING above is the last resort; a hire is never refused for a log row
    END;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_helpr_of_booking_clash() FROM PUBLIC, anon, authenticated;

-- A solo hire (accept_application, respond_to_direct_offer) sets helper_id and
-- status 'accepted'; a booked job whose date, time or length changes can move
-- into a clash too (a schedule change refuses that, but a race between two
-- changes could still land one: now it is told, not lost).
DROP TRIGGER IF EXISTS zz_notify_helpr_of_booking_clash ON public.jobs;
CREATE TRIGGER zz_notify_helpr_of_booking_clash
  AFTER UPDATE OF helper_id, status, date_needed, start_time, estimated_hours ON public.jobs
  FOR EACH ROW
  WHEN (NEW.helper_id IS NOT NULL
        AND NEW.status::text IN ('accepted', 'in_progress')
        AND (OLD.helper_id IS DISTINCT FROM NEW.helper_id
             OR OLD.status::text NOT IN ('accepted', 'in_progress')
             OR OLD.date_needed IS DISTINCT FROM NEW.date_needed
             OR OLD.start_time IS DISTINCT FROM NEW.start_time
             OR OLD.estimated_hours IS DISTINCT FROM NEW.estimated_hours))
  EXECUTE FUNCTION public.notify_helpr_of_booking_clash();

-- A booking INSERTED already booked: charge-recurring-visits writes each
-- series visit with helper_id set and status 'accepted' (lh-authz-rls review).
DROP TRIGGER IF EXISTS zz_notify_helpr_of_booking_clash_new ON public.jobs;
CREATE TRIGGER zz_notify_helpr_of_booking_clash_new
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (NEW.helper_id IS NOT NULL AND NEW.status::text IN ('accepted', 'in_progress'))
  EXECUTE FUNCTION public.notify_helpr_of_booking_clash();

-- A crew seat (accept_group_application) is taken: the row is inserted
-- 'accepted' (the column default) while the crew job is still 'open'.
DROP TRIGGER IF EXISTS zz_notify_helpr_of_booking_clash_ins ON public.group_job_helpers;
CREATE TRIGGER zz_notify_helpr_of_booking_clash_ins
  AFTER INSERT ON public.group_job_helpers
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_helpr_of_booking_clash();

DROP TRIGGER IF EXISTS zz_notify_helpr_of_booking_clash_upd ON public.group_job_helpers;
CREATE TRIGGER zz_notify_helpr_of_booking_clash_upd
  AFTER UPDATE OF status ON public.group_job_helpers
  FOR EACH ROW
  WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_helpr_of_booking_clash();
