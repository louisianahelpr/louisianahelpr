-- OWNER DECISION 2026-10-14: "if admin refunds we keep the fee also. we should
-- never absorb any fee." Every refund returns what was paid less the card
-- processing fee (only refunds caused by our own mistakes go back in full).
-- This supersedes Q1735 (2026-10-12), under which a series an ADMIN ended
-- refunded its paid, unbooked visits IN FULL: charge-recurring-visits now
-- withholds the card fee on those too, so the poster's notice written here
-- changes from "refunded in full" to "refunded, less the card processing
-- fee". Nothing else in the function changes (restated verbatim from
-- 20261012233226). Tax handling is unchanged.
--
-- Replay-safe: CREATE OR REPLACE; grants restated (service_role only).
-- Proof: src/test/pglite/platformSeriesEndKeepsCardFee.pglite.mjs (applied 3x);
-- src/test/seriesEndByPlatform.test.ts reads the newest definition.

CREATE OR REPLACE FUNCTION public.end_recurring_series_by_platform(
  p_job_id uuid,
  p_kind text,
  p_reason text,
  p_admin uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_last_created date;
  v_end date;
  v_booked int := 0;
  v_child record;
  v_still text;
  v_flag text := current_setting('app.series_end_rpc', true);
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('chargeback', 'admin') THEN
    RAISE EXCEPTION 'end_series_unknown_kind';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'end_series_needs_reason';
  END IF;

  -- Lock order: the parent first, then its visits (end_recurring_series's
  -- order). The parent is resolved and locked in ONE statement; the visit row
  -- is only read for its parent_job_id, which never changes (series_locked).
  SELECT j.id, j.title, j.customer_id, j.recurring_helper_id, j.helper_id, j.recurrence_days,
         j.parent_job_id, j.date_needed, j.series_ended_on, j.status::text AS status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = (SELECT COALESCE(c.parent_job_id, c.id) FROM public.jobs c WHERE c.id = p_job_id)
   FOR UPDATE OF j;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;

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

  v_end := GREATEST(v_job.date_needed, v_today, v_last_created);

  PERFORM set_config('app.series_end_rpc', '1', true);
  UPDATE public.jobs SET series_ended_on = v_end WHERE id = v_job.id;
  PERFORM set_config('app.series_end_rpc', COALESCE(v_flag, ''), true);

  -- The record that an ADMIN ended the series (kept as a record; since the
  -- owner decision of 2026-10-14 it no longer changes any refund: every
  -- refund keeps the card fee, whoever ended the series).
  IF p_kind = 'admin' THEN
    INSERT INTO public.series_platform_ends (parent_job_id, end_kind, reason, admin_id)
    VALUES (v_job.id, p_kind, btrim(p_reason), p_admin)
    ON CONFLICT (parent_job_id) DO NOTHING;
  END IF;

  v_still := CASE WHEN v_booked > 0
                  THEN format(' %s visit%s already booked still go%s ahead unless cancelled.',
                              v_booked, CASE WHEN v_booked = 1 THEN '' ELSE 's' END,
                              CASE WHEN v_booked = 1 THEN 'es' ELSE '' END)
                  ELSE '' END;

  -- Every Helpr on the series (the same set end_recurring_series tells).
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  SELECT u.helper_id, v_job.id,
         'Recurring series ended',
         -- Neutral for both kinds: the poster's bank dispute is private
         -- (money review of 60cd5ff79, #3); the Helpr whose payout is held
         -- already gets the hold notice.
         format('Louisiana Helpr ended the recurring series "%s". No new visits will be booked or charged.%s',
                COALESCE(v_job.title, 'A job'), v_still),
         'job_updates',
         '/jobs?job=' || v_job.id::text
    FROM (
      SELECT h.helper_id FROM public.series_visit_holds h
       WHERE h.parent_job_id = v_job.id AND h.visit_date >= v_today
      UNION
      SELECT v_job.recurring_helper_id WHERE v_job.recurring_helper_id = v_job.helper_id
    ) AS u
   WHERE u.helper_id IS NOT NULL;

  -- The poster (customer_id is NULL once the account is deleted).
  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_job.customer_id, v_job.id,
      'Recurring series ended',
      CASE p_kind
        -- Owner, 2026-10-14 ("we should never absorb any fee"): a paid visit
        -- nobody is booked on is refunded less the card processing fee,
        -- whoever ended the series (this replaces Q1735's "in full").
        WHEN 'chargeback' THEN format('Your recurring series "%s" has ended because a charge on it is being disputed with your bank. No new visits will be booked or charged.%s Any visit you already paid for that nobody is booked on is refunded, less the card processing fee.',
                                      COALESCE(v_job.title, 'your job'), v_still)
        ELSE format('Louisiana Helpr ended your recurring series "%s". No new visits will be booked or charged.%s Any visit you already paid for that nobody is booked on is refunded, less the card processing fee. Questions: admin@louisianahelpr.com.',
                    COALESCE(v_job.title, 'your job'), v_still)
      END,
      'job_updates',
      '/posts?job=' || v_job.id::text
    );
  END IF;

  IF p_admin IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (p_admin, 'end_recurring_series', 'job', v_job.id::text,
            jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason), 'ended_on', v_end,
                               'booked_visits_remaining', v_booked));
  END IF;

  RETURN jsonb_build_object(
    'action', 'ended',
    'kind', p_kind,
    'ended_on', v_end,
    'booked_visits_remaining', v_booked
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.end_recurring_series_by_platform(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_recurring_series_by_platform(uuid, text, text, uuid) TO service_role;
