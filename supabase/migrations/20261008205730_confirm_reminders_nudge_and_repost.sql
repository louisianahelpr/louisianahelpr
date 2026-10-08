-- THE HELPR WHO NEVER CONFIRMS (owner, 2026-10-08, answer 1 to the job
-- lifecycle contract, docs/JOB-LIFECYCLE.md): "helpr and poster can each nudge
-- each other so they can confirm. if they don't, 2 hrs before it's reposted.
-- they should also be getting notifications to confirm until they have
-- confirmed."
--
-- 1. nudge_confirm(job): either side asks the other to confirm, once per 2
--    hours per job, only while the other side owes it.
-- 2. sweep_confirm_reminders_and_repost(), every 5 minutes:
--    a. a Helpr who has not confirmed, inside the day-before window, is
--       reminded every 3 hours until they do (the first reminder stays
--       sweep_dayof_confirm_reminders');
--    b. still unconfirmed 2 hours before the start: the job is REPOSTED. The
--       Helpr comes off it (no strike), their application closes as
--       'not_confirmed', both are told, and the poster's card shows the
--       back-out banner (kind 'helper_unconfirmed', Q1575). The payment stays
--       held for whoever is hired next.
-- One-Helpr, one-off jobs posted by real accounts (crews, series visits and
-- is_seed test posters keep their own flows). Replay-safe.

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_closed_reason_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_closed_reason_check
  CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed'));

ALTER TABLE public.backout_notices DROP CONSTRAINT IF EXISTS backout_notices_backout_kind_check;
ALTER TABLE public.backout_notices ADD CONSTRAINT backout_notices_backout_kind_check
  CHECK (backout_kind IN ('offer_declined', 'offer_expired', 'helper_cancelled', 'poster_cancelled', 'helper_unconfirmed'));

CREATE OR REPLACE FUNCTION public.backout_notice_text(p_kind text, p_actor text, p_title text)
RETURNS TABLE (title text, message text)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT
    CASE p_kind
      WHEN 'offer_declined' THEN 'Offer declined'
      WHEN 'offer_expired' THEN 'Offer expired'
      WHEN 'helper_cancelled' THEN 'Your Helpr cancelled'
      WHEN 'helper_unconfirmed' THEN 'Your Helpr didn''t confirm'
      ELSE 'Job cancelled'
    END,
    CASE p_kind
      WHEN 'offer_declined' THEN COALESCE(p_actor, 'The Helpr') || ' declined your offer for "' || COALESCE(p_title, 'your job') || '". It''s open to everyone again.'
      WHEN 'offer_expired' THEN 'Your offer for "' || COALESCE(p_title, 'your job') || '" expired without an answer. It''s open to everyone again.'
      WHEN 'helper_cancelled' THEN COALESCE(p_actor, 'Your Helpr') || ' cancelled "' || COALESCE(p_title, 'your job') || '" and won''t be coming. It''s open to everyone again.'
      WHEN 'helper_unconfirmed' THEN COALESCE(p_actor, 'Your Helpr') || ' didn''t confirm "' || COALESCE(p_title, 'your job') || '", so we reposted it to other Helprs.'
      ELSE COALESCE(p_actor, 'The person who posted it') || ' cancelled "' || COALESCE(p_title, 'the job') || '". Don''t go.'
    END;
$fn$;
REVOKE ALL ON FUNCTION public.backout_notice_text(text, text, text) FROM PUBLIC, anon, authenticated;

-- The back-out trigger learns the repost: same transition as a cancel, but
-- the sweep marks it, so the poster reads "didn't confirm", not "cancelled".
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(btrim(p.full_name), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;

-- ── 1. NUDGE ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nudge_confirm(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job public.jobs;
  v_uid uuid := auth.uid();
  v_target uuid;
  v_sender text;
  v_owes boolean;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL OR (v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id) THEN
    RAISE EXCEPTION 'not_a_party' USING ERRCODE = '42501';
  END IF;
  -- A restricted account sends nobody anything (the ban gate, Q281).
  IF public.is_caller_banned() THEN
    RETURN 'account_restricted';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_confirmed_at IS NULL THEN
    RETURN 'not_booked';
  END IF;
  v_target := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;
  v_owes := CASE WHEN v_target = v_job.helper_id THEN v_job.helper_dayof_confirmed_at IS NULL ELSE v_job.poster_confirmed_at IS NULL END;
  IF NOT v_owes THEN
    RETURN 'already_confirmed';
  END IF;
  -- Once per 2 hours per job per sender: the notifications row is the record.
  IF EXISTS (SELECT 1 FROM public.notifications n
              WHERE n.user_id = v_target AND n.job_id = p_job_id AND n.title = 'Please confirm'
                AND n.created_at > now() - interval '2 hours') THEN
    RETURN 'too_soon';
  END IF;
  SELECT COALESCE(NULLIF(split_part(btrim(p.full_name), ' ', 1), ''), 'They') INTO v_sender
    FROM public.profiles p WHERE p.user_id = v_uid;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_target, 'Please confirm',
    COALESCE(v_sender, 'They') || ' asked you to confirm "' || COALESCE(v_job.title, 'the job') || '" is still on.'
      || CASE WHEN v_target = v_job.helper_id THEN ' If you don''t confirm 2 hours before the start, it''s reposted to other Helprs.' ELSE '' END,
    'job_update',
    CASE WHEN v_target = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || p_job_id::text,
    p_job_id
  );
  RETURN 'sent';
END;
$fn$;
REVOKE ALL ON FUNCTION public.nudge_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_confirm(uuid) TO authenticated, service_role;

-- ── 2. REMINDERS EVERY 3 HOURS, AND THE REPOST ─────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_confirm_reminders_and_repost()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r record;
  v_reminded integer := 0;
  v_reposted integer := 0;
  v_name text;
BEGIN
  FOR r IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
           (j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago' AS starts_at
      FROM public.jobs j
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.helper_confirmed_at IS NOT NULL
       AND j.helper_dayof_confirmed_at IS NULL
       AND j.is_group_job IS NOT TRUE
       AND j.parent_job_id IS NULL
       AND j.date_needed IS NOT NULL
       AND NOT public.job_posted_by_seed(j.customer_id)
       AND (j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago'
           BETWEEN now() AND now() + interval '24 hours'
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    IF r.starts_at <= now() + interval '2 hours' THEN
      -- THE REPOST. The flag tells record_backout_notice this is not a cancel.
      PERFORM set_config('app.repost_unconfirmed', '1', true);
      UPDATE public.jobs
         SET status = 'open', helper_id = NULL, response_deadline = NULL,
             helper_confirmed_at = NULL, helper_dayof_confirmed_at = NULL,
             dayof_confirm_reminder_sent_at = NULL, dayof_unanswered_poster_alert_sent_at = NULL,
             start_reminder_sent_at = NULL
       WHERE id = r.id AND status = 'accepted' AND helper_id = r.helper_id AND helper_dayof_confirmed_at IS NULL;
      PERFORM set_config('app.repost_unconfirmed', '0', true);
      IF FOUND THEN
        UPDATE public.applications SET status = 'rejected', closed_reason = 'not_confirmed'
         WHERE job_id = r.id AND helper_id = r.helper_id AND status = 'accepted';
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (r.helper_id, 'Job reposted',
                'You didn''t confirm "' || COALESCE(r.title, 'the job') || '" 2 hours before it started, so it was reposted to other Helprs. Don''t go.',
                'warning', '/jobs?job=' || r.id::text, r.id);
        v_reposted := v_reposted + 1;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.notifications n
                       WHERE n.user_id = r.helper_id AND n.job_id = r.id
                         AND n.title IN ('Still on for tomorrow?', 'Confirm you''ll be there', 'Please confirm')
                         AND n.created_at > now() - interval '3 hours') THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (r.helper_id, 'Confirm you''ll be there',
              'Tap "Confirm You''ll Be at the Job" for "' || COALESCE(r.title, 'the job') || '". If you haven''t confirmed 2 hours before it starts, it''s reposted to other Helprs.',
              'job_update', '/jobs?job=' || r.id::text, r.id);
      v_reminded := v_reminded + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reminded', v_reminded, 'reposted', v_reposted);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_confirm_reminders_and_repost() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('confirm-reminders-and-repost', interval '20 minutes',
            'Owner 2026-10-08: every 5 minutes, reminds an unconfirmed Helpr every 3 hours inside the day-before window, and reposts the job 2 hours before the start if they still have not confirmed.',
            'exempt',
            'Most runs do nothing (every Helpr confirmed): a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('confirm-reminders-and-repost', '3-59/5 * * * *',
                          $c$SELECT public.cron_record_work('confirm-reminders-and-repost', to_jsonb(public.sweep_confirm_reminders_and_repost()));$c$);
  END IF;
END
$do$;
