-- Recurring series: an end, and a schedule that holds after hire.
--
-- Two defects, both measured on prod 2026-09-25 with a rolled-back probe as
-- poster-e2e on a hired seed series (Mon/Wed x 4 weeks):
--
-- 1. A series could not be stopped once its first visit was done.
--    poster_cancel_job refuses a `completed` job (and any job whose Helpr has
--    marked it done), charge-recurring-visits keeps `completed` parents in
--    scope on purpose (the parent IS visit one), and the completed card offers
--    no control. So after visit one the poster's saved card was charged every
--    visit for up to 52 weeks with no way to stop it, and the standing Helpr had
--    no way to leave. Probe: `cancel_completed_parent refused: not_cancellable`.
--
--    Fix: jobs.series_ended_on (server-owned) and end_recurring_series(), which
--    the poster OR the standing Helpr may call. It sets the last date the series
--    runs to the latest of: visit one, today in America/Chicago, and the last
--    visit already created (created visits are funded and booked; each keeps its
--    own cancel path). The cron funds no visit after that date, and a BEFORE
--    INSERT trigger refuses a visit dated after it, so a cron run that read the
--    series before it ended cannot book past the end (its insert fails and the
--    cron's insert-failure branch refunds the charge). Ending carries no fee and
--    no strike: every visit it removes is unfunded and was never booked.
--
-- 2. The visit schedule was client-writable after hire. The Q357 lock covered
--    recurrence_days only; the probe changed recurrence_weeks 4 -> 52 and moved
--    date_needed/start_time on the hired parent (rows=1 each). The cron then
--    books the Helpr onto every one of those visits (status accepted,
--    helper_confirmed_at now) and charges the poster for them. Now, once a Helpr
--    is on a series parent, recurrence_weeks, date_needed, start_time and
--    recurrence_end_date are refused for client roles, and series_ended_on is
--    never client-writable.
--
-- enforce_helper_jobs_column_whitelist is restated from its newest definition
-- (20260915101102, identical to live pg_get_functiondef 2026-09-25) with one
-- carve-out: series_ended_on under app.series_end_rpc, which only
-- end_recurring_series sets, after it has checked the caller is a party.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS series_ended_on date;

COMMENT ON COLUMN public.jobs.series_ended_on IS
  'Last date a recurring series runs, set only by end_recurring_series(). NULL = the series runs its full recurrence_weeks.';

-- jobs uses COLUMN-level SELECT grants, so the column is unreadable by clients
-- until granted. SELECT only: end_recurring_series is its one writer.
GRANT SELECT (series_ended_on) ON public.jobs TO authenticated;

-- ── Client lock on the series columns ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_series_columns_client_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.series_ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id THEN
    RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days AND OLD.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Cancel the series and post a new one with the new days.';
  END IF;
  IF NEW.series_ended_on IS DISTINCT FROM OLD.series_ended_on THEN
    RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- A hired series parent: every column the visit dates are computed from is
  -- the schedule the Helpr agreed to.
  IF OLD.recurrence_days IS NOT NULL AND OLD.parent_job_id IS NULL AND OLD.helper_id IS NOT NULL
     AND (NEW.recurrence_weeks IS DISTINCT FROM OLD.recurrence_weeks
          OR NEW.date_needed IS DISTINCT FROM OLD.date_needed
          OR NEW.start_time IS DISTINCT FROM OLD.start_time
          OR NEW.recurrence_end_date IS DISTINCT FROM OLD.recurrence_end_date) THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'End the series and post a new one with the new schedule.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_columns_client_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_series_columns_client_lock ON public.jobs;
CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();

-- ── No visit after the end ────────────────────────────────────────────────
-- FOR SHARE on the parent: an end_recurring_series still in flight holds FOR
-- UPDATE on it, so this waits for that commit and then reads the new end date.
-- In the other order the RPC waits for this insert and counts the new visit
-- when it picks the end date.
CREATE OR REPLACE FUNCTION public.enforce_series_visit_within_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ended date;
BEGIN
  IF NEW.parent_job_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT j.series_ended_on INTO v_ended
    FROM public.jobs j
   WHERE j.id = NEW.parent_job_id
   FOR SHARE;
  IF v_ended IS NOT NULL AND NEW.date_needed > v_ended THEN
    RAISE EXCEPTION 'series_ended: the series ended on %; no visit on %', v_ended, NEW.date_needed
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_visit_within_end() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_series_visit_within_end ON public.jobs;
CREATE TRIGGER trg_series_visit_within_end
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_visit_within_end();

-- ── Helper whitelist: admit series_ended_on from end_recurring_series only ──
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

-- ── end_recurring_series ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.end_recurring_series(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_last_created date;
  v_end date;
  v_booked int;
  v_child record;
  v_other uuid;
  v_by_poster boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.recurring_helper_id, j.helper_id, j.recurrence_days,
         j.parent_job_id, j.date_needed, j.series_ended_on, j.status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  -- The two parties of the series, and nobody else. The Helpr side is the
  -- standing Helpr who is still the one hired on the parent: a
  -- recurring_helper_id left behind after helper_id moved on is not a party.
  IF v_uid IS DISTINCT FROM v_job.customer_id
     AND (v_uid IS DISTINCT FROM v_job.recurring_helper_id OR v_uid IS DISTINCT FROM v_job.helper_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;

  -- Visits already created are funded and booked; they stay, each with its own
  -- cancel path. FOR SHARE: a visit cancelled or created mid-call cannot move
  -- the count or the end date under us. Lock order is parent (above) then
  -- visits. The visit insert path takes the parent first too
  -- (trg_series_visit_within_end, and the parent_job_id foreign key), and the
  -- cancel RPCs lock only the visit they cancel.
  v_booked := 0;
  FOR v_child IN
    SELECT c.date_needed, c.status
      FROM public.jobs c
     WHERE c.parent_job_id = v_job.id
       FOR SHARE
  LOOP
    IF v_child.status IN ('accepted', 'in_progress') AND v_child.date_needed >= v_today THEN
      v_booked := v_booked + 1;
    END IF;
    IF v_child.status <> 'cancelled' THEN
      v_last_created := GREATEST(v_last_created, v_child.date_needed);
    END IF;
  END LOOP;

  IF v_job.status = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'already_ended',
      'ended_on', COALESCE(v_job.series_ended_on, v_job.date_needed),
      'booked_visits_remaining', v_booked
    );
  END IF;

  -- GREATEST ignores NULLs, so a series with no created visit ends on the
  -- later of visit one and today.
  v_end := GREATEST(v_job.date_needed, v_today, v_last_created);

  PERFORM set_config('app.series_end_rpc', '1', true);
  UPDATE public.jobs SET series_ended_on = v_end WHERE id = v_job.id;
  PERFORM set_config('app.series_end_rpc', '0', true);

  v_by_poster := v_uid = v_job.customer_id;
  v_other := CASE WHEN v_by_poster THEN v_job.recurring_helper_id ELSE v_job.customer_id END;

  IF v_other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_other,
      v_job.id,
      'Recurring series ended',
      format('%s ended the recurring series "%s". No visits after %s will be booked or charged.%s',
             CASE WHEN v_by_poster THEN 'The person who posted it' ELSE 'Your Helpr' END,
             COALESCE(v_job.title, 'A job'),
             to_char(v_end, 'FMMon FMDD'),
             CASE WHEN v_booked > 0
                  THEN format(' %s visit%s already booked still go%s ahead unless cancelled.',
                              v_booked, CASE WHEN v_booked = 1 THEN '' ELSE 's' END,
                              CASE WHEN v_booked = 1 THEN 'es' ELSE '' END)
                  ELSE '' END),
      'job_updates',
      CASE WHEN v_by_poster THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'ended',
    'ended_on', v_end,
    'booked_visits_remaining', v_booked
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.end_recurring_series(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_recurring_series(uuid) TO authenticated, service_role;

-- Every jobs ADD COLUMN ends with the grant sync (offeredHelperPrivacy.test.ts).
SELECT public.sync_jobs_select_grants();
