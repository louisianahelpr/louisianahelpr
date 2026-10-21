-- Owner, 2026-10-21 (jobs handoff 2, item 1): after a booked job's date or
-- time changes, BOTH sides confirm the new slot. respond_job_schedule_change
-- moved the job but left poster_confirmed_at and helper_dayof_confirmed_at as
-- they were, so a confirmation given for the OLD slot read as confirmed for
-- the new one. Measured on prod 2026-10-21 (read-only), job 7c6deb77 "Mow two
-- lawns": poster_confirmed_at 2026-10-20 22:01Z; the Helpr's change request
-- (Wed Oct 21 12:00 -> Thu Oct 22 09:00 CT) accepted 22:50Z; the stamp still
-- set.
--
-- 1. zz_jobs_schedule_move_clears_confirms: a BEFORE UPDATE trigger that
--    clears both confirmations whenever a booked, not-yet-under-way job's
--    date_needed or start_time changes (the Helpr's only when the new start
--    is more than 2h15m away: the repost sweep, see the body). Every path that moves a booked job
--    gets it (today respond_job_schedule_change is the only client-reachable
--    one; the column locks refuse a direct move). It sorts AFTER
--    trg_helper_jobs_column_whitelist and trg_poster_jobs_money_lock, so those
--    locks judge the caller's own write and never see this clear (the same
--    ordering zz_jobs_arrival_integrity relies on); no lock is restated and
--    no carve-out is added. It only ever clears, never stamps, so it hands
--    nobody a confirmation.
-- 2. One-time data fix: a still-booked job (accepted, not under way, start
--    ahead) whose latest ACCEPTED change was decided after a confirmation
--    loses that stale confirmation. Idempotent (a second run finds nothing).
--
-- Proof: node src/test/pglite/scheduleChangeClearsConfirms.pglite.mjs (red on
-- the chain on main with NEW_MIGRATION=skip; 3x apply).
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.jobs_schedule_move_clears_confirms()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed
      OR NEW.start_time IS DISTINCT FROM OLD.start_time)
     AND OLD.status::text = 'accepted'
     AND OLD.helper_on_the_way_at IS NULL THEN
    NEW.poster_confirmed_at := NULL;
    -- The Helpr's day-of confirm is cleared only while the new start leaves
    -- time to give it again: sweep_confirm_reminders_and_repost (every 5 min)
    -- hands back an accepted job starting within 2 hours that has no day-of
    -- confirm, so clearing it on a short-notice move (a "push me an hour"
    -- the Helpr asked for) would take the job off them minutes after they
    -- agreed (lh-authz-rls review M1). 2h15m = that window plus one sweep.
    IF ((NEW.date_needed + COALESCE(NEW.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
       > now() + interval '2 hours 15 minutes' THEN
      NEW.helper_dayof_confirmed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.jobs_schedule_move_clears_confirms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_jobs_schedule_move_clears_confirms ON public.jobs;
CREATE TRIGGER zz_jobs_schedule_move_clears_confirms
  BEFORE UPDATE OF date_needed, start_time ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_schedule_move_clears_confirms();

-- 2. One-time data fix (idempotent).
UPDATE public.jobs j
   SET poster_confirmed_at = CASE WHEN j.poster_confirmed_at < c.decided_at THEN NULL ELSE j.poster_confirmed_at END,
       -- The Helpr's only outside the 2-hour repost window, as in the trigger.
       helper_dayof_confirmed_at = CASE WHEN j.helper_dayof_confirmed_at < c.decided_at
                                         AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
                                             > now() + interval '2 hours 15 minutes'
                                        THEN NULL ELSE j.helper_dayof_confirmed_at END
  FROM (SELECT DISTINCT ON (r.job_id) r.job_id, r.decided_at
          FROM public.job_schedule_change_requests r
         WHERE r.status = 'accepted' AND r.decided_at IS NOT NULL
         ORDER BY r.job_id, r.decided_at DESC) c
 WHERE c.job_id = j.id
   AND j.status::text = 'accepted'
   AND j.helper_on_the_way_at IS NULL
   AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now()
   AND (j.poster_confirmed_at < c.decided_at OR j.helper_dayof_confirmed_at < c.decided_at);
