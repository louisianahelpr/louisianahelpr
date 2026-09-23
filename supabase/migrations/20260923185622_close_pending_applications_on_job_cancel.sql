-- Q274: cancelling a job left its PENDING applications pending forever.
--
-- Measured on prod 2026-09-23 (Q100): create-payment cancel_escrow cancelled
-- fixture job c6c73586 and helper-e2e's application fbbbb772 stayed 'pending';
-- 20 pending applications sat on cancelled jobs (all is_seed, 0 real).
-- poster_cancel_job has the same gap: it never touches `applications` either,
-- and neither does any other path into 'cancelled' (block_user_and_settle,
-- reject_pending_job, a decided dispute, admin). So the rule lives on the job
-- itself: an AFTER UPDATE trigger on `jobs` closes the job's pending
-- applications the moment its status becomes 'cancelled', in the same
-- transaction, whichever path did it. 'cancelled' is terminal in the
-- transition matrix (20260825190000 has no edge out of it), so a closed
-- application can never sit on a job that reopened.
--
-- THE STATUS. application_status is ('pending','accepted','rejected'); the only
-- closing value is 'rejected', the one every other closing path writes
-- (decline_offer, expire_unanswered_offers, helper_cancel_booking). But
-- 'rejected' alone would LIE twice (activityFilters.ts already refused to write
-- it for that reason): notify_on_application would tell every applicant their
-- application "was not selected", and My Jobs / the poster's Applicants panel
-- would say "Not selected" / "Declined". So the close also stamps
-- `applications.closed_reason = 'job_cancelled'`, and:
--   * notify_on_application (restated from its NEWEST definition,
--     20260903012715, otherwise verbatim) sends '"<title>" was cancelled, so
--     your application is closed' instead;
--   * the client reads closed_reason to label the row "Job cancelled".
-- The backfill of the 20 existing rows sends nothing (GUC app.q274_backfill).
--
-- Pending only: an 'accepted' application on a cancelled job is the hired
-- Helpr's record, which poster_cancel_job's own notice and fee ladder own.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS closed_reason text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'applications_closed_reason_check'
       AND conrelid = 'public.applications'::regclass
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_closed_reason_check
      CHECK (closed_reason IS NULL OR closed_reason = 'job_cancelled');
  END IF;
END
$migration$;

COMMENT ON COLUMN public.applications.closed_reason IS
  'Why a pending application was closed by the system rather than by a person. job_cancelled: its job was cancelled (Q274). NULL: decided by a person (or still open).';

-- ---------------------------------------------------------------------------
-- 1. notify_on_application: a truthful notice for a job-cancel close.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/my-posts?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;

  -- NO 'accepted' branch. The client (useOfferHandlers) is the single
  -- producer for an accept: only it knows the response deadline the poster
  -- picked, and only its link ('/my-jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    -- ADDED 2026-09-23 (Q274): the backfill below closes applications on jobs
    -- that were cancelled long ago. Nobody is owed a notice for that.
    IF current_setting('app.q274_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    -- ADDED 2026-09-23 (Q274): closed because the JOB was cancelled, not
    -- because anyone turned this applicant down. "Not selected" would be false.
    IF NEW.closed_reason = 'job_cancelled' THEN
      v_message := '"' || COALESCE(job_title, 'A job') || '" was cancelled, so your application is closed';
    ELSE
      v_message := 'Your application for "' || job_title || '" was not selected';
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/dashboard' showed the job board instead.
    v_link := '/my-jobs?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 2. The rule: a job going to 'cancelled' closes its pending applications.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_pending_applications_on_job_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.applications
     SET status = 'rejected',
         closed_reason = 'job_cancelled'
   WHERE job_id = NEW.id
     AND status = 'pending';
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.close_pending_applications_on_job_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_close_pending_applications_on_job_cancel ON public.jobs;
CREATE TRIGGER trg_close_pending_applications_on_job_cancel
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.close_pending_applications_on_job_cancel();

-- ---------------------------------------------------------------------------
-- 3. Backfill: applications already pending on a cancelled job. Silent.
-- ---------------------------------------------------------------------------
DO $backfill$
BEGIN
  PERFORM set_config('app.q274_backfill', 'on', true);
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'job_cancelled'
    FROM public.jobs j
   WHERE j.id = a.job_id
     AND j.status = 'cancelled'
     AND a.status = 'pending';
  PERFORM set_config('app.q274_backfill', 'off', true);
END
$backfill$;
