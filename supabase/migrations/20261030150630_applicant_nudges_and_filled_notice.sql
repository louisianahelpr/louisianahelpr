-- Applications: nudge a poster whose applicants sit unanswered for 24 hours, and
-- tell the other applicants kindly when a job fills, with similar jobs (owner
-- 2026-10-29, audit page UX-3; Q2484).
--
-- 1. THE FILLED NOTICE. When a Helpr's accept completes, complete_job_accept
--    (newest body 20261021061341, live md5 read 2026-10-30) closes every other
--    pending application with closed_reason NULL and no decline_reason. The
--    rejection branch of notify_on_application then sent the same words as a
--    poster's decline: 'Your application for "<job>" was not selected', linked
--    to the closed card. Measured on prod 2026-10-30 (read-only): all 5
--    applications closed this way carry closed_reason NULL and no note.
--    Now, when the job HAS a Helpr and it is not this applicant (the job was
--    filled by someone else), the notice reads:
--      title   'This job was filled'
--      message 'Thanks for applying to "<job>". The poster picked someone else
--               this time. Tap to see similar open jobs.'
--      link    '/jobs?tab=browse&cat=<group>' : the Browse feed filtered to the
--              job's category group (public.job_category_group, the same
--              group ids the Browse chips and ?cat= use, src/lib/jobCategoryGroups.ts).
--    A poster's decline while the job is still unfilled, a note from the
--    poster, a cancel, a block and an expired offer are unchanged. The body is
--    otherwise the live definition (pg_get_functiondef 2026-10-30, equal to
--    20261025182522), restated whole.
--
-- 2. THE 24-HOUR NUDGE. sweep_unanswered_applications() (cron
--    'unanswered-applications-nudge', hourly at :53) tells a poster ONCE per job:
--      title   'Your applicants are waiting'
--      message '<N> people applied to "<job>" and are waiting to hear back.
--               Hire someone, or decline the rest so they can move on.'
--      link    '/posts?job=<id>' (the applicant list), job_id set.
--    Due when the job is open with no Helpr, no direct offer is pending, it has
--    not expired, it is not a seed job and its poster is not a test member
--    (public.is_test_member: test stuff never sends notices), and its oldest pending application is 24 to 72 hours old (the
--    72-hour edge keeps the first run from nudging long-stale posts: measured
--    2026-10-30, 5 open jobs have a pending application older than 24 h, 1 of
--    them inside the window). Only between 8 AM and 8 PM Louisiana time, so a
--    nudge never arrives at night; a job that comes due overnight is nudged at
--    8 AM. Once per job: public.application_nudge_sends (job_id primary key),
--    claimed before anything is sent. The email goes through
--    send-notification-email with type 'application', so the poster's
--    email_job_applications switch, suppression and the test-recipient gate
--    apply there, as for the applicant roundup (20261025182522).
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name.
-- Proof: src/test/pglite/applicantNudgesAndFilledNotice.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.application_nudge_sends (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- The poster told; deleted with the account, like the other reminder logs.
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.application_nudge_sends IS
  'UX-3 (Q2484): one row per job whose poster was told "Your applicants are waiting", so the 24-hour nudge is sent at most once per job. Written only by sweep_unanswered_applications().';
-- The account-deletion cascade looks rows up by user_id.
CREATE INDEX IF NOT EXISTS application_nudge_sends_user_id_idx ON public.application_nudge_sends (user_id);
ALTER TABLE public.application_nudge_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_nudge_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_nudge_sends TO service_role;

-- p_now: the clock the windows read (NULL = now()). Cron never passes it; the
-- PGlite proof does, to test each edge.
CREATE OR REPLACE FUNCTION public.sweep_unanswered_applications(p_now timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_hour integer := extract(hour FROM (COALESCE(p_now, now()) AT TIME ZONE 'America/Chicago'))::integer;
  rec record;
  v_message text;
  v_sent integer := 0;
BEGIN
  -- Daytime only (8:00 to 19:59 Louisiana time).
  IF v_hour < 8 OR v_hour >= 20 THEN
    RETURN 0;
  END IF;

  FOR rec IN
    WITH due AS (
      SELECT j.id AS job_id, j.customer_id AS user_id, j.title,
             count(a.id)::integer AS waiting
        FROM public.jobs j
        JOIN public.applications a ON a.job_id = j.id AND a.status = 'pending'
       WHERE j.status = 'open'
         AND j.helper_id IS NULL
         AND j.customer_id IS NOT NULL
         AND NOT (j.offered_to_helper_id IS NOT NULL AND j.direct_offer_status = 'pending')
         AND (j.expires_at IS NULL OR j.expires_at > v_now)
         -- Test stuff never sends notices (owner rule): no seed job, no test poster (public.is_test_member).
         AND NOT COALESCE(j.is_seed, false)
         AND NOT public.is_test_member(j.customer_id)
         AND NOT EXISTS (SELECT 1 FROM public.application_nudge_sends s WHERE s.job_id = j.id)
       GROUP BY j.id, j.customer_id, j.title
      HAVING min(a.created_at) <= v_now - interval '24 hours'
         AND min(a.created_at) > v_now - interval '72 hours'
       LIMIT 200
    ),
    claimed AS (
      INSERT INTO public.application_nudge_sends (job_id, user_id, sent_at)
      SELECT due.job_id, due.user_id, v_now FROM due
      ON CONFLICT (job_id) DO NOTHING
      RETURNING job_id
    )
    SELECT due.* FROM due JOIN claimed USING (job_id)
  LOOP
    v_message := CASE WHEN rec.waiting = 1
        THEN '1 person applied to "' || COALESCE(rec.title, 'your job') || '" and is waiting to hear back.'
        ELSE rec.waiting || ' people applied to "' || COALESCE(rec.title, 'your job') || '" and are waiting to hear back.'
      END || ' Hire someone, or decline the rest so they can move on.';

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (rec.user_id, 'Your applicants are waiting', v_message, 'application',
            '/posts?job=' || rec.job_id::text, rec.job_id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', rec.user_id,
        'title', 'Your applicants are waiting',
        'message', v_message,
        'type', 'application',
        'link', '/posts?job=' || rec.job_id::text
      )
    );
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_unanswered_applications(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unanswered_applications(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_on_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  job_helper UUID;
  job_offered UUID;
  job_offer_status TEXT;
  job_cat TEXT;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
  v_applicant TEXT;
BEGIN
  SELECT title, customer_id, helper_id, offered_to_helper_id, direct_offer_status,
         COALESCE(public.job_category_group(category), category::text)
    INTO job_title, job_owner, job_helper, job_offered, job_offer_status, job_cat
    FROM public.jobs WHERE id = NEW.job_id;

  -- Q1185: only a real application (born 'pending') is news to the poster. A
  -- row born 'accepted' is the record of an accept (respond_to_direct_offer's
  -- completion, claim_series_dates), whose own notice tells the poster; this
  -- one said "Someone applied" first, and at a direct offer's pending tap it
  -- reached the poster before the Helpr's setup was done.
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    -- Owner 2026-10-21: say WHO applied, as "First L." (the member-name rule, member_display_name).
    -- Never across a block (RLS already refuses that apply, and the poster's applicant list hides a
    -- blocked applicant): NULL there, and from a context are_users_blocked will not answer for, reads
    -- "Someone". A blank name reads "Someone"; no profile row (an account mid-deletion) reads "A former member".
    IF NOT COALESCE(public.are_users_blocked(NEW.helper_id, job_owner), true) THEN
      SELECT public.member_display_name(p.full_name, 'Someone') INTO v_applicant
        FROM public.profiles p WHERE p.user_id = NEW.helper_id;
      IF NOT FOUND THEN
        v_applicant := 'A former member';
      END IF;
    END IF;
    v_message := COALESCE(v_applicant, 'Someone') || ' applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/posts?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    -- Owner 2026-10-25 (the admin account got 50 of these in one day): the
    -- FIRST applicant emails at once; later ones within 3 hours wait for one
    -- roundup ("You have N new applicants", send_application_roundups, cron
    -- application-roundups). In-app notices are unchanged: one per applicant.
    IF COALESCE(v_email_enabled, true) AND NOT public.application_email_should_wait(v_user_id) THEN
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
  -- picked, and only its link ('/jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    -- ADDED 2026-09-23 (Q274): the backfill below closes applications on jobs
    -- that were cancelled long ago. Nobody is owed a notice for that.
    IF current_setting('app.q274_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- ADDED 2026-09-24 (Q345): closed because one of the two blocked the
    -- other. A notice would be contact the blocker asked not to have, and
    -- "not selected" would be false when the applicant is the one who blocked.
    IF NEW.closed_reason = 'party_blocked' THEN
      RETURN NEW;
    END IF;
    -- Owner, 2026-10-21: an applicant who was NOT hired or offered is not told the job was cancelled
    -- (no bell, push or email); their application reads "This job is no longer available" in the app.
    -- The offered Helpr (jobs.helper_id) is still told: they may be planning to show up.
    -- A pending direct offer counts as offered (lh-authz-rls review note 1): jobs.helper_id is NULL until
    -- they accept, and poster_cancel_job tells only helper_id, so they would otherwise hear nothing.
    IF NEW.closed_reason = 'job_cancelled' AND NEW.helper_id IS DISTINCT FROM job_helper
       AND NOT COALESCE(NEW.helper_id = job_offered AND job_offer_status = 'pending', false) THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/home' showed the job board instead.
    v_link := '/jobs?job=' || NEW.job_id::text;
    -- ADDED 2026-09-23 (Q274): closed because the JOB was cancelled, not
    -- because anyone turned this applicant down. "Not selected" would be false.
    IF NEW.closed_reason = 'job_cancelled' THEN
      v_message := '"' || COALESCE(job_title, 'A job') || '" was cancelled, so your application is closed';
    ELSIF NEW.closed_reason IS NULL AND job_helper IS NOT NULL AND NEW.helper_id IS DISTINCT FROM job_helper
          AND (NEW.decline_reason IS NULL OR btrim(NEW.decline_reason) = '') THEN
      -- UX-3 (owner 2026-10-29): the job went to another Helpr (complete_job_accept closes the
      -- other pending applications). Said kindly, and the link opens similar open jobs.
      v_title := 'This job was filled';
      v_message := 'Thanks for applying to "' || COALESCE(job_title, 'this job')
        || '". The poster picked someone else this time. Tap to see similar open jobs.';
      v_link := '/jobs?tab=browse' || CASE WHEN job_cat IS NOT NULL THEN '&cat=' || job_cat ELSE '' END;
    ELSE
      v_message := 'Your application for "' || job_title || '" was not selected';
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
    END IF;
    v_type := 'info';

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
REVOKE ALL ON FUNCTION public.notify_on_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_application() TO service_role;

-- The cron: hourly at :53 (the sweep itself sends only from 8 AM to 8 PM Louisiana time).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('unanswered-applications-nudge', interval '3 hours',
            'UX-3 (Q2484): hourly at :53, tells a poster once per job "Your applicants are waiting" when the oldest pending application is 24 to 72 hours old (8 AM to 8 PM Louisiana time).',
            'exempt', 'Most runs find no job whose applicants have waited a day: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('unanswered-applications-nudge', '53 * * * *',
      $c$SELECT public.cron_record_work('unanswered-applications-nudge', to_jsonb(public.sweep_unanswered_applications()));$c$);
  END IF;
END
$do$;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
