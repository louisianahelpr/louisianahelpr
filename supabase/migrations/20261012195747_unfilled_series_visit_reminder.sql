-- Q417 (e) (follow-ups from the Q407 build, 2026-09-25): a VACATED series
-- visit (open, no Helpr, still funded; a Helpr gave it up or was banned) that
-- nobody claims is cancelled by auto-expire-jobs when its day passes and
-- refunded by void-cancelled-payments less the card processing fee, but
-- nothing told the poster beforehand that it was still unfilled, so they never
-- got the chance to offer it to one of their Helprs.
--
-- sweep_unfilled_series_visit_reminders(): once a day (10:33 AM CDT), every
-- series visit that is open, has no Helpr, is funded and is dated TOMORROW in
-- Louisiana gets ONE notice to its poster, naming the date and what happens if
-- it stays empty. Idempotent: a visit already told (a notification with this
-- title on this job) is skipped, so a re-run or a catch-up run tells nobody
-- twice. A visit whose poster's account is gone (customer_id NULL) is skipped.
-- Returns how many posters were told (cron_record_work records it). Not
-- covered, by design: a visit vacated after the run the day before, or on the
-- day itself; a series already ended or cancelled (it takes no offers).
--
-- Replay-safe: CREATE OR REPLACE; cron and its expectation row only where the
-- objects exist. Grants: service_role only.
-- Proof: src/test/pglite/unfilledSeriesVisitReminder.pglite.mjs. Guard:
-- src/test/unfilledSeriesVisitReminder.test.ts.

CREATE OR REPLACE FUNCTION public.sweep_unfilled_series_visit_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tomorrow date := (now() AT TIME ZONE 'America/Chicago')::date + 1;
  v_count integer;
BEGIN
  WITH due AS (
    SELECT c.id, c.parent_job_id, c.customer_id, c.title, c.date_needed
      FROM public.jobs c
     WHERE c.parent_job_id IS NOT NULL
       AND c.status::text = 'open'
       AND c.helper_id IS NULL
       AND c.customer_id IS NOT NULL
       AND c.date_needed = v_tomorrow
       AND public.job_payment_is_funded(c.payment_status::text)
       -- A series already ended or cancelled takes no offers (offer_series_dates
       -- raises series_ended), so its poster is not told to offer the date
       -- (money review of 3c98e7006, #1).
       AND NOT EXISTS (SELECT 1 FROM public.jobs p
                        WHERE p.id = c.parent_job_id
                          AND (p.series_ended_on IS NOT NULL OR p.status::text = 'cancelled'))
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.job_id = c.id AND n.title = 'A series visit is still unfilled')
  ), told AS (
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    SELECT d.customer_id, d.id,
           'A series visit is still unfilled',
           format('Nobody has taken your "%s" visit tomorrow (%s) yet. If one of your Helprs can take it, offer it to them today. If it stays unfilled, it is cancelled when the day passes and refunded to you, less the card processing fee.',
                  COALESCE(d.title, 'recurring'), to_char(d.date_needed, 'FMMon FMDD')),
           'job_updates',
           '/posts?job=' || d.parent_job_id::text
      FROM due d
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM told;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_unfilled_series_visit_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unfilled_series_visit_reminders() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('unfilled-series-visit-reminders', interval '26 hours',
            'Q417 (e): once a day, tells a poster about a funded series visit dated tomorrow that nobody has taken yet.',
            'exempt',
            'Most days no series visit is vacated: a run that tells nobody is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('unfilled-series-visit-reminders', '33 15 * * *',
                          $c$SELECT public.cron_record_work('unfilled-series-visit-reminders', to_jsonb(public.sweep_unfilled_series_visit_reminders()));$c$);
  END IF;
END
$do$;
