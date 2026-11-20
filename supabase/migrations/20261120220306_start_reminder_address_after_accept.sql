-- A Helpr's start reminder never carries the street address before they ACCEPT (owner 2026-11-20; the address rule of
-- 20261120205350_poster_id_at_offer_not_post). sweep_helpr_start_reminders' "Your job starts in 2 hours" text named
-- jobs.location for every row with a helper_id, which an OFFER sets (accept_application) before the Helpr accepts, and
-- for every crew seat, confirmed or not. Now: the street address once jobs.helper_confirmed_at (or the crew seat's
-- helper_confirmed_at) is set, else mask_job_location (the town, as get_jobs_for_my_applications and
-- get_my_pending_direct_offers serve the offered Helpr). Every reminder still goes out (owner: never trim Helpr
-- reminders); only the place in its text changes.
-- Restated from its effective definition (20261104114456); ONLY the two location columns of the `hired` CTE changed.
-- Same signature, grants restated. Replay-safe (CREATE OR REPLACE).
-- Measured on prod 2026-11-20 (read-only): 0 jobs with a helper_id lack helper_confirmed_at; 2 unconfirmed crew seats.
-- Other notice/email/push builders checked for the address: none sends it to a Helpr (notify functions and edge
-- functions grepped for location; instant-job-match already masks, detail-change notices name fields, not places).
-- Guard: src/test/posterIdAtOffer.test.ts; proof: src/test/pglite/startReminderAddressAfterAccept.pglite.mjs.

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
      -- CHANGED (owner 2026-11-20, 20261120205350): the street address only once the Helpr accepted the offer
      -- (helper_confirmed_at); before that, the masked area (town), as every other read the offered Helpr gets.
      SELECT j.id AS job_id, j.helper_id AS user_id, j.title,
             CASE WHEN j.helper_confirmed_at IS NOT NULL THEN j.location ELSE public.mask_job_location(j.location) END AS location,
             j.date_needed, j.start_time,
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
      -- CHANGED (owner 2026-11-20): a crew member's street address only once they confirmed their seat.
      SELECT j.id, g.helper_id, j.title,
             CASE WHEN g.helper_confirmed_at IS NOT NULL THEN j.location ELSE public.mask_job_location(j.location) END,
             j.date_needed, j.start_time,
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
