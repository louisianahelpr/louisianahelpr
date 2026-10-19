-- A BACK-OUT NOTICE ENDS WHEN ITS JOB DOES (owner-reported, 2026-10-19).
--
-- THE BUG (measured on prod 2026-10-19 ~02:00Z): sweep_backout_notice_reminders
-- (20261008205118, every 15 minutes) re-pushed an unacknowledged back-out
-- notice every 2 hours inside 24 hours of the start and never looked at the
-- job's status. The owner cancelled job 7440a72d on 10-17 20:18Z and was still
-- pushed "Offer expired: Your offer for "Mow & Weed Eat Yard" expired without
-- an answer. It's open to everyone again." 12 times, until the start passed.
-- Prod then held 74 unacknowledged notices, every one on a cancelled job
-- (oldest 10-09), all addressed to the poster (offer_declined 34,
-- offer_expired 36, helper_cancelled 4).
--
-- THE RULE, one place (backout_notice_applies): a notice that told the poster
-- "it's open to everyone again" (offer_declined, offer_expired,
-- helper_cancelled, helper_unconfirmed) is moot once the job is completed or
-- cancelled. A poster_cancelled notice IS the cancel ("Don't go." to the
-- booked Helpr), so it keeps its reminders until Got It, as designed. A job
-- an admin removes is set to 'cancelled' (AdminJobs.tsx), so status covers it.
--
-- THE FIX:
--   1. the sweep reminds only while the notice still applies, and closes
--      (acknowledged_at = now(), close_moot_backout_notices) the ones that
--      no longer do;
--   2. a trigger (trg_jobs_zz_close_backout_notices) closes them the moment
--      the job is completed or cancelled,
--      whichever path does it (poster_cancel_job, admin removal, completion);
--   3. one-time data step: closes the notices already moot on prod. It sets
--      acknowledged_at only; nothing is deleted.
-- Class guard: src/test/cronJobNotificationsCheckJobStatus.test.ts.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, the UPDATE only
-- touches rows still open.

CREATE OR REPLACE FUNCTION public.backout_notice_applies(p_kind text, p_job_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT p_kind = 'poster_cancelled'
      OR COALESCE(p_job_status, '') NOT IN ('completed', 'cancelled');
$fn$;
REVOKE ALL ON FUNCTION public.backout_notice_applies(text, text) FROM PUBLIC, anon, authenticated;

-- Close (acknowledged_at = now()) the open notices that no longer apply: one
-- job's (the trigger) or all of them (the sweep, the data step). Returns how
-- many it closed.
CREATE OR REPLACE FUNCTION public.close_moot_backout_notices(p_job uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_closed integer;
BEGIN
  UPDATE public.backout_notices n
     SET acknowledged_at = now()
    FROM public.jobs j
   WHERE j.id = n.job_id
     AND (p_job IS NULL OR n.job_id = p_job)
     AND n.acknowledged_at IS NULL
     AND NOT public.backout_notice_applies(n.backout_kind, j.status::text);
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$fn$;
REVOKE ALL ON FUNCTION public.close_moot_backout_notices(uuid) FROM PUBLIC, anon, authenticated;

-- INSIDE 24 HOURS OF THE START, A PUSH EVERY 2 HOURS UNTIL GOT IT, while the
-- job is still live. Restated from 20261008205118 with the status check.
CREATE OR REPLACE FUNCTION public.sweep_backout_notice_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r record;
  v_text record;
  v_sent integer := 0;
BEGIN
  -- A notice whose job closed after it was written has nothing left to say.
  PERFORM public.close_moot_backout_notices(NULL);

  FOR r IN
    SELECT n.id, n.user_id, n.backout_kind, n.actor_name, j.id AS job_id, j.title, j.customer_id
      FROM public.backout_notices n
      JOIN public.jobs j ON j.id = n.job_id
     WHERE n.acknowledged_at IS NULL
       AND public.backout_notice_applies(n.backout_kind, j.status::text)
       AND n.created_at < now() - interval '30 minutes'
       AND (n.last_push_at IS NULL OR n.last_push_at < now() - interval '2 hours')
       AND j.date_needed IS NOT NULL
       AND (j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago'
           BETWEEN now() AND now() + interval '24 hours'
     FOR UPDATE OF n SKIP LOCKED
  LOOP
    SELECT * INTO v_text FROM public.backout_notice_text(r.backout_kind, r.actor_name, r.title);
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (r.user_id, v_text.title, v_text.message, 'warning',
            CASE WHEN r.user_id = r.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || r.job_id::text);
    UPDATE public.backout_notices SET last_push_at = now() WHERE id = r.id;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_backout_notice_reminders() FROM PUBLIC, anon, authenticated;

-- The moment a job is completed or cancelled, its moot notices close (the
-- banner reads acknowledged_at IS NULL, so it clears too). AFTER triggers run
-- in name order: the zz_ name runs this after trg_jobs_record_backout_notice,
-- so a notice that same UPDATE writes is seen too (settle_one_off_jobs_for_
-- banned_account cancels and declines a direct offer in one statement;
-- lh-silent-failure review #1).
CREATE OR REPLACE FUNCTION public.close_backout_notices_on_closed_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.close_moot_backout_notices(NEW.id);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.close_backout_notices_on_closed_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_zz_close_backout_notices ON public.jobs;
CREATE TRIGGER trg_jobs_zz_close_backout_notices
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('completed', 'cancelled'))
  EXECUTE FUNCTION public.close_backout_notices_on_closed_job();

-- ONE-TIME DATA STEP (prod, real members' rows): close the notices already
-- moot. acknowledged_at only; nothing is deleted.
SELECT public.close_moot_backout_notices(NULL);
