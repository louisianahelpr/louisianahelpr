-- Q1733 (OWNER DECISION 2026-10-12, pop-up): when Louisiana Helpr (an admin,
-- through rpc_admin_end_recurring_series -> end_recurring_series_by_platform;
-- NOT the poster) ends a recurring series, a visit the poster already paid for that nobody is
-- booked on is refunded IN FULL, card fee included. A poster ending it
-- themselves keeps today's rule (Q808: the card fee is withheld).
--
-- How: public.series_platform_ends (server-only: RLS on, no policies, no
-- client grants) records that an admin ended a series. A chargeback end (the
-- poster's own bank dispute) is NOT recorded: the owner excluded the poster;
-- whether that and a ban of the Helpr count is an owner question. It is written by
-- end_recurring_series_by_platform (restated from 20261012194707 with that
-- INSERT and the poster's notice now saying "refunded in full").
-- charge-recurring-visits reads it before it withholds the card fee for an
-- ended series (both the stale-visit sweep and the mid-run refusal).
--
-- Not changed: a series ended by a permanent ban (end_series_for_banned_account)
-- keeps its current rule; the owner named the admin, service and platform
-- paths, and a ban removes the date holds (an unheld date withholds the fee).
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE. Grants as before
-- (service_role only on the function).
-- Proof: src/test/pglite/platformSeriesEndRefundsInFull.pglite.mjs (DB half);
-- src/test/edge/charge-recurring-visits.test.ts, the Q1733 cases (the refund half).

CREATE TABLE IF NOT EXISTS public.series_platform_ends (
  parent_job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('chargeback', 'admin')),
  reason        text,
  admin_id      uuid,
  ended_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.series_platform_ends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.series_platform_ends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.series_platform_ends TO service_role;

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

  -- Q1733 (owner, 2026-10-12): the PLATFORM ended it, so a paid visit nobody
  -- is booked on is refunded IN FULL, card fee included. charge-recurring-
  -- visits reads this server-only row; no client can write it.
  -- Only an ADMIN end: a chargeback end is the poster's own bank dispute
  -- (owner: "NOT the poster"), so it keeps Q808's rule (money review #4).
  IF p_kind = 'admin' THEN
    INSERT INTO public.series_platform_ends (parent_job_id, kind, reason, admin_id)
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
        -- charge-recurring-visits refunds a paid visit nobody is booked on IN
        -- FULL when an ADMIN ended the series (series_platform_ends; owner
        -- decision Q1733, 2026-10-12); a chargeback (the poster's own dispute)
        -- and a poster's own end keep Q808's rule (the card fee is withheld).
        WHEN 'chargeback' THEN format('Your recurring series "%s" has ended because a charge on it is being disputed with your bank. No new visits will be booked or charged.%s Any visit you already paid for that nobody is booked on is refunded, less the card processing fee.',
                                      COALESCE(v_job.title, 'your job'), v_still)
        ELSE format('Louisiana Helpr ended your recurring series "%s". No new visits will be booked or charged.%s Any visit you already paid for that nobody is booked on is refunded in full. Questions: admin@louisianahelpr.com.',
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
