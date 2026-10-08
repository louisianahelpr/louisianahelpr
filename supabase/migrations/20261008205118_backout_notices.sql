-- WHEN SOMEONE BACKS OUT, THE OTHER PERSON CANNOT MISS IT (owner, 2026-10-08,
-- Q1575: "if someone declines an offer or cancels instead of accept
-- confirmation the other person needs to be very aware so they don't show up
-- or expect someone and they had no idea"; docs/JOB-LIFECYCLE.md "When someone
-- backs out").
--
-- The RPCs that back out (decline_job_offer, the offer expiry sweep,
-- helper_cancel_booking, poster_cancel_job, respond_to_direct_offer) already
-- write the in-app notice, which fans out to push. This adds, for every one of
-- them at once because it reads the JOB ROW'S transition rather than any one
-- RPC:
--   1. a backout_notices row for the other person, which keeps their card in
--      Needs You with a red banner until they tap Got It (ack_backout_notice);
--   2. an email at once;
--   3. inside 24 hours of the start, a repeat push every 2 hours until Got It
--      (sweep_backout_notice_reminders, every 15 minutes).
-- One-Helpr jobs only: a crew member leaving has its own notices (Q1409).
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS.

CREATE TABLE IF NOT EXISTS public.backout_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_name text,
  backout_kind text NOT NULL CHECK (backout_kind IN ('offer_declined', 'offer_expired', 'helper_cancelled', 'poster_cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  last_push_at timestamptz
);
CREATE INDEX IF NOT EXISTS backout_notices_open_by_user ON public.backout_notices (user_id) WHERE acknowledged_at IS NULL;
ALTER TABLE public.backout_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recipients read their own back-out notices" ON public.backout_notices;
CREATE POLICY "Recipients read their own back-out notices" ON public.backout_notices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.backout_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.backout_notices TO authenticated;
GRANT ALL ON public.backout_notices TO service_role;

-- The words, one place, for the email and the repeat pushes.
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
      ELSE 'Job cancelled'
    END,
    CASE p_kind
      WHEN 'offer_declined' THEN COALESCE(p_actor, 'The Helpr') || ' declined your offer for "' || COALESCE(p_title, 'your job') || '". It''s open to everyone again.'
      WHEN 'offer_expired' THEN 'Your offer for "' || COALESCE(p_title, 'your job') || '" expired without an answer. It''s open to everyone again.'
      WHEN 'helper_cancelled' THEN COALESCE(p_actor, 'Your Helpr') || ' cancelled "' || COALESCE(p_title, 'your job') || '" and won''t be coming. It''s open to everyone again.'
      ELSE COALESCE(p_actor, 'The person who posted it') || ' cancelled "' || COALESCE(p_title, 'the job') || '". Don''t go.'
    END;
$fn$;
REVOKE ALL ON FUNCTION public.backout_notice_text(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_backout_email(p_user uuid, p_title text, p_message text, p_link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Best effort: a failed email never fails the back-out that caused it.
  BEGIN
    IF COALESCE((SELECT email_job_updates FROM public.notification_preferences WHERE user_id = p_user), true) THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', 'job_updates', 'link', p_link)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_backout_email: %', SQLERRM;
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.send_backout_email(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

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
  PERFORM public.send_backout_email(v_recipient, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_record_backout_notice ON public.jobs;
CREATE TRIGGER trg_jobs_record_backout_notice
  AFTER UPDATE OF status, helper_id, direct_offer_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.record_backout_notice();

-- GOT IT.
CREATE OR REPLACE FUNCTION public.ack_backout_notice(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE public.backout_notices
     SET acknowledged_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND acknowledged_at IS NULL;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ack_backout_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_backout_notice(uuid) TO authenticated, service_role;

-- INSIDE 24 HOURS OF THE START, A PUSH EVERY 2 HOURS UNTIL GOT IT.
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
  FOR r IN
    SELECT n.id, n.user_id, n.backout_kind, n.actor_name, j.id AS job_id, j.title, j.customer_id
      FROM public.backout_notices n
      JOIN public.jobs j ON j.id = n.job_id
     WHERE n.acknowledged_at IS NULL
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

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('backout-notice-reminders', interval '45 minutes',
            'Q1575: every 15 minutes, re-pushes an unacknowledged back-out notice inside 24 hours of the job''s start.',
            'exempt',
            'Most runs send nothing (nobody backed out near a start): a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('backout-notice-reminders', '7-59/15 * * * *',
                          $c$SELECT public.cron_record_work('backout-notice-reminders', to_jsonb(public.sweep_backout_notice_reminders()));$c$);
  END IF;
END
$do$;
