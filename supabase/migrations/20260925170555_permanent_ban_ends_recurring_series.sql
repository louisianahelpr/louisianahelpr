-- A permanent ban ends every recurring series the account posts or works on
-- (owner decision Q407 (9), 2026-09-25; money audit follow-up).
--
-- When profiles.ban_status becomes 'banned' or 'permanently_banned', for each
-- running series (a parent with recurrence_days, not cancelled, not ended)
-- the account posted, is the standing Helpr on, or holds a date on from today:
--   - series_ended_on := today (America/Chicago): the cron funds no new visit
--     and trg_series_visit_within_end refuses one (20260925052841);
--   - every visit dated after today that has not started (open or accepted,
--     not marked done), visit one included, is cancelled with
--     cancellation_reason = 'series_ended_account_banned', no late flag and no
--     fee, and the SERVER-OWNED marker jobs.series_ban_cancelled_at.
--     void-cancelled-payments refunds each IN FULL, the service fee included
--     (_shared/seriesRefund.ts), reading the MARKER, never the reason text
--     (money review 2026-09-25 HIGH-1: poster_cancel_job copies the caller's
--     own p_reason, so the reason is client-controlled);
--   - the dates held after today and the open offers are removed;
--   - the other people on the series are told (the poster, every Helpr with a
--     date on it, the standing Helpr), never the banned account, and never
--     told why beyond "ended by Louisiana Helpr".
--
-- A TEMPORARY ban (temp_banned) does NOT end a series: charge-recurring-visits
-- skips the series (poster banned) or the date (holder banned) while it lasts
-- (20260925052841 review fix), and the series resumes when it lifts. That split
-- (permanent ends, temporary pauses) is the lead's default; docs/OPEN.md asks
-- the owner to confirm it.
--
-- Fires on every writer of ban_status (admin-user-actions set_ban_status and
-- confirm_message_ban, the consequence ladder, a manual SQL fix), so no ban
-- path can skip it. SECURITY DEFINER; the sanctioned-cancel and series-end
-- flags let its writes through the client locks (it runs inside whoever set
-- the ban, which may be the banned user's own request when the ladder bans).

-- ── The server-owned marker (money review HIGH-1) ─────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS series_ban_cancelled_at timestamptz;
COMMENT ON COLUMN public.jobs.series_ban_cancelled_at IS
  'Set only by end_series_for_banned_account (20260925170555) on a series visit a permanent ban cancelled; void-cancelled-payments refunds such a visit in full. No client role writes it (trg_series_ban_marker_server_owned).';

-- No client writes the marker, and no client writes the reason the ban path
-- uses (it is reserved): a direct PATCH, poster_cancel_job's p_reason and any
-- other cancel RPC's reason all pass through this trigger. The ban path sets
-- app.series_end_rpc; a server context (service_role) is trusted.
CREATE OR REPLACE FUNCTION public.enforce_series_ban_marker_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context()
     OR current_setting('app.series_end_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.series_ban_cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.series_ban_cancelled_at is set only by the ban path'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.cancellation_reason = 'series_ended_account_banned' THEN
      RAISE EXCEPTION 'reserved_cancellation_reason'
        USING ERRCODE = '42501', HINT = 'That reason is reserved.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.series_ban_cancelled_at IS DISTINCT FROM OLD.series_ban_cancelled_at THEN
    RAISE EXCEPTION 'series_locked: jobs.series_ban_cancelled_at is set only by the ban path (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.cancellation_reason = 'series_ended_account_banned'
     AND NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
    RAISE EXCEPTION 'reserved_cancellation_reason'
      USING ERRCODE = '42501', HINT = 'That reason is reserved.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_ban_marker_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_series_ban_marker_server_owned ON public.jobs;
CREATE TRIGGER trg_series_ban_marker_server_owned
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_ban_marker_server_owned();

-- ── The helper column whitelist: the ban path's own writes ────────────────
-- Restated from 20260925165200 (newest) with ONE carve-out: under
-- app.series_end_rpc the ban path may write the marker and reset the day-of
-- stamps of a visit it vacates, even when auth.uid() is the banned Helpr.
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
      -- visits (end_series_for_banned_account, 20260925170555) may run inside
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

CREATE OR REPLACE FUNCTION public.end_series_for_banned_account(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_p record;
  v_ended integer := 0;
  v_cancelled integer;
  v_back date[];
  v_list text;
  -- Restored after each series: the ban may fire inside an RPC that set
  -- them itself (the ladder inside end_recurring_series, a cancel RPC).
  v_series_flag text := current_setting('app.series_end_rpc', true);
  v_cancel_flag text := current_setting('app.sanctioned_cancel', true);
BEGIN
  IF p_user IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_p IN
    SELECT j.id, j.title, j.customer_id, j.recurring_helper_id, j.helper_id, j.series_split_ok,
           j.status::text AS status, j.date_needed, j.start_time, j.helper_completed_at, j.is_seed
      FROM public.jobs j
     WHERE j.parent_job_id IS NULL
       AND j.recurrence_days IS NOT NULL
       AND j.series_ended_on IS NULL
       AND j.status::text <> 'cancelled'
       AND (j.customer_id = p_user
            OR (j.recurring_helper_id = p_user AND j.helper_id = p_user)
            OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                        WHERE h.parent_job_id = j.id AND h.helper_id = p_user AND h.visit_date >= v_today))
     ORDER BY j.id
       FOR UPDATE
  LOOP
    -- One series at a time, in its own subtransaction: a series this cannot
    -- end must never undo the ban (it may be running inside the banned
    -- person's own request, e.g. the consequence ladder inside
    -- helper_cancel_booking). The cron skips a banned party either way
    -- (charge-recurring-visits bannedAmong), and ops is told below.
    BEGIN
      -- Flags are transaction-local; a failure rolls them back with the
      -- subtransaction, and they go back to the caller's values after each
      -- series.
      PERFORM set_config('app.series_end_rpc', '1', true);
      PERFORM set_config('app.sanctioned_cancel', 'on', true);

      IF v_p.customer_id IS DISTINCT FROM p_user AND v_p.series_split_ok THEN
        -- ── Owner decision Q407 (10): a SPLIT series keeps going. Only the
        -- banned Helpr's dates go back to the poster to offer again; the
        -- other Helprs keep theirs. Not given-up dates: no release rows, so
        -- the others do not pick them up (Q407 (15)); the poster offers them.
        -- A handed-back date still unfilled when it arrives is not charged
        -- (an uncreated date) or is refunded less Stripe's fee (a vacated
        -- funded visit; _shared/seriesRefund.ts, Q407 (12)).

        -- 1. Their booked visits that have not started are vacated (still
        --    funded; the next holder takes the row over, claim_series_dates).
        UPDATE public.jobs c
           SET status = 'open',
               helper_id = NULL,
               response_deadline = NULL,
               helper_confirmed_at = NULL,
               helper_dayof_confirmed_at = NULL,
               dayof_confirm_reminder_sent_at = NULL,
               dayof_unanswered_poster_alert_sent_at = NULL,
               start_reminder_sent_at = NULL
         WHERE c.parent_job_id = v_p.id
           AND c.helper_id = p_user
           AND c.status::text = 'accepted'
           AND c.helper_completed_at IS NULL
           AND ((c.date_needed + COALESCE(c.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now();
        UPDATE public.applications a
           SET status = 'rejected'
         WHERE a.helper_id = p_user AND a.status = 'accepted'
           AND a.job_id IN (SELECT c.id FROM public.jobs c
                             WHERE c.parent_job_id = v_p.id AND c.helper_id IS NULL AND c.status::text = 'open'
                             FOR SHARE);

        -- 2. Their holds from today on, except a date whose visit they still
        --    hold (started or done: not ours to take back).
        WITH gone AS (
          DELETE FROM public.series_visit_holds h
           WHERE h.parent_job_id = v_p.id
             AND h.helper_id = p_user
             AND h.visit_date >= v_today
             AND NOT EXISTS (SELECT 1 FROM public.jobs c
                              WHERE c.parent_job_id = v_p.id AND c.date_needed = h.visit_date
                                AND c.helper_id = p_user
                              FOR SHARE)
          RETURNING h.visit_date
        )
        SELECT COALESCE(array_agg(visit_date ORDER BY visit_date), ARRAY[]::date[]) INTO v_back FROM gone;
        DELETE FROM public.series_date_offers o WHERE o.parent_job_id = v_p.id AND o.helper_id = p_user;

        -- 3. Visit one (the parent) if it is theirs and has not started:
        --    reopened like any vacated visit. Their holds are already gone,
        --    so trg_series_holds_on_hire hands nothing back as "given up".
        IF v_p.helper_id = p_user AND v_p.status = 'accepted' AND v_p.helper_completed_at IS NULL
           AND ((v_p.date_needed + COALESCE(v_p.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now() THEN
          UPDATE public.jobs
             SET status = 'open',
                 helper_id = NULL,
                 response_deadline = NULL,
                 helper_confirmed_at = NULL,
                 helper_dayof_confirmed_at = NULL,
                 dayof_confirm_reminder_sent_at = NULL,
                 dayof_unanswered_poster_alert_sent_at = NULL,
                 start_reminder_sent_at = NULL
           WHERE id = v_p.id;
          UPDATE public.applications SET status = 'rejected'
           WHERE job_id = v_p.id AND helper_id = p_user AND status = 'accepted';
          v_back := v_p.date_needed || v_back;
        END IF;

        IF cardinality(v_back) > 0 AND v_p.customer_id IS NOT NULL THEN
          SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_back) AS d;
          INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
          VALUES (
            v_p.customer_id, v_p.id,
            CASE WHEN cardinality(v_back) = 1 THEN 'A visit date is open again' ELSE 'Visit dates are open again' END,
            format('A Helpr on "%s" is no longer available for %s. You can offer %s to someone new. A date nobody takes isn''t charged, or is refunded less the card processing fee if you already paid for it.',
                   COALESCE(v_p.title, 'your series'), v_list,
                   CASE WHEN cardinality(v_back) = 1 THEN 'it' ELSE 'them' END),
            'job_updates', '/posts?job=' || v_p.id::text);
        END IF;
      ELSE
        -- ── The poster is banned, or a one-person series loses its Helpr:
        -- the series ends (owner decision Q407 (9)).
        UPDATE public.jobs SET series_ended_on = v_today WHERE id = v_p.id;

        -- Every visit whose start is still ahead (review LOW-3: today's
        -- later visit included), visit one included.
        WITH gone AS (
          UPDATE public.jobs c
             SET status = 'cancelled',
                 cancelled_at = now(),
                 cancellation_reason = 'series_ended_account_banned',
                 series_ban_cancelled_at = now(),
                 late_cancellation = false,
                 cancellation_fee = 0,
                 cancellation_fee_status = NULL
           WHERE (c.parent_job_id = v_p.id OR c.id = v_p.id)
             AND c.status::text IN ('open', 'accepted')
             AND c.helper_completed_at IS NULL
             AND ((c.date_needed + COALESCE(c.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now()
          RETURNING c.id
        )
        SELECT count(*) INTO v_cancelled FROM gone;

        -- Tell everyone else on the series (before their holds go).
        INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
        SELECT DISTINCT u.uid, v_p.id,
               'Recurring series ended',
               format('"%s" was ended by Louisiana Helpr. %s',
                      COALESCE(v_p.title, 'A recurring series'),
                      CASE WHEN u.uid = v_p.customer_id
                           THEN 'Upcoming visits are cancelled. Any you already paid for are refunded, less the card processing fee.'
                           ELSE 'Upcoming visits are cancelled.' END),
               'job_updates',
               CASE WHEN u.uid = v_p.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_p.id::text
          FROM (
            SELECT v_p.customer_id AS uid
            UNION SELECT v_p.recurring_helper_id WHERE v_p.recurring_helper_id = v_p.helper_id
            UNION SELECT h.helper_id FROM public.series_visit_holds h
                   WHERE h.parent_job_id = v_p.id AND h.visit_date >= v_today
          ) AS u
         WHERE u.uid IS NOT NULL AND u.uid <> p_user;

        -- Holds from today on, except a date whose visit is still live
        -- (started): the cron will not fund anything on an ended series.
        DELETE FROM public.series_visit_holds h
         WHERE h.parent_job_id = v_p.id AND h.visit_date >= v_today
           AND NOT EXISTS (SELECT 1 FROM public.jobs c
                            WHERE c.parent_job_id = v_p.id AND c.date_needed = h.visit_date
                              AND c.status::text <> 'cancelled'
                            FOR SHARE);
        DELETE FROM public.series_date_offers o WHERE o.parent_job_id = v_p.id;
        v_ended := v_ended + 1;
      END IF;

      PERFORM set_config('app.series_end_rpc', COALESCE(v_series_flag, '0'), true);
      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'end_series_for_banned_account: series % for % not handled: %', v_p.id, p_user, SQLERRM;
      -- A seed (E2E) series is logged at 'error' and tagged, like every
      -- detector's seed rows (detect_stuck_payments), never paging as fatal.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (CASE WHEN COALESCE(v_p.is_seed, false) THEN 'error' ELSE 'fatal' END,
              format('A permanent ban could not end or hand back recurring series %s (%s). The ban stands and charge-recurring-visits skips the banned party, but the series needs a person: end it or hand the dates back by hand.',
                     v_p.id, SQLERRM),
              jsonb_build_object('source', 'end_series_for_banned_account', 'area', 'recurring-series',
                                 'seed', COALESCE(v_p.is_seed, false)),
              jsonb_build_object('parent_job_id', v_p.id, 'user_id', p_user, 'sqlstate', SQLSTATE));
    END;
  END LOOP;

  RETURN v_ended;
END;
$fn$;

REVOKE ALL ON FUNCTION public.end_series_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_series_for_banned_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.end_series_on_permanent_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.end_series_for_banned_account(NEW.user_id);
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.end_series_on_permanent_ban() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'profiles absent: skipped';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS trg_series_end_on_permanent_ban ON public.profiles;
  CREATE TRIGGER trg_series_end_on_permanent_ban
    AFTER UPDATE OF ban_status ON public.profiles
    FOR EACH ROW
    WHEN (NEW.ban_status IN ('banned', 'permanently_banned')
          AND OLD.ban_status IS DISTINCT FROM NEW.ban_status)
    EXECUTE FUNCTION public.end_series_on_permanent_ban();
END
$trg$;

-- The marker column is readable like every other non-private jobs column
-- (authenticated holds column-level SELECT grants on jobs).
SELECT public.sync_jobs_select_grants();
