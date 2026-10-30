-- Three more start reminders for hired Helprs (owner decision 2026-10-29, Q2483:
-- "Helprs get MANY reminders"). Each is ON by default and switchable in
-- Settings > Notifications > Job reminders (built on Q2482, 20261030031059).
--
--   two_hours   "Your job starts in 2 hours": 2 hours before the start, with the
--               address; the link opens the job card, whose Directions button
--               opens maps (src/pages/jobs/appliedJobCard/DirectionsButton.tsx).
--   morning_of  "You have a job today": 8 AM Central on the job day, only for a
--               job that starts at 10 AM or later.
--   head_out    "Time to head out": 30 minutes before the start, if the Helpr
--               has not tapped On my way (or arrived). Merged with Starting
--               soon so they never get two at once: while their Starting soon
--               switch is on, Starting soon (which already says "Head out so
--               you arrive on time") IS this reminder and nothing more is sent;
--               with Starting soon off and this on, "Time to head out" is sent.
--               Travel estimate: none exists before On my way is tapped
--               (measured on prod 2026-10-30, read-only: 0 of 6 job_tracking
--               rows carry eta_minutes, and the row is written by the On my way
--               tap itself), so every head-out uses the owner's no-estimate rule
--               (30 minutes before). Q2485 tracks a travel-estimate source.
--
-- Who gets them: the hired Helpr of an accepted solo job, and every hired member
-- of a crew job (open or accepted), exactly the people Starting soon reaches.
-- Never for a cancelled job, and never for a Helpr who is no longer on it (the
-- sweep reads the job's CURRENT helper / crew rows at send time).
--
-- Once per job per Helpr per reminder: public.helpr_start_reminder_sends, primary
-- key (job_id, user_id, kind). A Helpr hired onto a job after someone else was
-- removed gets their own reminders.
--
-- Channels, as Starting soon: in-app row; push through fan_out_push_on_notification
-- (each row matches its own job_reminder_types entry, so its own switch decides,
-- and push_enabled still wins); text when opted in. sms_kind_for (restated below
-- from its live definition, read 2026-10-30 with pg_get_functiondef and equal to
-- 20261023181442) maps the 2-hour and head-out reminders to 'starting_soon' (sent
-- at night like Starting soon, stale after 45 minutes); the 8 AM one is an
-- ordinary 'job_update' text (job_id is set). A switched-off reminder is not
-- written at all (trg_notifications_reminder_choice, 20261030031059).
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO UPDATE, and
-- cron.schedule by name (it replaces the job of the same name).
-- Proof: src/test/pglite/helprStartReminders.pglite.mjs.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS remind_two_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_morning_of boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_head_out boolean NOT NULL DEFAULT true;

INSERT INTO public.job_reminder_types AS t (kind, label, description, always_on, pref_column, match_type, match_title, match_message_like, sort_order) VALUES
  ('morning_of', 'You have a job today',       '8 AM on the day of a job that starts at 10 AM or later.',                                false, 'remind_morning_of', 'job_update', 'You have a job today',       NULL, 102),
  ('two_hours',  'Your job starts in 2 hours', '2 hours before, with the address and directions.',                                     false, 'remind_two_hours',  'job_update', 'Your job starts in 2 hours', NULL, 104),
  ('head_out',   'Time to head out',           '30 minutes before, if you haven''t tapped On my way. Comes as Starting soon when that is on.', false, 'remind_head_out',   'job_update', 'Time to head out',           NULL, 112)
ON CONFLICT (kind) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, always_on = EXCLUDED.always_on,
  pref_column = EXCLUDED.pref_column, match_type = EXCLUDED.match_type, match_title = EXCLUDED.match_title,
  match_message_like = EXCLUDED.match_message_like, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.helpr_start_reminder_sends (
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('two_hours', 'morning_of', 'head_out')),
  -- true = carried by Starting soon (head_out only); nothing extra was sent.
  merged boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id, kind)
);
COMMENT ON TABLE public.helpr_start_reminder_sends IS
  'Q2483: one row per job, Helpr and start reminder (two_hours, morning_of, head_out) already handled, so each is sent at most once. Written only by sweep_helpr_start_reminders().';
ALTER TABLE public.helpr_start_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_start_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.helpr_start_reminder_sends TO service_role;

