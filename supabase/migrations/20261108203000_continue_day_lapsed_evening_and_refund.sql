-- JOBS AUDIT 11-08, #9 and #11 (Medium): ~/.lh-shots/handoffs-1108/jobs-audit.md.
--
-- #9  The evening "not marked done" check-ins (sweep_job_continue_day_reminders, restated from 20261108160000) fired
--     only within evening_at + 6 h, so a continue day that lapsed before that migration (Yusef's 7b1da54b, day 11/06
--     3:15 PM) never gets them, and its first word to either side would be the stalled ladder's daily run
--     (stalled-completion-reminder, 13:46 UTC; it already measures a lapsed day from that day, _shared/continueDay.ts).
--     Now each evening kind goes ONCE, from the evening on, until the stalled ladder has nudged the job; a late send
--     names the day instead of "today". Titles are unchanged (the continue-day email trigger lists them).
-- #11 A continue day and a refund request's "come back and finish" could each move the work: nothing refused a
--     continue day while a refund request was live. The come-back side cannot start on a job under way (its schedule
--     change needs a booked job before its start: refundRequests/errorCopy schedule_change_not_booked / too_late), and a
--     continue day needs one under way, so the one missing refusal is here: a new continue day (either side) is refused
--     'continue_day_refund_open' while a refund request on the job is live (refund_request_is_live, the rule
--     refuse_job_move_while_refund_requested already uses). Server writers are never refused.
--
-- Proof: src/test/pglite/continueDayLapsedAndRefund.pglite.mjs. Guard: src/test/continueDayLapsedAndRefund.test.ts.

