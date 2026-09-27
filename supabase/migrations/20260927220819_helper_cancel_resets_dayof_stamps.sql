-- Q402: a Helpr could not cancel a single-helper booking once a day-of
-- reminder had gone out. helper_cancel_booking (SECURITY DEFINER, but
-- auth.uid() is still the Helpr, so not a server context) clears
-- dayof_confirm_reminder_sent_at, dayof_unanswered_poster_alert_sent_at and
-- start_reminder_sent_at in its reopen UPDATE, and
-- enforce_helper_jobs_column_whitelist refused them: "Helpers may not modify
-- jobs.dayof_confirm_reminder_sent_at".
--
-- Fix, same pattern as app.series_end_rpc / app.schedule_change_rpc: the RPC
-- sets a transaction-local app.helper_cancel_rpc around that one UPDATE, and
-- the whitelist lets those three columns be set to NULL (never stamped) under
-- it. The flag is transaction-local, each PostgREST request is its own
-- transaction, and the RPC sets it back to '0' right after the UPDATE, so a
-- direct PATCH never runs under it.
--
-- Both bodies restate prod's text verbatim (md5 of pg_get_functiondef matched
-- the migrations tree, 2026-09-27: whitelist 72106e2e..., cancel f9c54db8...)
-- plus only the lines marked Q402. CREATE OR REPLACE keeps each ACL; the
-- grants are restated to match prod's proacl.
-- Proof: node src/test/pglite/groupRosterDeparture.pglite.mjs --tree (L1).

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (a server context; poster; admin) passes through — their
  -- access is governed by RLS as before. A NULL uid alone is not a server
  -- context: anon has one too (20260915051905).
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      -- BOTH arrival stamps are deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side, refuses (writing nothing) when the helper is not
      -- within 500ft, and sets this transaction-local flag. A direct PATCH
      -- from the client still hits the RAISE below. helper_arrived_at joined
      -- the verified stamp here in 20260915044137 (VN-33): while it was on the
      -- list, a helper 2000 miles away could mark themselves arrived with a
      -- plain PATCH and no location at all.
      IF changed_col IN ('helper_arrival_verified_at', 'helper_arrived_at',
                         'helper_arrival_near_miss_at', 'helper_arrival_near_miss_ft')
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The series end date, same pattern. Its only writer is
      -- public.end_recurring_series(), which sets this flag transaction-locally
      -- only after establishing that auth.uid() is the poster or the standing
      -- Helpr of the series. A direct PATCH is also refused by
      -- enforce_series_columns_client_lock.
      IF changed_col = 'series_ended_on'
         AND current_setting('app.series_end_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A permanent ban handing back or cancelling the banned Helpr's own
      -- visits (end_series_for_banned_account, 20260927012808) may run inside
      -- that Helpr's own request (the consequence ladder). Its only writes of
      -- these columns are the server-owned ban marker and the day-of stamps a
      -- vacated visit resets; it sets app.series_end_rpc around them.
      IF changed_col IN ('series_ban_cancelled_at',
                         'dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.series_end_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A new date / start time the OTHER party asked for and this Helpr
      -- accepted (Q407 (8)). Its only writer is
      -- public.respond_job_schedule_change(), which sets this flag
      -- transaction-locally only after checking the caller is the party the
      -- request is addressed to; the day-of stamps it resets go with it.
      IF changed_col IN ('date_needed', 'start_time', 'expires_at',
                         'dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.schedule_change_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A Helpr cancelling their own booking (Q402). Its only writer is
      -- public.helper_cancel_booking(), which sets this flag transaction-locally
      -- around its one reopen UPDATE, after checking auth.uid() holds the job,
      -- and resets the reminder sent-ats so the next Helpr's day-of machinery
      -- runs fresh. The flag only lets them be CLEARED, never stamped.
      IF changed_col IN ('dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.helper_cancel_rpc', true) = '1'
         AND to_jsonb(NEW) -> changed_col = 'null'::jsonb THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

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
REVOKE ALL ON FUNCTION public.enforce_helper_jobs_column_whitelist() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_helper_jobs_column_whitelist() TO service_role;