-- p_now: the clock the windows read (NULL = now()). Cron never passes it; the
-- PGlite proof does, to test each edge to the millisecond and a DST day.
CREATE OR REPLACE FUNCTION public.sweep_helpr_start_reminders(p_now timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_local timestamp := (COALESCE(p_now, now()) AT TIME ZONE 'America/Chicago');
  rec RECORD;
  v_kind text;
  v_title text;
  v_message text;
  v_merged boolean;
  v_claimed integer;
  total_sent integer := 0;
BEGIN
  FOR rec IN
    WITH hired AS (
      -- Solo: the job's current Helpr.
      SELECT j.id AS job_id, j.helper_id AS user_id, j.title, j.location, j.date_needed, j.start_time,
             (j.helper_on_the_way_at IS NOT NULL OR j.helper_arrived_at IS NOT NULL) AS left_already
        FROM public.jobs j
       WHERE j.status = 'accepted'
         AND j.helper_id IS NOT NULL
         AND j.date_needed IS NOT NULL
         AND j.start_time IS NOT NULL
      UNION ALL
      -- Crew: every current member.
      SELECT j.id, g.helper_id, j.title, j.location, j.date_needed, j.start_time,
             (g.helper_on_the_way_at IS NOT NULL OR g.helper_arrived_at IS NOT NULL)
        FROM public.jobs j
        JOIN public.group_job_helpers g ON g.job_id = j.id AND g.helper_id IS NOT NULL
       WHERE j.is_group_job IS TRUE
         AND j.status IN ('open', 'accepted')
         AND j.date_needed IS NOT NULL
         AND j.start_time IS NOT NULL
    ), timed AS (
      SELECT h.*, ((h.date_needed + h.start_time) AT TIME ZONE 'America/Chicago') AS starts_at
        FROM hired h
    )
    SELECT t.*, k.kind
      FROM timed t
      CROSS JOIN LATERAL (VALUES
        -- 2 hours before, never early, up to 15 minutes late (cron runs every 5).
        (CASE WHEN v_now >= t.starts_at - interval '2 hours'
               AND v_now <  t.starts_at - interval '105 minutes' THEN 'two_hours' END),
        -- 8 AM Central on the job day, for a 10 AM or later start, until 9 AM.
        (CASE WHEN v_local::date = t.date_needed
               AND v_local::time >= time '08:00' AND v_local::time < time '09:00'
               AND t.start_time >= time '10:00' THEN 'morning_of' END),
        -- 30 minutes before (the no-estimate rule), until the start, while the
        -- Helpr has not tapped On my way or arrived.
        (CASE WHEN v_now >= t.starts_at - interval '30 minutes'
               AND v_now <  t.starts_at
               AND NOT t.left_already THEN 'head_out' END)
      ) AS k(kind)
     WHERE k.kind IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.helpr_start_reminder_sends s
                        WHERE s.job_id = t.job_id AND s.user_id = t.user_id AND s.kind = k.kind)
     ORDER BY t.starts_at
     LIMIT 300
  LOOP
    BEGIN
      v_kind := rec.kind;
      v_merged := false;
      IF v_kind = 'head_out' THEN
        -- Never two at once: Starting soon carries it while that switch is on
        -- (no preferences row = the defaults = on).
        SELECT COALESCE((SELECT p.remind_starting_soon FROM public.notification_preferences p WHERE p.user_id = rec.user_id), true)
          INTO v_merged;
      END IF;

      INSERT INTO public.helpr_start_reminder_sends (job_id, user_id, kind, merged, sent_at)
      VALUES (rec.job_id, rec.user_id, v_kind, v_merged, v_now)
      ON CONFLICT (job_id, user_id, kind) DO NOTHING;
      GET DIAGNOSTICS v_claimed = ROW_COUNT;
      IF v_claimed = 0 OR v_merged THEN
        CONTINUE;
      END IF;

      IF v_kind = 'two_hours' THEN
        v_title := 'Your job starts in 2 hours';
        v_message := CASE WHEN NULLIF(btrim(rec.location), '') IS NULL
          THEN format('"%s" starts at %s. Tap for directions.', rec.title, to_char(rec.date_needed + rec.start_time, 'FMHH12:MI AM'))
          ELSE format('"%s" starts at %s at %s. Tap for directions.', rec.title, to_char(rec.date_needed + rec.start_time, 'FMHH12:MI AM'), rec.location) END;
      ELSIF v_kind = 'morning_of' THEN
        v_title := 'You have a job today';
        v_message := format('You have a job today at %s: "%s".', to_char(rec.date_needed + rec.start_time, 'FMHH12:MI AM'), rec.title);
      ELSE
        v_title := 'Time to head out';
        v_message := format('"%s" starts in about 30 minutes. Head out now and tap On my way.', rec.title);
      END IF;

      -- A reminder the Helpr switched off is dropped by trg_notifications_reminder_choice (0 rows).
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.user_id, 'job_update', v_title, v_message, '/jobs?job=' || rec.job_id::text, false, rec.job_id);
      GET DIAGNOSTICS v_claimed = ROW_COUNT;
      total_sent := total_sent + v_claimed;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_helpr_start_reminders', rec.kind || ':' || rec.job_id::text, SQLERRM,
        jsonb_build_object('job_id', rec.job_id, 'kind', rec.kind));
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_helpr_start_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_helpr_start_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_helpr_start_reminders(timestamptz) TO service_role;

-- Restated from its live definition (pg_get_functiondef, 2026-10-30; equal to
-- 20261023181442). Only change: the 2-hour and head-out reminders are texted as
-- 'starting_soon' (time-critical: not held for quiet hours, stale after 45 min).
CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title = 'You got a direct job offer!' THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type = 'warning' AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Other updates on the member's own job (never a back-out reminder: those
    -- are type 'warning' and not listed above).
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_kind_for(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_kind_for(text, text, uuid) TO service_role;

-- The cron: every 5 minutes (the 2-hour window is 15 minutes wide).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('sweep-helpr-start-reminders', interval '30 minutes',
            'Q2483: hired Helprs get "Your job starts in 2 hours", "You have a job today" (8 AM) and "Time to head out", once each per job.',
            'exempt', 'Almost every run finds no hired job at a reminder edge: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('sweep-helpr-start-reminders', '1-59/5 * * * *',
      $c$SELECT public.cron_record_work('sweep-helpr-start-reminders', to_jsonb(public.sweep_helpr_start_reminders()));$c$);
  END IF;
END
$do$;