CREATE OR REPLACE FUNCTION public.sweep_job_continue_day_reminders(p_now timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  rec record;
  v_claimed integer;
  v_sent integer := 0;
BEGIN
  FOR rec IN
    WITH active AS (
      SELECT c.id AS continue_id, c.new_date, c.new_start_time, c.helper_confirmed_at,
             j.id AS job_id, j.title, j.customer_id, j.helper_id,
             ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') AS starts_at,
             -- CHANGED 20261108160000 (owner 11-08, Yusef's job): the evening check-in on the new day, 7 PM Central or
             -- 2 hours after the start, whichever is later.
             GREATEST(((c.new_date + time '19:00') AT TIME ZONE 'America/Chicago'),
                      ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') + interval '2 hours') AS evening_at,
             EXISTS (SELECT 1 FROM public.job_completion_nudges n WHERE n.job_id = j.id AND n.first_sent_at IS NOT NULL) AS nudged
        FROM public.job_continue_days c
        JOIN public.jobs j ON j.id = c.job_id
       WHERE c.status = 'set'
         AND j.status::text = 'in_progress'
         AND j.helper_id IS NOT NULL
         AND j.helper_completed_at IS NULL
    )
    SELECT a.*, k.kind
      FROM active a
      CROSS JOIN LATERAL (VALUES
        -- 2 hours before, up to 15 minutes late (cron every 10), to each side.
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_helpr' END),
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_poster' END),
        -- The day-of confirm ask: from 7 AM Central on the new day (or 3 hours before an earlier start), until the start.
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= LEAST(((a.new_date + time '07:00') AT TIME ZONE 'America/Chicago'), a.starts_at - interval '3 hours')
               AND v_now < a.starts_at THEN 'confirm_ask' END),
        -- 30 minutes past the new start without the Helpr's confirm: tell the poster (nothing is marked).
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= a.starts_at + interval '30 minutes'
               AND v_now < a.starts_at + interval '6 hours' THEN 'not_confirmed_poster' END),
        -- CHANGED 20261108160000: the evening of the new day, still not marked done: ask the Helpr and tell the poster.
        -- CHANGED 20261108203000 (Jobs audit 11-08 #9): once, from the evening on, until the stalled ladder has nudged
        -- (job_completion_nudges.first_sent_at; agreeing a day clears an un-escalated row). The 6-hour window meant a
        -- day that lapsed before 20261108160000 (Yusef's 7b1da54b, 11/06) never got these at all.
        (CASE WHEN v_now >= a.evening_at AND (v_now < a.evening_at + interval '6 hours' OR NOT a.nudged) THEN 'evening_not_done_helpr' END),
        (CASE WHEN v_now >= a.evening_at AND (v_now < a.evening_at + interval '6 hours' OR NOT a.nudged) THEN 'evening_not_done_poster' END)
      ) AS k(kind)
     WHERE k.kind IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.job_continue_reminder_sends s WHERE s.continue_id = a.continue_id AND s.kind = k.kind)
     ORDER BY a.starts_at
     LIMIT 300
  LOOP
    INSERT INTO public.job_continue_reminder_sends (continue_id, kind, sent_at)
    VALUES (rec.continue_id, rec.kind, v_now)
    ON CONFLICT (continue_id, kind) DO NOTHING;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    CONTINUE WHEN v_claimed = 0;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask', 'evening_not_done_helpr') THEN rec.helper_id ELSE rec.customer_id END,
      rec.job_id,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN 'Back on your job in 2 hours'
        WHEN 'two_hours_poster' THEN 'Your Helpr is back in 2 hours'
        WHEN 'confirm_ask' THEN 'Confirm you''ll be back today'
        WHEN 'evening_not_done_helpr' THEN 'Did you finish today?'
        WHEN 'evening_not_done_poster' THEN 'Not marked done yet'
        ELSE 'Your Helpr hasn''t confirmed today'
      END,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN format('"%s" continues today at %s.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'two_hours_poster' THEN format('Your Helpr comes back to finish "%s" today at %s.', COALESCE(rec.title, 'your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'confirm_ask' THEN format('"%s" continues today at %s. Confirm you''ll be there.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        -- CHANGED 20261108203000 (#9): a late send names the day ("on Fri 11/6"), never "today".
        WHEN 'evening_not_done_helpr' THEN format('"%s" was set to finish %s. Done? Add an after photo from %s and mark it done. Not done? Set another day.', COALESCE(rec.title, 'Your job'),
               CASE WHEN (v_now AT TIME ZONE 'America/Chicago')::date > rec.new_date THEN 'on ' || to_char(rec.new_date, 'FMDy FMMM/FMDD') ELSE 'today' END,
               CASE WHEN (v_now AT TIME ZONE 'America/Chicago')::date > rec.new_date THEN 'that day' ELSE 'today' END)
        WHEN 'evening_not_done_poster' THEN format('Your Helpr hasn''t marked "%s" done %s. Message them, or set another day. Your payment stays held.', COALESCE(rec.title, 'your job'),
               CASE WHEN (v_now AT TIME ZONE 'America/Chicago')::date > rec.new_date THEN 'since ' || to_char(rec.new_date, 'FMDy FMMM/FMDD') ELSE 'today' END)
        ELSE format('"%s" was set to continue at %s and your Helpr hasn''t confirmed. Message them, or set another day.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
      END,
      'job_updates',
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask', 'evening_not_done_helpr') THEN '/jobs?job=' ELSE '/posts?job=' END || rec.job_id::text
    );
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (rec.job_id, rec.continue_id, NULL, 'reminder', jsonb_build_object('kind', rec.kind));
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) TO service_role;

-- ── #11 No continue day while a refund request is live ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refuse_continue_day_while_refund_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('proposed', 'set') AND EXISTS (
       SELECT 1 FROM public.refund_requests r
        WHERE r.job_id = NEW.job_id
          AND public.refund_request_is_live(r.status, r.dispute_id)) THEN
    RAISE EXCEPTION 'continue_day_refund_open' USING ERRCODE = '23514',
      HINT = 'A refund request on this job is waiting on an answer or being settled. Answer or withdraw it first.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_continue_day_while_refund_live() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_refuse_continue_day_while_refund_live ON public.job_continue_days;
CREATE TRIGGER trg_refuse_continue_day_while_refund_live
  BEFORE INSERT ON public.job_continue_days
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_continue_day_while_refund_live();
