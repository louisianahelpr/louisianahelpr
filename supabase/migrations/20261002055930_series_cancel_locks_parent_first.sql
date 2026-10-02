-- Q737: helper_cancel_booking takes the series parent's lock before the
-- visit's, so a Helpr cancelling a series visit cannot deadlock against
-- another Helpr claiming that date (claim locks parent, then visit).
-- Proof: scripts/probes/series-claim-race.embedded-pg.mjs (real Postgres,
-- two connections). Body is 20260927220819's verbatim plus the lock.

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
  v_slot_id uuid;
  v_slot_completed_at timestamptz;
  v_remaining int;
  v_released date[];
BEGIN
  -- Q737: a series visit is cancelled under its series' lock, taken BEFORE the
  -- visit's, the order claim_series_dates / offer_series_dates /
  -- give_up_series_dates / end_recurring_series all use (parent, then visit).
  -- Visit-first deadlocked against a claim of the same date: the claim held
  -- the parent and waited on the visit while series_release_dates' writes
  -- (the release row, the series notifications) needed a key-share lock on the
  -- parent. parent_job_id never changes once a visit exists; a one-off job
  -- has none, so this locks nothing for it.
  PERFORM 1 FROM public.jobs pj
   WHERE pj.id = (SELECT c.parent_job_id FROM public.jobs c WHERE c.id = p_job_id)
   FOR UPDATE;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at,
         j.is_group_job, j.helpers_needed,
         j.parent_job_id, j.recurrence_days
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF v_job.is_group_job IS TRUE THEN
    SELECT g.id, g.helper_completed_at
      INTO v_slot_id, v_slot_completed_at
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id AND g.helper_id = auth.uid()
     FOR UPDATE;
  END IF;

  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');

  -- ── THE CREW BRANCH (20260925140148) ─────────────────────────────────────
  -- Membership is the caller's roster slot, not jobs.helper_id (the lead). A
  -- group job's lead with no slot (hired before the roster existed) falls
  -- through to the single-helper path below, which is the job they hold.
  IF v_job.is_group_job IS TRUE
     AND (v_slot_id IS NOT NULL OR v_job.helper_id IS DISTINCT FROM auth.uid()) THEN
    IF v_slot_id IS NULL THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    -- 'open' included: a crew that is still staffing already holds the
    -- members hired so far, and each of them has committed.
    IF v_job.status::text NOT IN ('open', 'accepted') THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'Only a booked job that has not started can be cancelled this way.';
    END IF;
    -- Leaving would drop a part this Helpr already marked done out of the
    -- roll-up that pays the crew.
    IF v_slot_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'You already marked your part done, so you can''t leave this job. Message the person who posted it or open a dispute.';
    END IF;

    IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
      RAISE EXCEPTION 'job_already_started'
        USING HINT = 'The scheduled start has passed — contact the person who posted it or support.';
    END IF;

    -- Owner decision Q407 (11): a strike only within 24 hours of the start.
    IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN
      v_result := public.apply_job_denial_consequence(
        auth.uid(), v_job.id,
        'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
    ELSE
      v_result := jsonb_build_object('action', 'none', 'reason', 'more_than_24h_before_start');
    END IF;

    -- trg_sync_job_after_roster_departure rejects this Helpr's application
    -- and, when they were the lead, moves or clears the lead together with
    -- its confirmation stamps, response deadline and reminder sent-ats.
    DELETE FROM public.group_job_helpers WHERE id = v_slot_id;

    SELECT count(*) INTO v_remaining
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id;

    IF v_job.status::text = 'accepted' AND v_remaining < COALESCE(v_job.helpers_needed, 1) THEN
      UPDATE public.jobs
         SET status = 'open'
       WHERE id = v_job.id;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'A Helpr left your crew',
      'One of your Helprs can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — their spot is open to everyone again.',
      'warning',
      '/posts?job=' || v_job.id::text,
      v_job.id
    );

    RETURN v_result;
  END IF;

  -- ── THE SINGLE-HELPER PATH ───────────────────────────────────────────────
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- Reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the person who posted it or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the person who posted it or support.';
  END IF;

  -- Owner decisions Q407 (6) and (11): a strike only within 24 hours of the
  -- start, for a series visit and a one-time job alike.
  IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN
    v_result := public.apply_job_denial_consequence(
      auth.uid(), v_job.id,
      'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
  ELSE
    v_result := jsonb_build_object('action', 'none', 'reason', 'more_than_24h_before_start');
  END IF;

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  -- Q402: the reminder sent-ats are not on the Helpr column whitelist; this
  -- flag lets this one UPDATE clear them (enforce_helper_jobs_column_whitelist).
  PERFORM set_config('app.helper_cancel_rpc', '1', true);
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
  PERFORM set_config('app.helper_cancel_rpc', '0', true);

  IF v_job.parent_job_id IS NOT NULL THEN
    -- The date goes back to the series: the poster and the other Helprs on it
    -- are told by series_release_dates.
    v_released := public.series_release_dates(v_job.parent_job_id, auth.uid(), ARRAY[v_job.date_needed], 'visit_cancelled',
                                              v_job.title, v_job.customer_id);
    -- Review LOW-1: nothing released (this Helpr held no hold on the date,
    -- e.g. legacy data) must still reach the poster, who can offer it.
    IF COALESCE(cardinality(v_released), 0) = 0 AND v_job.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_job.customer_id,
        'Your Helpr cancelled',
        format('Your Helpr can''t make "%s" on %s. The visit stays paid for: offer the date to someone new from the series card. If nobody takes it, you''re refunded less the card processing fee.',
               COALESCE(v_job.title, 'your series'), to_char(v_job.date_needed, 'FMDy FMMon FMDD')),
        'warning',
        '/posts?job=' || v_job.parent_job_id::text,
        v_job.parent_job_id
      );
    END IF;
  ELSE
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Your Helpr cancelled',
      'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
      'warning',
      '/posts?job=' || v_job.id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;
