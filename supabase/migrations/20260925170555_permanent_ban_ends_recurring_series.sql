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
  v_series_flag text := current_setting('app.series_end_rpc', true);
  v_cancel_flag text := current_setting('app.sanctioned_cancel', true);
BEGIN
  IF p_user IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_p IN
    SELECT j.id, j.title, j.customer_id, j.recurring_helper_id, j.helper_id
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
    PERFORM set_config('app.series_end_rpc', '1', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs SET series_ended_on = v_today WHERE id = v_p.id;

    -- Every visit after today that has not started, visit one included.
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
         AND c.date_needed > v_today
         AND c.status::text IN ('open', 'accepted')
         AND c.helper_completed_at IS NULL
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
                       THEN 'Upcoming visits are cancelled and you won''t be charged for them.'
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

    DELETE FROM public.series_visit_holds h WHERE h.parent_job_id = v_p.id AND h.visit_date > v_today;
    DELETE FROM public.series_date_offers o WHERE o.parent_job_id = v_p.id;

    PERFORM set_config('app.series_end_rpc', COALESCE(v_series_flag, '0'), true);
    PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
    v_ended := v_ended + 1;
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
