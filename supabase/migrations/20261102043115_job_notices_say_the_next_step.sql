-- JOB NOTICES END WITH THE NEXT STEP AND ITS DEADLINE (audit 11-01 A3-36, A3-37, A3-38).
--
-- What was wrong (prod, 21 days, read only): the database senders of the most-sent job notices stopped at the news.
--   A3-36 notify_poster_on_status_change (to the poster): "<Helpr> has finished "<job>". Please review and confirm."
--     named no deadline, though the poster has APPROVAL_WINDOW_HOURS (24, supabase/functions/_shared/escrowTiming.ts)
--     from helper_completed_at before Helpr support steps in, and the job page counts it down. "Is on the way" and
--     "has arrived" did not say whether the poster had anything to do.
--   A3-37 notify_on_application (to the poster, 285 sent): "<Name> applied to "<job>"" with no next step and no
--     pick-by. The pick-by is the SAME instant the browse card counts to (src/lib/listingDeadline.ts): the job's start
--     or the listing's close (expires_at), whichever is first (on prod every dated open job closes AFTER it starts).
--     A start with no time is the end of that day ("before Sat, Nov 7"). Past the start with the listing still open,
--     the close; past both, no date.
--   A3-38 notify_on_payment_escrowed (to the Helpr): "Job funded ... Get to work!" although the Helpr's real next step
--     is the day-before confirm, owed until CONFIRM_DEADLINE_HOURS_BEFORE_START (2) hours before the start
--     (supabase/functions/_shared/confirmDeadline.ts; sweep_confirm_reminders_and_repost reposts at that instant).
--     Now: "Payment for "<job>" is held. Next: confirm you'll be there by Sat, Nov 7 at 7:00 AM." Already confirmed,
--     or that instant already passed: the sentence ends at "is held."
--
-- Every time is Louisiana time ('America/Chicago'), the same zone and form the other notices print.
--
-- How: each function is restated VERBATIM from prod's pg_get_functiondef (read 2026-11-01 ~10:35 PM CT; md5
-- 42adf6ec..., da000def..., ce70a3db...; notify_on_application and notify_on_payment_escrowed differ from their newest
-- CREATE in the repo because 20261030220537 rewrote their literals in place), changing only the sentences named above
-- and the lookups they need. No branch, condition, preference, link, type or grant moves.
--
-- Replay-safe: CREATE OR REPLACE of existing trigger functions; triggers untouched. Grants restated as live (postgres,
-- service_role only). Proof: src/test/pglite/jobNoticesNextStep.pglite.mjs. Guard: src/test/jobNoticesNextStep.test.ts.

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
    IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN
      v_title := 'Start time passed';
      v_msg := v_helper_name || ' hasn''t checked in for "' || NEW.title || '". Open the job to message them or report a no-show.';
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

REVOKE ALL ON FUNCTION public.notify_poster_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_poster_on_status_change() TO service_role;

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
  job_date DATE;
  job_start_time TIME;
  job_expires TIMESTAMPTZ;
  v_start TIMESTAMPTZ;
  v_pick_by TEXT;
BEGIN
  SELECT title, customer_id, helper_id, offered_to_helper_id, direct_offer_status,
         COALESCE(public.job_category_group(category), category::text),
         date_needed, start_time, expires_at
    INTO job_title, job_owner, job_helper, job_offered, job_offer_status, job_cat,
         job_date, job_start_time, job_expires
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
    -- A3-37: the pick-by is the start or the listing's close, whichever is first (src/lib/listingDeadline.ts).
    -- A start with no time is the end of its day. A passed start falls back to a still-open close; past both, no date.
    IF job_date IS NOT NULL THEN
      v_start := CASE WHEN job_start_time IS NOT NULL
                      THEN (job_date + job_start_time) AT TIME ZONE 'America/Chicago'
                      ELSE ((job_date + 1)::timestamp AT TIME ZONE 'America/Chicago') - interval '1 second' END;
    END IF;
    IF v_start IS NOT NULL AND v_start > now() AND (job_expires IS NULL OR v_start < job_expires) THEN
      v_pick_by := CASE WHEN job_start_time IS NOT NULL
                        THEN ' before it starts ' || to_char(v_start AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD "at" FMHH12:MI AM')
                        ELSE ' before ' || to_char(job_date, 'Dy, Mon FMDD') END;
    ELSIF job_expires IS NOT NULL AND job_expires > now() THEN
      v_pick_by := ' by ' || to_char(job_expires AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD "at" FMHH12:MI AM');
    END IF;
    v_message := COALESCE(v_applicant, 'Someone') || ' applied to "' || job_title || '". Next: review and pick a Helpr'
      || COALESCE(v_pick_by, '') || '.';
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
        || '". They picked someone else this time. Tap to see similar open jobs.';
      v_link := '/jobs?tab=browse' || CASE WHEN job_cat IS NOT NULL THEN '&cat=' || job_cat ELSE '' END;
    ELSE
      v_title := 'Not picked this time';
      v_message := 'They went with someone else for "' || COALESCE(job_title, 'this job') || '"';
      v_link := '/jobs?tab=browse' || CASE WHEN job_cat IS NOT NULL THEN '&cat=' || job_cat ELSE '' END;
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
      v_message := v_message || '. Tap to see similar open jobs.';
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

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_member uuid;
  v_confirm_by timestamptz;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    v_title := 'Payment secured';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held and will be released after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        -- A3-38: the Helpr's next step is the day-before confirm, owed until CONFIRM_DEADLINE_HOURS_BEFORE_START
        -- before the start (confirmDeadlineMs; a start with no time is midnight, as the sweep reads it). Not
        -- "Get to work!": the work may be days away. Already confirmed, or that instant passed: no next step.
        IF NEW.date_needed IS NOT NULL THEN
          v_confirm_by := ((NEW.date_needed + COALESCE(NEW.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
                          - interval '2 hours';
        END IF;
        v_msg := 'Payment for "' || NEW.title || '" is held.'
          || CASE WHEN NEW.helper_confirmed_at IS NULL AND v_confirm_by > now()
                  THEN ' Next: confirm you''ll be there by '
                       || to_char(v_confirm_by AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD "at" FMHH12:MI AM') || '.'
                  ELSE '' END;
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', v_msg, 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  -- A crew (Q407): the payout fan-out releases the job once EVERY member is
  -- paid, so every member hears it, each on their own preference.
  IF NEW.is_group_job IS TRUE
     AND NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released'
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    FOR v_member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL
    LOOP
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = v_member;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_member, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
        PERFORM public.log_notification(v_member, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;
