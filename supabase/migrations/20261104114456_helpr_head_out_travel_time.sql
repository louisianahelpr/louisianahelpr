-- Q2485 (Builder 104, 11-04): "Time to head out" fires at start minus the Helpr's estimated drive time, and 30
-- minutes before with no estimate (the owner's Q2483 rule). Before this every head-out used the 30 minutes: no
-- estimate existed before On my way (measured on prod 2026-10-30, 0 of 6 job_tracking rows carried eta_minutes).
--
-- WHAT:
--   helpr_travel_estimates (new): one drive time per (job, hired Helpr), written only by the service role (the
--     helpr-travel-estimates edge cron asks Apple Maps /v1/etas, _shared/appleRoutes.ts, from the Helpr's saved
--     device position, profiles.latitude/longitude, to the job's point). Nobody else reads or writes it. Goes with the
--     job and with the account (ON DELETE CASCADE).
--   helpr_travel_pairs(p_now) (new, service_role): the hired Helprs (solo and crew, exactly the sweep's set) whose
--     job starts 35 minutes to 3 hours from now, who have not left, whose head-out has not gone out, with both points
--     known, and no estimate measured in the last hour, and none while Apple is paused after an outage
--     (declutter_route_health.miss_until, set by declutter_route_outage, 20261104113516). At most 50.
--   sweep_helpr_start_reminders: restated from 20261030035326 (the only definition) with three changes:
--     1. the head-out window opens at start - lead_minutes: the estimate (at least 5, cron cadence) when one is stored
--        and at most 120 minutes (a longer "drive" is a stale far-away position: ignored), else 30;
--     2. it is merged into Starting soon (sent 30-35 minutes before) only when the lead falls in that same window
--        (30 to 35 minutes); a head-out due earlier or later is not "at the same moment", so it is sent on its own
--        (lead review 11-04: never trim a Helpr reminder);
--     3. the text says the lead: "starts in about <n> minutes" (30 with no estimate, as before).
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name, grants by role name.
-- PROOF: src/test/pglite/helprHeadOutTravel.pglite.mjs. Guard: src/test/helprStartReminders.test.ts.

CREATE TABLE IF NOT EXISTS public.helpr_travel_estimates (
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  minutes integer NOT NULL CHECK (minutes BETWEEN 0 AND 600),
  measured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS helpr_travel_estimates_user_id_idx ON public.helpr_travel_estimates (user_id);
ALTER TABLE public.helpr_travel_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_travel_estimates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.helpr_travel_estimates TO service_role;
COMMENT ON TABLE public.helpr_travel_estimates IS
  'Q2485: a hired Helpr''s estimated drive time to one job (Apple Maps), read by sweep_helpr_start_reminders for "Time to head out". Written only by the helpr-travel-estimates edge cron (service role).';

CREATE OR REPLACE FUNCTION public.helpr_travel_pairs(p_now timestamptz DEFAULT NULL)
RETURNS TABLE (job_id uuid, user_id uuid, from_lat numeric, from_lng numeric, to_lat numeric, to_lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH hired AS (
    SELECT j.id AS job_id, j.helper_id AS user_id, j.date_needed, j.start_time, j.latitude, j.longitude,
           (j.helper_on_the_way_at IS NOT NULL OR j.helper_arrived_at IS NOT NULL) AS left_already
      FROM public.jobs j
     WHERE j.status = 'accepted' AND j.helper_id IS NOT NULL AND j.date_needed IS NOT NULL AND j.start_time IS NOT NULL
    UNION ALL
    SELECT j.id, g.helper_id, j.date_needed, j.start_time, j.latitude, j.longitude,
           (g.helper_on_the_way_at IS NOT NULL OR g.helper_arrived_at IS NOT NULL)
      FROM public.jobs j
      JOIN public.group_job_helpers g ON g.job_id = j.id AND g.helper_id IS NOT NULL
     WHERE j.is_group_job IS TRUE AND j.status IN ('open', 'accepted') AND j.date_needed IS NOT NULL AND j.start_time IS NOT NULL
  )
  SELECT h.job_id, h.user_id, p.latitude, p.longitude, h.latitude, h.longitude
    FROM hired h
    JOIN public.profiles p ON p.user_id = h.user_id
   WHERE NOT h.left_already
     AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
     -- A point Apple cannot be asked about is never a pair (lead review 11-04: it would read as an outage).
     AND p.latitude BETWEEN -90 AND 90 AND p.longitude BETWEEN -180 AND 180
     AND h.latitude BETWEEN -90 AND 90 AND h.longitude BETWEEN -180 AND 180
     AND ((h.date_needed + h.start_time) AT TIME ZONE 'America/Chicago')
         BETWEEN COALESCE(p_now, now()) + interval '35 minutes' AND COALESCE(p_now, now()) + interval '3 hours'
     AND NOT EXISTS (SELECT 1 FROM public.helpr_start_reminder_sends s
                      WHERE s.job_id = h.job_id AND s.user_id = h.user_id AND s.kind = 'head_out')
     AND NOT EXISTS (SELECT 1 FROM public.helpr_travel_estimates e
                      WHERE e.job_id = h.job_id AND e.user_id = h.user_id
                        AND e.measured_at > COALESCE(p_now, now()) - interval '1 hour')
     -- While Apple is paused after an outage (declutter_route_outage, 20261104113516), nobody is measured.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_route_health rh WHERE rh.miss_until > COALESCE(p_now, now()))
   ORDER BY (h.date_needed + h.start_time)
   LIMIT 50;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_travel_pairs(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_travel_pairs(timestamptz) TO service_role;

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
             (j.helper_on_the_way_at IS NOT NULL OR j.helper_arrived_at IS NOT NULL) AS left_already,
             -- Reposted at start - 2h if still true (sweep_confirm_reminders_and_repost).
             (j.helper_confirmed_at IS NOT NULL AND j.helper_dayof_confirmed_at IS NULL
              AND j.is_group_job IS NOT TRUE AND j.parent_job_id IS NULL
              AND NOT public.job_posted_by_seed(j.customer_id)) AS owes_dayof
        FROM public.jobs j
       WHERE j.status = 'accepted'
         AND j.helper_id IS NOT NULL
         AND j.date_needed IS NOT NULL
         AND j.start_time IS NOT NULL
      UNION ALL
      -- Crew: every current member.
      SELECT j.id, g.helper_id, j.title, j.location, j.date_needed, j.start_time,
             (g.helper_on_the_way_at IS NOT NULL OR g.helper_arrived_at IS NOT NULL),
             false
        FROM public.jobs j
        JOIN public.group_job_helpers g ON g.job_id = j.id AND g.helper_id IS NOT NULL
       WHERE j.is_group_job IS TRUE
         AND j.status IN ('open', 'accepted')
         AND j.date_needed IS NOT NULL
         AND j.start_time IS NOT NULL
    ), timed AS (
      -- Q2485: the head-out lead is the Helpr's measured drive time (helpr_travel_estimates, written by the
      -- helpr-travel-estimates cron from Apple Maps), else the owner's no-estimate rule: 30 minutes.
      SELECT h.*, ((h.date_needed + h.start_time) AT TIME ZONE 'America/Chicago') AS starts_at,
             COALESCE((SELECT greatest(5, e.minutes) FROM public.helpr_travel_estimates e
                        WHERE e.job_id = h.job_id AND e.user_id = h.user_id AND e.minutes <= 120), 30) AS lead_minutes
        FROM hired h
    )
    SELECT t.*, k.kind,
           -- The 2-hour reminder is due now or within 15 minutes, or already went out.
           ((v_now >= t.starts_at - interval '135 minutes'
             AND v_now <  t.starts_at - interval '105 minutes'
             AND NOT t.owes_dayof)
            OR EXISTS (SELECT 1 FROM public.helpr_start_reminder_sends s2
                        WHERE s2.job_id = t.job_id AND s2.user_id = t.user_id
                          AND s2.kind = 'two_hours' AND NOT s2.merged)) AS two_hours_near
      FROM timed t
      CROSS JOIN LATERAL (VALUES
        -- 2 hours before, never early, up to 15 minutes late (cron runs every 5),
        -- and never to a Helpr whose job is being reposted for no day-of confirm.
        (CASE WHEN v_now >= t.starts_at - interval '2 hours'
               AND v_now <  t.starts_at - interval '105 minutes'
               AND NOT t.owes_dayof THEN 'two_hours' END),
        -- 8 AM Central on the job day, for a 10 AM or later start, until 9 AM.
        (CASE WHEN v_local::date = t.date_needed
               AND v_local::time >= time '08:00' AND v_local::time < time '09:00'
               AND t.start_time >= time '10:00' THEN 'morning_of' END),
        -- Start minus the drive time (30 minutes with no estimate), until the
        -- start, while the Helpr has not tapped On my way or arrived.
        (CASE WHEN v_now >= t.starts_at - make_interval(mins => t.lead_minutes)
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
      IF v_kind = 'head_out' AND rec.lead_minutes BETWEEN 30 AND 35 THEN
        -- Never two at once: Starting soon (sent 30-35 minutes before) carries it while that switch is on
        -- (no preferences row = the defaults = on). A head-out due at any other moment (a longer drive heads out
        -- earlier, a short one later) is its own reminder: never trim a Helpr reminder (owner rule).
        SELECT COALESCE((SELECT p.remind_starting_soon FROM public.notification_preferences p WHERE p.user_id = rec.user_id), true)
          INTO v_merged;
      ELSIF v_kind = 'morning_of' AND rec.two_hours_near THEN
        -- Never two at once: the 2-hour reminder carries the day while that switch is on.
        SELECT COALESCE((SELECT p.remind_two_hours FROM public.notification_preferences p WHERE p.user_id = rec.user_id), true)
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
        -- A Helpr who still owes the day-of confirm is asked for it (lead 2026-10-30); the link is the
        -- confirm reminder's own (/jobs?job=<id>, the card with "Confirm You'll Be at the Job").
        v_message := CASE WHEN rec.owes_dayof
          THEN format('You have a job today at %s: "%s". Confirm you''ll be there.', to_char(rec.date_needed + rec.start_time, 'FMHH12:MI AM'), rec.title)
          ELSE format('You have a job today at %s: "%s".', to_char(rec.date_needed + rec.start_time, 'FMHH12:MI AM'), rec.title) END;
      ELSE
        v_title := 'Time to head out';
        v_message := format('"%s" starts in about %s minutes. Head out now and tap On my way.', rec.title, rec.lead_minutes);
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

-- The switch's own description (Settings -> Job reminders) says the new timing.
UPDATE public.job_reminder_types
   SET description = 'When it''s time to leave: your drive time before the start, or 30 minutes with no estimate, if you haven''t tapped On my way. Comes as Starting soon when that is at the same time.'
 WHERE kind = 'head_out';

-- The estimate cron: every 15 minutes (a head-out lead is measured 35 minutes to 3 hours ahead, re-measured hourly).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('helpr-travel-estimates', interval '1 hour',
            'Q2485: drive-time estimates for hired Helprs, so "Time to head out" fires at start minus travel time.',
            'exempt', 'Almost every run finds no hired Helpr with a job 35 minutes to 3 hours out: nothing to measure is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('helpr-travel-estimates', '6,21,36,51 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'helpr-travel-estimates')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 120000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/helpr-travel-estimates',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;

-- Q807: refuse writes from an unconfirmed email on the new table (standard guarded attach).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;
