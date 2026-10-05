-- Q1202 (docs/OPEN.md): the Helpr on an unaccepted offer could push its
-- deadline out and hold the job.
--
-- enforce_helper_jobs_column_whitelist lists response_deadline among the
-- columns the assigned Helpr may write, so a Helpr on an unconfirmed offer
-- could PATCH it years out and expire_unanswered_offers never fires: the
-- poster waits on a Helpr who never accepts.
--
-- Writers, read live 2026-10-04 by body (pg_proc prosrc ~ 'response_deadline
-- (:=|=)'): accept_application sets it to p_deadline (the poster, who this
-- trigger lets through); every other writer sets it NULL
-- (complete_job_accept, complete_direct_offer_accept, decline_job_offer,
-- helper_cancel_booking, helper_abort_job, expire_unanswered_offers,
-- report_helper_no_show, the ban settlements). The client writes it nowhere.
-- So the Helpr branch now admits only a clear, the way it already treats
-- helper_id.
--
-- Restated from its newest definition, 20260927220819 (md5(prosrc) live
-- 75b799311e336bcc122f946e7edb2b7e = that file), plus the one check.
-- Replay-safe: CREATE OR REPLACE; grants restated as before.

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

  -- Q1202: the offer's response window is the poster's (accept_application
  -- stamps it). The Helpr may only CLEAR it (the accept and the decline do,
  -- through definer RPCs that run as this Helpr), never move it: a Helpr who
  -- pushed it years out could hold an unconfirmed offer forever, because
  -- expire_unanswered_offers would never fire.
  IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline AND NEW.response_deadline IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.response_deadline, not move it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_helper_jobs_column_whitelist() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_helper_jobs_column_whitelist() TO service_role;
