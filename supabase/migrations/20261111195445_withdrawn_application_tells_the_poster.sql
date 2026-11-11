-- F297 (whole-app audit 11-10, Worker 2, Low): after a Helpr withdrew, the poster's bell still read "<Name> applied to
-- "<job>". Next: review and pick a Helpr ..." and opened a job that says "No applicants yet", with nothing saying why.
--
-- Withdraw is the applicant's own DELETE of their PENDING application (AppliedJobsTab.confirmWithdraw; RLS allows only
-- that). No server function deletes applications rows, and a job or account delete removes them by cascade or as the
-- server, never inside the applicant's own session. So this AFTER DELETE trigger acts only when the row was pending AND
-- the deleting session is the applicant (auth.uid() = OLD.helper_id): a withdraw, nothing else.
--
-- What it does, only while the job is still open and the two members are not blocked either way:
--   1. tells the poster: "Application withdrawn" / '<First L.> withdrew from "<job>".' and the next step: with other
--      applicants waiting, "Next: review the other applicants."; with none, "Your job is still open for new
--      applicants." (type 'application', link /posts?job=<id>, job_id set so the bell can show the Helpr's face as
--      on other job notices, notifications_stamp_actor);
--   2. marks the poster's still-unread "<First L.> applied to "<job>"" notice for that job read, so it stops asking
--      them to review an applicant who is gone. Only the read flag moves; nothing is deleted.
-- A deleted profile or a blank name reads "Someone", as notify_on_application.
--
-- Replay-safe: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. The function is a trigger: no EXECUTE for PUBLIC, anon,
-- authenticated. Proof: src/test/pglite/withdrawnApplicationTellsThePoster.pglite.mjs (red without, green with, 3x).

CREATE OR REPLACE FUNCTION public.notify_poster_on_application_withdrawn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_name text;
  v_left int;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending'::application_status OR auth.uid() IS DISTINCT FROM OLD.helper_id THEN
    RETURN OLD;
  END IF;

  SELECT j.id, j.title, j.customer_id, j.status::text AS status INTO v_job FROM public.jobs j WHERE j.id = OLD.job_id;
  IF v_job.id IS NULL OR v_job.customer_id IS NULL OR v_job.customer_id = OLD.helper_id OR v_job.status <> 'open' THEN
    RETURN OLD;
  END IF;
  IF COALESCE(public.are_users_blocked(OLD.helper_id, v_job.customer_id), true) THEN
    RETURN OLD;
  END IF;

  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_name FROM public.profiles p WHERE p.user_id = OLD.helper_id;
  v_name := COALESCE(v_name, 'Someone');

  SELECT count(*) INTO v_left FROM public.applications a
   WHERE a.job_id = OLD.job_id AND a.status = 'pending'::application_status AND a.id <> OLD.id;

  -- 2. The stale "applied" notice stops asking for a review (read flag only).
  UPDATE public.notifications n
     SET read = true
   WHERE n.user_id = v_job.customer_id
     AND n.type = 'application'
     AND n.read = false
     AND n.link = '/posts?job=' || OLD.job_id::text
     AND n.message LIKE replace(replace(replace(v_name, '\', '\\'), '%', '\%'), '_', '\_') || ' applied to %';

  -- 1. The poster hears it.
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_job.customer_id,
    'Application withdrawn',
    v_name || ' withdrew from "' || COALESCE(NULLIF(btrim(v_job.title), ''), 'your job') || '".'
      || CASE WHEN v_left > 0 THEN ' Next: review the other applicants.' ELSE ' Your job is still open for new applicants.' END,
    'application',
    '/posts?job=' || OLD.job_id::text,
    OLD.job_id
  );

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_poster_on_application_withdrawn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_poster_on_application_withdrawn() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_poster_on_application_withdrawn ON public.applications;
CREATE TRIGGER trg_notify_poster_on_application_withdrawn
  AFTER DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_application_withdrawn();
