-- Q139: every SQL notification producer carries its SUBJECT, so the Q137 seed
-- boundary can judge it.
--
-- WHAT WAS OPEN. trg_notifications_seed_boundary (20260923121354) drops a row
-- whose subject is seed (a job with is_seed, or a seed account named in the
-- link as userId= / offerTo= / user=) when its recipient is a real account.
-- It can only judge what a row CARRIES: its job_id, or a link naming a job or
-- an actor. The 16 functions below inserted rows ABOUT a job or a member with
-- neither: 22 insert sites listed in KNOWN_GAP in
-- src/test/seedNeverNotifiesReal.test.ts, plus 2 the guard had counted as
-- carrying only because ANOTHER insert in the same body had a job link
-- (notify_on_payment_escrowed 'Payout released', open_dispute_as 'Job
-- disputed'; the guard now judges each INSERT statement). So a seed job
-- completing, being tipped, offered, expired, abandoned, disputed or paid out
-- could still notify a real party, and a seed member's admin alert could still
-- reach a real admin.
--
-- THE CHANGE. Each function is restated from its EFFECTIVE definition (what the migrations leave
-- in the database, derived by replaying them; not re-read from prod here) with one
-- addition per insert: the job_id column set to the job the row is about, or,
-- for the two member alerts to admins, the member named in the link as
-- '&user=<id>'. Nothing else changes: same recipients, same copy, same links
-- (the two admin links gain a parameter no admin view reads), same types.
--
-- EFFECTIVE, NOT NEWEST TEXT. Eight of these functions had their notification links
-- rewritten IN PLACE by 20260831232514 and 20260901021929 (pg_get_functiondef
-- + regexp_replace + EXECUTE): the bare '/posts' / '/jobs' and the fixed
-- '?filter=' links became '/my-…?job=' || <id>. Their newest CREATE FUNCTION
-- text still shows the old links, so a restatement copied from that text
-- reverts 14 direct links (the first cut of this change did, and a review
-- against prod caught it). Each body here is its newest text with those same
-- rewrites applied, named above each function. Guard:
-- src/test/notificationRestatementsKeepLinks.test.ts (every restated body is
-- the effective prior body plus only the added job_id / &user=; every link in
-- a restatement since Q194 matches the one it replaces).
--
-- FK SAFETY. notifications.job_id REFERENCES jobs(id) ON DELETE SET NULL. Every
-- job_id set here is a row that exists in the same transaction: AFTER
-- triggers on jobs / tips / applications, a BEFORE UPDATE trigger on jobs
-- (the row already exists), or a job the function has just read FOR UPDATE.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, with the signatures the effective
-- definitions already have, so grants and triggers are untouched; no later
-- migration defines these functions.

-- check_referral_bonus: effective definition is 20260902014651_account_deletion_purges_the_no_fk_tables.sql; restated verbatim except: each of the 4 notifications carries job_id = NEW.id (the completed job).
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $body$
    DECLARE
      v_referral RECORD;
    BEGIN
      IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
        RETURN NEW;
      END IF;

      IF NEW.helper_id IS NOT NULL THEN
        SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
        INTO v_referral
        FROM public.referrals r
        WHERE r.referred_id = NEW.helper_id
          AND NOT EXISTS (
            SELECT 1 FROM public.referral_credits rc
            WHERE rc.user_id = NEW.helper_id
              AND rc.reason = 'first_job_bonus'
              AND rc.referral_code_id = r.referral_code_id
          );

        IF FOUND THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (NEW.helper_id, 'Referral bonus earned!',
                  'You completed your first job as a helper and earned a $5 referral credit!', 'payment', '/profile', NEW.id);

          -- The referrer's half, skipped when the referrer has deleted their
          -- account. NOT NULL on referral_credits.user_id and notifications
          -- .user_id would otherwise 23502 and roll back the referee's job.
          IF v_referral.referrer_id IS NOT NULL THEN
            INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
            VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
            ON CONFLICT DO NOTHING;

            INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
            VALUES (v_referral.referrer_id, 'Referral bonus!',
                    'Your referral completed their first job as a helper. You earned a $5 credit!', 'payment', '/profile', NEW.id);
          END IF;
        END IF;
      END IF;

      SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
      INTO v_referral
      FROM public.referrals r
      WHERE r.referred_id = NEW.customer_id
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_credits rc
          WHERE rc.user_id = NEW.customer_id
            AND rc.reason = 'first_job_bonus'
            AND rc.referral_code_id = r.referral_code_id
        );

      IF FOUND THEN
        INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
        VALUES (NEW.customer_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
        ON CONFLICT DO NOTHING;

        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (NEW.customer_id, 'Referral bonus earned!',
                'Your first posted job was completed — you earned a $5 referral credit!', 'payment', '/profile', NEW.id);

        IF v_referral.referrer_id IS NOT NULL THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.customer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (v_referral.referrer_id, 'Referral bonus!',
                  'Your referral''''s first posted job was completed. You earned a $5 credit!', 'payment', '/profile', NEW.id);
        END IF;
      END IF;

      RETURN NEW;
    END;
    $body$;

-- track_revision_scope_creep: effective definition is 20260418082051_cdd00eb4-9fb7-42d0-a20d-1b99db2620bd.sql with the link rewrites of 20260831232514 (#42 #43) applied; restated verbatim except: both notifications carry job_id = NEW.id.
CREATE OR REPLACE FUNCTION public.track_revision_scope_creep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Detect a NEW revision request (transition into revision_requested)
  IF NEW.status = 'revision_requested'
     AND (OLD.status IS DISTINCT FROM 'revision_requested') THEN
    NEW.revision_count := COALESCE(OLD.revision_count, 0) + 1;

    -- Flag scope creep at 3+ revisions
    IF NEW.revision_count >= 3 THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
      VALUES (
        NEW.customer_id,
        'scope_creep',
        'Job "' || NEW.title || '" has been revised ' || NEW.revision_count || ' times. Possible scope creep or dispute brewing.',
        NEW.id
      );

      -- Notify both parties + admins via in-app notification
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        NEW.customer_id,
        '⚠️ Scope creep detected',
        'You''ve requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Repeated revisions may signal unclear scope — consider a dispute or accepting the work.',
        'warning',
        '/posts?job=' || NEW.id::text,
        NEW.id
      );

      IF NEW.helper_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.helper_id,
          '⚠️ Multiple revisions on this job',
          'The poster has requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Admins have been notified.',
          'warning',
          '/jobs?job=' || NEW.id::text,
          NEW.id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- notify_poster_on_status_change: effective definition is 20260829061546_helper_mark_on_the_way_atomic.sql with the link rewrites of 20260901021929 (#20 #21) applied; restated verbatim except: the notification carries job_id = NEW.id.
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
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/posts?job=' || NEW.id::text;
  SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';
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

-- notify_helper_on_tip: effective definition is 20260923152630_notification_links_point_direct_not_at_redirects.sql; restated verbatim except: the notification carries job_id = NEW.job_id (the tipped job).
CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_job_title text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    v_title := 'You got a $' || NEW.amount || ' tip!';
    v_msg := 'A poster left you a $' || NEW.amount || ' tip for "' || COALESCE(v_job_title, 'your work') || '". Thanks for going above and beyond.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/profile?tab=earnings', NEW.job_id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- notify_helper_on_direct_offer: effective definition is 20260831203052_dedupe_application_notifications_and_fix_offer_links.sql with the link rewrites of 20260901021929 (#30) applied; restated verbatim except: the notification carries job_id = NEW.id (AFTER INSERT/UPDATE trigger, so the job row exists for the FK).
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id)
  THEN
    SELECT COALESCE(full_name, 'A poster') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      -- was '/activity?tab=offers' — a redirect to the POSTER surface that
      -- also discarded the query string.
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- notify_helper_application_viewed: effective definition is 20260612540000_notify_on_application_viewed.sql; restated verbatim except: the notification carries job_id = NEW.job_id (the application's job).
CREATE OR REPLACE FUNCTION public.notify_helper_application_viewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title text;
BEGIN
  -- Only fire on the first view (NULL → non-NULL transition)
  IF NEW.poster_viewed_at IS NULL OR OLD.poster_viewed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only notify pending applications (not already decided)
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;

  INSERT INTO public.notifications (
    user_id, title, message, type, link, job_id
  ) VALUES (
    NEW.helper_id,
    'Your application was seen',
    'The poster viewed your application for "' || COALESCE(v_job_title, 'a job') || '".',
    'info',
    '/jobs?highlight=' || NEW.id,
    NEW.job_id
  );

  RETURN NEW;
END;
$$;

-- respond_to_direct_offer: effective definition is 20260820000000_respond_to_direct_offer.sql with the link rewrites of 20260831232514 (#33) applied; restated verbatim except: the decline notification carries job_id = the offered job.
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(
  p_job_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_app_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- The real applications row the synthetic 'direct-<id>' stood in for.
    -- ON CONFLICT covers the helper who somehow also applied to the same job
    -- before the offer landed: promote their existing row instead of
    -- colliding with the (job_id, helper_id) unique index.
    INSERT INTO public.applications (job_id, helper_id, message, status)
    VALUES (p_job_id, auth.uid(), NULL, 'accepted')
    ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
    RETURNING id INTO v_app_id;

    UPDATE public.jobs
       SET status = 'accepted',
           helper_id = auth.uid(),
           direct_offer_status = 'accepted',
           -- The helper accepting IS the confirmation. There is no second
           -- "confirm you'll be there" step on this path — the poster already
           -- chose them, so requiring another tap would strand the job in
           -- accepted-but-unconfirmed forever.
           helper_confirmed_at = v_now,
           response_deadline = NULL,
           direct_offer_expires_at = NULL
     WHERE id = p_job_id;

    RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         'Your direct offer for "' || title || '" was declined. The job is open to all helpers again.',
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$$;

-- expire_unanswered_offers: effective definition is 20260824243000_reliability_ladder_temp_ban_and_cancel_booking.sql with the link rewrites of 20260831232514 (#34 #35) applied; restated verbatim except: both notifications carry job_id = v_locked.id.
CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    SELECT j.id, j.title, j.customer_id, j.helper_id
      INTO v_locked
      FROM public.jobs j
     WHERE j.id = v_job.id
       AND j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
     FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT a.id INTO v_app_id
      FROM public.applications a
     WHERE a.job_id = v_locked.id
       AND a.helper_id = v_locked.helper_id
       AND a.status = 'accepted'
     LIMIT 1;

    -- ONE ladder for the whole reliability family — see
    -- apply_job_denial_consequence (20260824243000). The literal copy this
    -- replaced is exactly the drift hazard its own comment warned about.
    PERFORM public.apply_job_denial_consequence(
      v_locked.helper_id, v_locked.id,
      'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');

    IF v_app_id IS NOT NULL THEN
      UPDATE public.applications SET status = 'rejected' WHERE id = v_app_id;
    END IF;

    UPDATE public.jobs
       SET status = 'open',
           helper_id = NULL,
           response_deadline = NULL
     WHERE id = v_locked.id;

    -- Both sides are told, because both sides were waiting on this.
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.customer_id,
      'Offer expired — job reopened',
      'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_locked.id::text,
      v_locked.id
    );

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.helper_id,
      'You lost a job offer',
      'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
        || '" and it went back to everyone. Letting an offer expire counts the same as declining it.',
      'expired',
      '/jobs?job=' || v_locked.id::text,
      v_locked.id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- sweep_dayof_confirm_reminders: effective definition is 20260831193039_cron_sql_error_reporting.sql with the link rewrites of 20260901021929 (#10 #11) applied; restated verbatim except: all 3 notifications carry job_id = rec.id.
CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.helper_dayof_confirmed_at, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 1, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: T-12h and the helper still hasn't answered — alert the poster.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND j.helper_dayof_confirmed_at IS NULL
      AND (j.helper_confirmed_at IS NULL
           OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - j.helper_confirmed_at > INTERVAL '24 hours')
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 2, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_dayof_confirm_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;

-- apply_job_denial_consequence: effective definition is 20260923152630_notification_links_point_direct_not_at_redirects.sql; restated verbatim except: the Elite-shield notification carries job_id = p_job (the job the strike is about).
CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Shielded strikes don't count toward escalation.
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper
     AND violation_type = 'job_denial'
     AND COALESCE(action_taken, '') <> 'forgiven_elite_shield';

  -- Active Elite + no shield used in the rolling window?
  SELECT (p.subscription_tier = 'elite'
          AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
    INTO v_is_elite
    FROM public.profiles p WHERE p.user_id = p_helper;

  IF COALESCE(v_is_elite, false) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.user_violations
       WHERE user_id = p_helper
         AND action_taken = 'forgiven_elite_shield'
         AND created_at > now() - interval '180 days'
    ) INTO v_shield_available;
  END IF;

  IF v_shield_available THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_helper, 'job_denial', p_description, p_job, 'forgiven_elite_shield');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (p_helper, 'Your Elite shield absorbed this one',
            'As an Elite member, your first reliability strike every 6 months is forgiven. This one''s on the house — the next one counts.',
            'info', '/profile?tab=warnings', p_job);
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => p_helper,
    p_violation_type            => 'job_denial',
    p_description               => p_description,
    p_job_id                    => p_job,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['none', 'warning', 'temp_ban', 'pending_ban_review'],
    p_effects                   => ARRAY['record', 'final_warning', 'suspend', 'permanent'],
    p_copy                      => jsonb_build_array(
      -- Rung 1 is recorded SILENTLY: no notification. Cast is required —
      -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
      null::jsonb,
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second reliability strike. One more — declining, ignoring, or cancelling a job you committed to — and your account is suspended for 7 days.'),
      jsonb_build_object(
        'title', 'Account suspended for 7 days',
        'message', 'Third reliability strike — your account is suspended for 7 days. A fourth strike restricts your account again while an admin decides whether to ban it permanently.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Fourth reliability strike — your account is restricted for 7 days and an admin is reviewing it for a permanent ban. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => false,
    p_admin_message_format      => '%s has %s reliability strikes on file (declined, ignored, or abandoned committed jobs) and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept so the direct-ban
    -- path stays fully specified if that policy is ever revisited.
    p_ban_reason                => 'Fourth reliability strike (declined, ignored, or cancelled committed jobs)'
  );
END;
$function$;

-- sweep_release_last_chance: effective definition is 20260831193039_cron_sql_error_reporting.sql with the link rewrites of 20260831232514 (#44) applied; restated verbatim except: the notification carries job_id = rec.id.
CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (
        rec.customer_id,
        'warning',
        'Last chance to review',
        format('"%s" auto-releases payment in about 2 hours. Approve it, or request a revision now if something''s wrong.', rec.title),
        '/posts?job=' || rec.id::text,
        false,
        rec.id
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;

-- helper_abort_job: effective definition is 20260825191500_helper_abort_in_progress_job.sql with the link rewrites of 20260831232514 (#37) applied; restated verbatim except: both notifications carry job_id = v_job.id.
CREATE OR REPLACE FUNCTION public.helper_abort_job(
  p_job_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_uid uuid := auth.uid();
  v_reason text;
  v_work_started boolean;
  v_dispute_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required'
      USING HINT = 'Tell the poster why you can''t finish.';
  END IF;
  -- Keep it a sentence, not an essay dumped into a notification body.
  v_reason := left(v_reason, 1000);

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.helper_arrived_at, j.helper_completed_at,
         j.proof_before_urls, j.proof_after_urls
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Server owns the decision: only the ASSIGNED helper, only from a state
  -- this exit is actually for. A poster (or any third party) hitting this
  -- gets not_authorized, not a partial write.
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_abortable'
      USING HINT = 'Only a job that is underway can be abandoned this way.';
  END IF;

  v_work_started :=
        v_job.helper_arrived_at IS NOT NULL
     OR v_job.helper_completed_at IS NOT NULL
     OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
     OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0;

  -- The strike lands first and identically in both branches — the ladder does
  -- not care which settlement path the money takes.
  v_result := public.apply_job_denial_consequence(
    v_uid, v_job.id,
    'Abandoned a job in progress: "' || COALESCE(v_job.title, 'Unknown')
      || '" — ' || v_reason);

  IF v_work_started THEN
    -- ── Branch B: partial work exists → a human decides who gets what. ──
    v_dispute_id := public.rpc_open_dispute(
      v_job.id,
      'Helpr could not finish the job: ' || v_reason,
      '{}'::text[]);

    -- Admin-only from here (see header): never auto-release to the abandoner.
    UPDATE public.jobs
       SET dispute_status = 'escalated'
     WHERE id = v_job.id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'Your Helpr couldn''t finish',
      'Your Helpr had to stop work on "' || COALESCE(v_job.title, 'your job')
        || '": ' || v_reason
        || ' Because work had already started, we''re reviewing it — your payment stays in escrow until a decision is made, and you don''t need to do anything.',
      'warning',
      '/posts?job=' || v_job.id::text,
      v_job.id
    );

    RETURN v_result || jsonb_build_object(
      'outcome', 'disputed',
      'dispute_id', v_dispute_id);
  END IF;

  -- ── Branch A: nothing was done → reopen, no money moves. ──
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = v_uid AND status = 'accepted';

  -- Same clean slate helper_cancel_booking leaves, so the day-of machinery
  -- runs fresh for the next helper rather than inheriting this one's stamps.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         helper_on_the_way_at = NULL,
         helper_arrived_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL,
         revision_requested_at = NULL,
         revision_note = NULL,
         revision_deadline = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_job.customer_id,
    'Your Helpr couldn''t finish',
    'Your Helpr had to drop "' || COALESCE(v_job.title, 'your job')
      || '": ' || v_reason
      || ' They never started, so nothing was charged — the job is open to everyone again and your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/posts?job=' || v_job.id::text,
    v_job.id
  );

  RETURN v_result || jsonb_build_object('outcome', 'reopened');
END;
$function$;

-- apply_low_rating_flag: effective definition is 20260826020000_low_rating_flag_server_side.sql; restated verbatim except: the admin alert's link names the flagged member ('&user=<id>', the actor the seed boundary reads; nothing on view=fraud reads it).
CREATE OR REPLACE FUNCTION public.apply_low_rating_flag(
  p_reviewee_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_low_count int;
  v_recent uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_reviewee_id IS NULL OR p_reviewee_id = v_caller THEN
    -- No self-flagging, and nothing to do without a subject.
    RETURN jsonb_build_object('action', 'none');
  END IF;

  -- Standing to report at all: the caller must actually have reviewed this
  -- person. Without this a client could poll the function against arbitrary
  -- user ids to discover who is one bad review away from the fraud queue.
  IF NOT EXISTS (
    SELECT 1 FROM public.reviews
     WHERE reviewer_id = v_caller AND reviewee_id = p_reviewee_id
  ) THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  -- The count the DECISION rests on is recomputed here, from the source of
  -- truth, not accepted from the caller.
  SELECT count(*) INTO v_low_count
    FROM public.reviews
   WHERE reviewee_id = p_reviewee_id AND rating <= 2;

  IF v_low_count < 3 THEN
    RETURN jsonb_build_object('action', 'none', 'low_count', v_low_count);
  END IF;

  -- Dedupe: one open flag per user per 30 days. The old client code had no
  -- dedupe at all — once a user crossed 3 low ratings, EVERY subsequent review
  -- of them (any rating, from anyone) re-inserted the same violation and
  -- re-notified every admin.
  SELECT id INTO v_recent
    FROM public.user_violations
   WHERE user_id = p_reviewee_id
     AND violation_type = 'low_ratings'
     AND created_at > now() - interval '30 days'
   LIMIT 1;

  IF v_recent IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_recent);
  END IF;

  INSERT INTO public.user_violations (user_id, violation_type, description, reported_by, action_taken)
  VALUES (
    p_reviewee_id,
    'low_ratings',
    format('User has %s ratings of 2 stars or below. Auto-flagged for admin review.', v_low_count),
    NULL,               -- system-detected, not a person's report
    'warning'
  );

  -- Same admin-fanout shape as apply_message_violation_consequence.
  INSERT INTO public.notifications (user_id, type, title, message, link, read)
  SELECT ur.user_id,
         'system_alert',
         'Low rating alert',
         format('%s has received %s low ratings and has been auto-flagged.',
                COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), v_low_count),
         '/admin?view=fraud&user=' || p_reviewee_id,
         false
    FROM public.user_roles ur
    CROSS JOIN LATERAL (
      SELECT full_name, email FROM public.profiles WHERE user_id = p_reviewee_id
    ) p
   WHERE ur.role = 'admin';

  RETURN jsonb_build_object('action', 'flagged', 'low_count', v_low_count);
END;
$$;

-- apply_consequence_ladder: effective definition is 20260923152630_notification_links_point_direct_not_at_redirects.sql; restated verbatim except: the admin 'Ban review needed' alert's link names the member ('&user=<id>', the actor the seed boundary reads; nothing on view=banreview reads it). The member's own warning row (the first insert) is unchanged.
CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(
  p_user uuid,
  p_violation_type text,
  p_description text,
  p_job_id uuid,
  p_prior_count int,
  -- Parallel arrays, indexed by prior-strike count (element 1 = 0 priors). The
  -- last element repeats for every count beyond it.
  p_rungs text[],      -- the action string RETURNED and stored in action_taken
  p_effects text[],    -- 'record' | 'notify' | 'final_warning' | 'suspend' | 'permanent'
  p_copy jsonb,        -- array parallel to p_rungs: {"title":..,"message":..} or null
  p_permanent_requires_review boolean,
  p_suspension_days int,
  p_clamp_to_worse_status boolean,
  p_admin_message_format text,   -- two %s: user label, strike number
  p_ban_reason text              -- reason recorded on an auto permanent ban
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_idx int;
  v_action text;
  v_effect text;
  v_status text;
  v_copy jsonb;
  v_title text;
  v_message text;
  v_interval interval := (p_suspension_days || ' days')::interval;
BEGIN
  -- Rung selection: prior count is 0-based, arrays are 1-based, and the top
  -- rung is open-ended (a 6th strike gets the same treatment as the 4th).
  v_idx := LEAST(GREATEST(COALESCE(p_prior_count, 0), 0), array_length(p_rungs, 1) - 1);
  v_action := p_rungs[v_idx + 1];
  v_effect := p_effects[v_idx + 1];

  -- The single policy switch. A ladder whose top rung is a permanent ban but
  -- which requires human review serves a REVERSIBLE restriction instead and
  -- puts the case in front of an admin.
  IF v_effect = 'permanent' AND p_permanent_requires_review THEN
    v_effect := 'review';
  END IF;

  v_copy := p_copy -> v_idx;
  v_title := v_copy ->> 'title';
  v_message := v_copy ->> 'message';

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (p_user, p_violation_type, p_description, p_job_id, v_action);

  SELECT ban_status INTO v_status FROM public.profiles WHERE user_id = p_user;

  -- Trusted ladder: this function is the SERVER deciding a consequence, so its
  -- writes to profiles must survive prevent_self_escalation(). The GUC is
  -- transaction-local (is_local = true) and dies with this transaction.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_effect IN ('record', 'notify') THEN
    -- No status change on these rungs. 'record' additionally has no copy, so
    -- nothing is sent; 'notify' sends its warning below.
    NULL;

  ELSIF v_effect = 'final_warning' THEN
    IF p_clamp_to_worse_status THEN
      -- Never downgrade a harsher standing status into 'final_warning'.
      UPDATE public.profiles
         SET ban_status = 'final_warning'
       WHERE user_id = p_user
         AND COALESCE(ban_status, 'active') NOT IN ('temp_banned', 'permanently_banned');
    ELSE
      UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = p_user;
    END IF;

  ELSIF v_effect IN ('suspend', 'review') THEN
    -- 'review' is ALWAYS guarded: a reversible restriction pending a human
    -- decision must never overwrite a standing permanent ban, and must never
    -- shorten a suspension the user is already serving.
    IF p_clamp_to_worse_status OR v_effect = 'review' THEN
      -- A user already permanently banned is left alone (and told nothing new),
      -- and an existing longer suspension is never shortened.
      IF COALESCE(v_status, 'active') <> 'permanently_banned' THEN
        UPDATE public.profiles
           SET ban_status = 'temp_banned',
               auto_suspended_until = GREATEST(
                 COALESCE(auto_suspended_until, now()), now() + v_interval)
         WHERE user_id = p_user;
      ELSE
        v_title := NULL;
      END IF;
    ELSE
      UPDATE public.profiles
         SET ban_status = 'temp_banned',
             auto_suspended_until = now() + v_interval
       WHERE user_id = p_user;
    END IF;

  ELSIF v_effect = 'permanent' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_user, 'permanent', p_ban_reason, p_user);
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = p_user;
  END IF;

  IF v_title IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_user, v_title, v_message, 'warning', '/profile?tab=warnings');
  END IF;

  -- Put the case where a person will actually see it.
  IF v_effect = 'review' AND p_admin_message_format IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT ur.user_id,
           'system_alert',
           'Ban review needed',
           format(p_admin_message_format,
                  COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), p_prior_count + 1),
           '/admin?view=banreview&user=' || p_user,
           false
      FROM public.user_roles ur
      CROSS JOIN LATERAL (
        SELECT full_name, email FROM public.profiles WHERE user_id = p_user
      ) p
     WHERE ur.role = 'admin';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', p_prior_count);
END;
$function$;

-- notify_on_payment_escrowed: effective definition is 20260923152630_notification_links_point_direct_not_at_redirects.sql; restated verbatim except: the 'Payout released' notification carries job_id = NEW.id (found by the tightened guard: it was classified as carrying only because ANOTHER insert in the body has a job link).
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
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := 'Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

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
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- open_dispute_as: effective definition is 20260915071502_reapply_dispute_settlement_objects.sql; restated verbatim except: the admin 'Job disputed' alert carries job_id = _job_id (found by the tightened guard, as above).
CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
  _payment_status text;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text, payment_status
    INTO _customer, _helper, _title, _status, _payment_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  -- (Live guard from 20260915025607, kept verbatim when this migration was
  -- re-derived from the live definition on 2026-09-15.)
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  -- ── Evidence is the filer's own uploads, nothing else (authz review of the
  -- dispute-races rebase, MEDIUM). Both the new-dispute path and the re-file
  -- branch below store `_evidence_urls` verbatim, and they render as <a>/<img>
  -- in the admin console and the other party's dialog. A person may attach only
  -- signed proof-photos URLs for their own uploads on this job
  -- (dispute_evidence_url_ok, section 8); the platform files with none.
  IF _system THEN
    IF COALESCE(cardinality(_evidence_urls), 0) > 0 THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'A platform filing carries no evidence.';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_urls, '{}'::text[])) AS e(u)
     WHERE NOT public.dispute_evidence_url_ok(e.u, _uid, _job_id)
  ) THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- ── Not over a decided dispute whose money has not moved ────────────────
  -- rpc_decide_dispute leaves the job completed/cancelled with the escrow held
  -- until execute-dispute-split settles it. A party re-filing then flipped the
  -- job back to `disputed` (and a withdrawal to in_progress), which handed the
  -- escrow to Quick Release / Quick Refund / the sweep and, via
  -- poster_cancel_job, to void-cancelled-payments — each settling over the
  -- admin's decision, and "Retry settlement" moving the split on top (both
  -- reviews, round 2, HIGH; live shape on prod: job bb2c3732 / dispute
  -- c7a12050). The decision stands until it executes.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) THEN
    RAISE EXCEPTION 'dispute_already_decided'
      USING HINT = 'An admin has already decided this dispute and its payment is being settled.';
  END IF;

  -- ── Not while the escrow is being cancelled ─────────────────────────────
  -- `cancelling` is cancel_escrow's claim: its Stripe refund is in flight.
  -- A dispute stamped onto that job made it `disputed` with the refund still
  -- going out, and an admin Quick Release then paid the Helpr beside it.
  -- claim_dispute_settlement now refuses that shape too; this stops it being
  -- created. Read under the FOR UPDATE above, so cancel_escrow's claim either
  -- committed first (visible here) or waits behind this filing (and its own
  -- status-pinned claim then matches zero rows).
  IF _payment_status = 'cancelling' THEN
    RAISE EXCEPTION 'dispute_payment_being_cancelled'
      USING HINT = 'This job''s payment is being cancelled and refunded, so it can no longer be disputed.';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- Set-like append, 20260915034822. A DOUBLE SUBMIT from the dispute
    -- dialog — two clicks inside one JS task, both past the React-state
    -- `submitting` flag because state does not land until the next render —
    -- sends two calls. The second blocks on the FOR UPDATE above, then lands
    -- HERE, and with a bare `||` it appended the SAME evidence urls a second
    -- time: the admin queue showed each photo twice and `evidence_urls` grew
    -- without bound on every retry. The client now holds a synchronous ref
    -- guard as well (DisputeDialog.tsx), but a guard in the browser is not a
    -- guarantee; this is.
    UPDATE public.disputes
    SET evidence_urls = (
          SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
            FROM (
              SELECT u, min(ord) AS ord
                FROM unnest(
                       evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
                     ) WITH ORDINALITY AS t(u, ord)
               GROUP BY u
            ) d
        )
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = (
             SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
               FROM (
                 SELECT u, min(ord) AS ord
                   FROM unnest(
                          COALESCE(dispute_evidence_urls, '{}'::text[])
                            || COALESCE(_evidence_urls, '{}'::text[])
                        ) WITH ORDINALITY AS t(u, ord)
                  GROUP BY u
               ) d
           )
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  -- ── The job must still be disputable, 20260915034822 ────────────────────
  -- The re-freeze branch above has always checked `_status` against the
  -- transition matrix's own `-> disputed` edges. The NEW-dispute path below
  -- never did: it inserted the row and stamped status='disputed'
  -- unconditionally. `_status` was read under the FOR UPDATE above, so a
  -- concurrent `poster_cancel_job` / completion / payout either commits BEFORE
  -- this call takes the lock (and is therefore visible in `_status`) or waits
  -- behind it — which is exactly why checking it here closes the window
  -- instead of merely narrowing it.
  --
  -- Without it, filing a dispute that raced a cancellation either stamped
  -- `disputed` onto a cancelled job (freezing an escrow that had already been
  -- refunded) or raised `enforce_job_status_transition`'s raw Postgres prose at
  -- the filer. A terse code instead, so `lifecycleErrorMessage` can say what
  -- happened; the allowed set is the same list the re-freeze branch uses.
  IF _status NOT IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls =
           COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
   -- Belt and braces on the predicate above: the same allowed set, written
   -- into the statement itself so the freeze can never land on a job that
   -- moved on, even if a future edit drops the IF.
   WHERE id = _job_id
     AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed — dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and an admin will decide it — add your side.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END IF;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes',
      _job_id
    );
  END LOOP;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;

