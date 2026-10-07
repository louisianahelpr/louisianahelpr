-- Q1460 (owner decision, 2026-10-06): an under-filled crew STARTS WITH WHO IS
-- HIRED instead of being auto-cancelled at its start.
--
-- Before: accept_group_application leaves a crew 'open' until its LAST spot
-- fills, an 'open' crew cannot be worked (the member/poster arrival RPCs raise
-- job_not_active; auto_start_due_jobs only picks 'accepted'), and at its start
-- auto-expire-jobs cancels every 'open' job past expires_at, so a crew of 3
-- with 2 hired was cancelled: the poster fully refunded, the hired Helprs paid
-- nothing (lh-money-escrow review of the group-jobs flip, 2026-10-06).
--
-- Now: start_underfilled_crews() books every funded, still-'open' crew whose
-- hiring has CLOSED (job_offer_cutoff within 15 minutes: the exact test
-- accept_group_application refuses new hires on, so the poster loses no fill
-- time) or whose listing has expired, and that has at least one CONFIRMED
-- member: status -> 'accepted'. It runs every 5 minutes (pg_cron
-- start-underfilled-crews) and again from auto-expire-jobs before its cancel
-- step, so members can press On my way before the start, as in a full crew
-- (lh-money-escrow review: booking only from the hourly sweep left the crew
-- unworkable for up to an hour). Only CONFIRMED members count, in the test
-- and in the poster's notice: an unconfirmed hire expires at the start
-- (expire_unanswered_offers) and must not make a crew look staffed. From there it is
-- an ordinary booked crew: auto_start_due_jobs starts it once every hired
-- member has confirmed, each member is paid their share frozen at hire
-- (share_cents), and process-scheduled-payouts refunds the empty spots' share
-- to the poster pro rata (already built). Until the start the crew stays
-- 'open' and listed, so the poster can keep trying to fill the spot.
--
-- A crew with NOBODY hired is untouched here; the cancel step still cancels it.
-- Server-only: no grant to anon/authenticated (cron/service role only).
-- Replay-safe: CREATE OR REPLACE; the grants are restated.

CREATE OR REPLACE FUNCTION public.start_underfilled_crews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  rec     record;
  started integer := 0;
  v_hired integer;
BEGIN
  FOR rec IN
    SELECT j.id, j.customer_id, j.title, j.helpers_needed
      FROM public.jobs j
     WHERE j.status = 'open'::job_status
       AND j.is_group_job IS TRUE
       AND public.job_payment_is_funded(j.payment_status)
       AND (
             public.job_offer_cutoff(j.date_needed, j.start_time) <= now() + interval '15 minutes'
          OR (j.expires_at IS NOT NULL AND j.expires_at < now())
          OR (j.expires_at IS NULL AND j.date_needed < (now() AT TIME ZONE 'America/Chicago')::date)
       )
       AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                    WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NOT NULL)
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    BEGIN
      SELECT count(*) INTO v_hired
        FROM public.group_job_helpers g
       WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NOT NULL;

      UPDATE public.jobs
         SET status = 'accepted'::job_status
       WHERE id = rec.id
         AND status = 'open'::job_status;

      IF FOUND THEN
        started := started + 1;
        IF rec.customer_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
          VALUES (
            rec.customer_id, rec.id,
            'Your crew is starting',
            format('"%s" is starting with the %s of %s Helprs who confirmed. You only pay for the Helprs who work it: the open spots'' share is refunded to you once the job is done.',
                   rec.title, v_hired, COALESCE(rec.helpers_needed, v_hired)),
            'job_updates',
            '/posts?job=' || rec.id::text
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'start_underfilled_crews', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
    END;
  END LOOP;
  RETURN started;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_underfilled_crews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_underfilled_crews() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('start-underfilled-crews', interval '20 minutes',
            'Q1460: every 5 minutes, books a funded crew whose hiring has closed with the members who confirmed, so it can start short-handed instead of being cancelled.',
            'exempt',
            'Most runs book nothing (no crew is at its cutoff): a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('start-underfilled-crews', '2-59/5 * * * *',
                          $c$SELECT public.cron_record_work('start-underfilled-crews', to_jsonb(public.start_underfilled_crews()));$c$);
  END IF;
END
$do$;
