-- Owner report 2026-10-21 (Notifications sheet at 375): "New application" read
--   Someone applied to "Clean a 2-bedroom house"
-- and the owner asked: "Instead of saying someone say who applied."
--
-- notify_on_application (the AFTER INSERT trigger on applications) wrote a fixed "Someone" although the
-- applicant (NEW.helper_id) is always known. The bell, the push (fan_out_push_on_notification) and the
-- email (send-notification-email) all carry this row's own message, and public.notifications has no
-- actor column, so the name is written where the row is written, as every other producer does since
-- Q2292 (20261021061341): public.member_display_name, "First L.", never the last name.
--
-- 1. notify_on_application restated verbatim from its effective definition (20261021072502; prosrc md5
--    12f70bad1f4f822f422412c3b8121c4a matched prod 2026-10-21) but for the message line and one variable.
--    Privacy: no name across a block (are_users_blocked, both ways; NULL is treated as blocked), the
--    same as the applicant list the poster sees (RLS hides a blocked applicant's row).
-- 2. Backfill, one time and idempotent: an UNREAD real "New application" row still saying
--    'Someone applied to "..."' gets the applicant's display name when exactly one application on its job
--    was written in the same transaction (applications.created_at = notifications.created_at: the trigger
--    runs inside the insert; measured on prod 2026-10-21, 101 of 151 rows match one, 49 none (the
--    application was withdrawn, so the actor is no longer known: they keep "Someone"), 1 forty-five).
--    The match must also be one-to-one the other way: exactly one "New application" row for that job at
--    that instant. Skipped: seed or test data (jobs/profiles.is_seed, public.test_accounts), a recipient
--    who is no longer the job's poster, a block either way, an applicant now banned or shadowbanned (the
--    live trigger can never name one: their apply is refused), a blank name. An applicant with no profile reads "A former member"
--    (src/lib/deletedPerson.ts FORMER_MEMBER_LABEL). Read rows are left as they are. Measured candidates
--    on prod 2026-10-21: 8 rows.
--
-- REPLAY-SAFETY: CREATE OR REPLACE keeps the trigger and the grants; every object read exists before this
-- file; the backfill matches nothing on a fresh database and nothing on a second run (a renamed row no
-- longer starts with "Someone applied to").

-- 1. The producer.
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
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
  v_applicant TEXT;
BEGIN
  SELECT title, customer_id, helper_id, offered_to_helper_id, direct_offer_status INTO job_title, job_owner, job_helper, job_offered, job_offer_status FROM public.jobs WHERE id = NEW.job_id;

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
    -- (appliedActivityBucket). '/home' showed the job board instead.
    v_link := '/jobs?job=' || NEW.job_id::text;

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
-- Unchanged from prod's proacl ({postgres=X,service_role=X}); stated so a replay matches it.
REVOKE ALL ON FUNCTION public.notify_on_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_application() TO service_role;

-- 2. Backfill (one time, idempotent).
DO $backfill$
DECLARE
  v_rows int;
BEGIN
  WITH cand AS (
    SELECT n.id, n.user_id, n.created_at,
           substring(n.link FROM '[?&]job=([0-9a-fA-F-]{36})')::uuid AS job_id
      FROM public.notifications n
     WHERE n.type = 'application'
       AND n.title = 'New application'
       AND NOT n.read
       AND n.message LIKE 'Someone applied to "%'
       AND n.link ~ '[?&]job=[0-9a-fA-F-]{36}'
       -- One-to-one both ways (lh-authz-rls note 3): the only application notice for that job at that instant.
       AND (SELECT count(*) FROM public.notifications n2
             WHERE n2.type = 'application' AND n2.title = 'New application'
               AND n2.link = n.link AND n2.created_at = n.created_at) = 1
  ), one AS (
    SELECT c.id, c.user_id, c.job_id, (array_agg(a.helper_id))[1] AS helper_id
      FROM cand c
      JOIN public.applications a ON a.job_id = c.job_id AND a.created_at = c.created_at
     GROUP BY c.id, c.user_id, c.job_id
    HAVING count(*) = 1
  ), named AS (
    SELECT o.id,
           CASE WHEN p.user_id IS NULL THEN 'A former member'
                ELSE public.member_display_name(p.full_name, NULL) END AS dn
      FROM one o
      JOIN public.jobs j ON j.id = o.job_id AND j.customer_id = o.user_id
      JOIN public.profiles rp ON rp.user_id = o.user_id
      LEFT JOIN public.profiles p ON p.user_id = o.helper_id
     WHERE NOT coalesce(j.is_seed, false)
       AND NOT coalesce(rp.is_seed, false)
       AND NOT coalesce(p.is_seed, false)
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o.user_id, o.helper_id))
       AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                        WHERE (b.blocker_id = o.user_id AND b.blocked_id = o.helper_id)
                           OR (b.blocker_id = o.helper_id AND b.blocked_id = o.user_id))
       -- Banned or shadowbanned now (lh-authz-rls note 2; is_caller_banned's and is_helper_shadowbanned's tests).
       AND coalesce(p.ban_status, '') NOT IN ('banned', 'temp_banned', 'permanently_banned')
       AND NOT EXISTS (SELECT 1 FROM public.helper_shadowbans s WHERE s.helper_id = o.helper_id AND s.expires_at > now())
  )
  UPDATE public.notifications n
     SET message = nm.dn || substr(n.message, length('Someone') + 1)
    FROM named nm
   WHERE n.id = nm.id
     AND nm.dn IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'application notice backfill: % unread notification(s) now name the applicant', v_rows;
END
$backfill$;
