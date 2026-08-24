-- The reliability ladder grows its missing rung, and committed helpers get a
-- door with consequences on it (owner, 2026-08-24):
--
--   "They need to get consequences if they commit to a job then can't make
--    it. Like give them so many chances and after that temp ban then perm ban."
--
-- BEFORE: the job_denial ladder (decline_job_offer + expire_unanswered_offers)
-- went warning → warning → permanent, skipping the temp-ban machinery that
-- already exists end-to-end (ban_status='temp_banned', auto_suspended_until,
-- the expiry sweeper that lifts it, the countdown on /account-banned). And a
-- helper who had ACCEPTED a job had no sanctioned exit at all — the choices
-- were ghosting (free until R1's no-show flow) or a support DM.
--
-- AFTER, one canonical ladder for the whole reliability family:
--   1st strike  — recorded, courtesy warning
--   2nd strike  — final warning (ban_status = final_warning)
--   3rd strike  — 7-DAY SUSPENSION (temp_banned + auto_suspended_until)
--   4th strike  — permanent ban
-- ...used by decline, offer-expiry, and the new helper_cancel_booking RPC, so
-- declining, ghosting, and cancelling after committing all count on ONE meter.
-- (The no-show ladder from 20260824180000 stays separate and harsher — a
-- no-show on a funded, started job is a different offense.)

-- ── 1. The canonical ladder ──
CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(
  p_helper uuid,
  p_job uuid,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prior_count int;
  v_action text;
BEGIN
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper AND violation_type = 'job_denial';

  v_action := CASE
    WHEN v_prior_count >= 3 THEN 'permanent_ban'
    WHEN v_prior_count = 2 THEN 'temp_ban'
    WHEN v_prior_count = 1 THEN 'warning'
    ELSE 'none'
  END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (p_helper, 'job_denial', p_description, p_job, v_action);

  IF v_action = 'warning' THEN
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_helper, 'Final warning',
            'This is your second reliability strike. One more — declining, ignoring, or cancelling a job you committed to — and your account is suspended for 7 days.',
            'warning', '/warnings');
  ELSIF v_action = 'temp_ban' THEN
    UPDATE public.profiles
       SET ban_status = 'temp_banned',
           auto_suspended_until = now() + interval '7 days'
     WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_helper, 'Account suspended for 7 days',
            'Third reliability strike — your account is suspended for 7 days. A fourth strike is a permanent ban.',
            'warning', '/warnings');
  ELSIF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_helper, 'permanent',
            'Fourth reliability strike (declined, ignored, or cancelled committed jobs)', p_helper);
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = p_helper;
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', v_prior_count);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2. decline_job_offer now rides the ladder ──
CREATE OR REPLACE FUNCTION public.decline_job_offer(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_result jsonb;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title
    INTO v_job_helper, v_job_title
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id).
  IF v_job_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  v_result := public.apply_job_denial_consequence(
    v_app_helper, v_job_id,
    'Declined job offer: "' || COALESCE(v_job_title, 'Unknown') || '"');

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  RETURN v_result;
END;
$function$;

-- ── 3. expire_unanswered_offers now rides the ladder ──
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
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_locked.customer_id,
      'Offer expired — job reopened',
      'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/my-posts'
    );

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_locked.helper_id,
      'You lost a job offer',
      'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
        || '" and it went back to everyone. Letting an offer expire counts the same as declining it.',
      'expired',
      '/my-jobs'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── 4. The sanctioned exit: cancel a committed booking ──
CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
BEGIN
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the poster or support.';
  END IF;

  v_result := public.apply_job_denial_consequence(
    auth.uid(), v_job.id,
    'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr cancelled',
    'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
      || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/my-posts'
  );

  RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated;
