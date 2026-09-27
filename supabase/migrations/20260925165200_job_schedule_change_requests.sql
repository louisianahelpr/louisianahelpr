-- A booked one-time job's date or start time changes only as a REQUEST the
-- other party accepts (owner decision Q407 (8), finalised 2026-09-25).
--
--   - Either side asks: the person who posted it, or the hired Helpr. Only the
--     OTHER side can accept or decline.
--   - Nothing changes until it is accepted. The direct client write of
--     date_needed / start_time on a booked job is already refused
--     (20260925160644, schedule_locked); respond_job_schedule_change is the
--     one writer, SECURITY DEFINER, and it passes that lock.
--   - Declined or unanswered: the original date and time stay, and the normal
--     cancellation rules and fees apply (no waiver for a declined request).
--   - A request expires at the job's ORIGINAL start: after it nothing can
--     accept it (respond marks it expired), and every reader treats a pending
--     row past expires_at as expired.
--   - Date and time only; pay and budget never change here.
--   - One pending request per job (a partial unique index). A new request
--     replaces the old one ('replaced') and the other party is told.
--   - The other party is told of each request and of each outcome.
--
-- Scope: a booked ONE-TIME job (no parent series, not a series parent, not a
-- crew job). A series' dates are its own flow (20260925160645).
--
-- enforce_helper_jobs_column_whitelist is restated from its newest definition
-- (20260925052841) with one carve-out, app.schedule_change_rpc, set only by
-- respond_job_schedule_change after its party check: without it a Helpr who
-- accepts the poster's request would be refused by their own whitelist.

CREATE TABLE IF NOT EXISTS public.job_schedule_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The other party when it was asked: the only person who can answer.
  responder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_date date NOT NULL,
  old_start_time time,
  new_date date NOT NULL,
  new_start_time time,
  status text NOT NULL DEFAULT 'pending',
  -- The job's ORIGINAL start (America/Chicago): unanswered by then, expired.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT job_schedule_change_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'replaced'))
);

CREATE UNIQUE INDEX IF NOT EXISTS job_schedule_change_one_pending
  ON public.job_schedule_change_requests (job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_schedule_change_responder
  ON public.job_schedule_change_requests (responder_id) WHERE status = 'pending';

ALTER TABLE public.job_schedule_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_schedule_change_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_schedule_change_requests TO authenticated;
GRANT ALL ON TABLE public.job_schedule_change_requests TO service_role;

DROP POLICY IF EXISTS "The two parties read a change request" ON public.job_schedule_change_requests;
CREATE POLICY "The two parties read a change request"
  ON public.job_schedule_change_requests FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()) OR responder_id = (SELECT auth.uid()));

-- ── Ask ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_job_schedule_change(p_job_id uuid, p_date date, p_start_time time)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_other uuid;
  v_starts_at timestamptz;
  v_new_at timestamptz;
  v_id uuid;
  v_replaced int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.parent_job_id, j.recurrence_days, j.is_group_job, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL OR COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'schedule_change_not_one_time';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'schedule_change_not_booked';
  END IF;

  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF now() >= v_starts_at THEN
    RAISE EXCEPTION 'schedule_change_too_late';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'schedule_change_invalid';
  END IF;
  v_new_at := (p_date + COALESCE(p_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_new_at <= now() THEN
    RAISE EXCEPTION 'schedule_change_in_past';
  END IF;
  IF p_date = v_job.date_needed AND p_start_time IS NOT DISTINCT FROM v_job.start_time THEN
    RAISE EXCEPTION 'schedule_change_same';
  END IF;

  v_other := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;

  UPDATE public.job_schedule_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  VALUES
    (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_other, v_job.id,
    'New date or time requested',
    format('%s asked to move "%s" to %s%s. Nothing changes unless you accept.%s',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(p_date, 'FMDy FMMon FMDD'),
           CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END,
           CASE WHEN v_replaced > 0 THEN ' This replaces their earlier request.' ELSE '' END),
    'job_updates',
    CASE WHEN v_other = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced);
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;

-- ── Answer ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_job_schedule_change(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Job first, then the request: the same order request_job_schedule_change
  -- takes (job FOR UPDATE, then the pending row).
  SELECT r.job_id INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id FOR UPDATE;

  -- Only the party the request is addressed to, and only while they are still
  -- that party on the job.
  IF v_uid IS DISTINCT FROM v_req.responder_id
     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;

  -- Expired (unanswered by the original start), or the job moved on since it
  -- was asked: nothing changes.
  IF now() >= v_req.expires_at
     OR v_job.status::text <> 'accepted'
     OR v_job.date_needed IS DISTINCT FROM v_req.old_date
     OR v_job.start_time IS DISTINCT FROM v_req.old_start_time THEN
    UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF p_accept THEN
    -- The new start must still be ahead.
    IF ((v_req.new_date + COALESCE(v_req.new_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now() THEN
      UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    PERFORM set_config('app.schedule_change_rpc', '1', true);
    UPDATE public.jobs
       SET date_needed = v_req.new_date,
           start_time = v_req.new_start_time,
           -- The day-of machinery runs fresh for the new day (as a reopened
           -- job does, helper_cancel_booking).
           dayof_confirm_reminder_sent_at = NULL,
           dayof_unanswered_poster_alert_sent_at = NULL,
           start_reminder_sent_at = NULL
     WHERE id = v_job.id;
    PERFORM set_config('app.schedule_change_rpc', '0', true);
    v_status := 'accepted';
  ELSE
    v_status := 'declined';
  END IF;

  UPDATE public.job_schedule_change_requests SET status = v_status, decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_req.requested_by, v_job.id,
    CASE WHEN v_status = 'accepted' THEN 'New date or time accepted' ELSE 'New date or time declined' END,
    CASE WHEN v_status = 'accepted'
         THEN format('"%s" is now on %s%s.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.new_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.new_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.new_start_time, 'FMHH12:MI AM') END)
         ELSE format('"%s" stays on %s%s. The usual cancellation rules apply if either of you cancels.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END)
    END,
    'job_updates',
    CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('status', v_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated, service_role;

-- ── Helper whitelist: admit the accepted change ─────────────────────────────
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
