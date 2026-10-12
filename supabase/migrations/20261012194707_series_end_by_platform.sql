-- Q417 (c) and (d) (follow-ups from the Q407 build, 2026-09-25).
--
-- (c) The only ways to end a recurring series were end_recurring_series
--     (needs auth.uid() to be the poster or the standing Helpr) and
--     end_series_for_banned_account (a permanent ban). Nobody else, not an
--     admin and not the platform, could end one.
-- (d) A chargeback on a series charge only made charge-recurring-visits SKIP
--     the series on each run (money audit 2026-09-25, MEDIUM-7): the series
--     stayed "live" on both parties' screens and nobody was told why no more
--     visits came.
--
-- Built here:
--   public.end_recurring_series_by_platform(job, kind, reason, admin)
--     service_role only. Ends the series a job belongs to (the job itself or
--     its parent) exactly as the poster's end does (series_ended_on = the
--     later of visit one, today and the last created visit; visits already
--     created stay booked, each with its own cancel path), and tells BOTH
--     sides: every Helpr on the series and the poster. kind is 'chargeback'
--     (the stripe-webhook chargeback handler) or 'admin'. Idempotent: a series
--     already ended or cancelled answers already_ended and tells nobody again.
--   public.rpc_admin_end_recurring_series(job, reason)
--     an admin who is not a party, with a reason of 10+ characters that goes
--     in admin_audit_log; calls the function above.
--
-- Not built here (see docs/OPEN.md Q417): the admin UI button, (b) and (e).
-- Replay-safe: CREATE OR REPLACE only. Grants: REVOKE FROM PUBLIC, anon,
-- authenticated on the platform function (service_role only); the admin RPC
-- is EXECUTE for authenticated + service_role and checks has_role inside.
-- Proof: src/test/pglite/seriesEndByPlatform.pglite.mjs. Guard:
-- src/test/seriesEndByPlatform.test.ts.

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
        -- charge-recurring-visits refunds a paid visit nobody is booked on
        -- once the series has ended, less the card processing fee (Q808); the
        -- notice says so (money review of 60cd5ff79, #1; whether an ADMIN end
        -- should refund in full is an owner question, docs/OPEN.md).
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

CREATE OR REPLACE FUNCTION public.rpc_admin_end_recurring_series(p_job_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_parent_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'end_series_needs_reason'
      USING HINT = 'Say why the platform is ending this series; it goes in the audit log.';
  END IF;
  SELECT COALESCE(j.parent_job_id, j.id) INTO v_parent_id FROM public.jobs j WHERE j.id = p_job_id;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  -- A party: is_series_party's definition (poster, standing Helpr, a date
  -- held from today, an offered date), plus anyone ever hired on the parent
  -- or a visit, any hold, and a stale recurring_helper_id (money review of
  -- 60cd5ff79, #2).
  IF public.is_series_party(v_parent_id)
     OR EXISTS (SELECT 1 FROM public.jobs c
                 WHERE (c.parent_job_id = v_parent_id OR c.id = v_parent_id)
                   AND (c.helper_id = v_uid OR c.recurring_helper_id = v_uid))
     OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                 WHERE h.parent_job_id = v_parent_id AND h.helper_id = v_uid) THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this series, so another admin has to end it.';
  END IF;
  RETURN public.end_recurring_series_by_platform(p_job_id, 'admin', p_reason, v_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_end_recurring_series(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_end_recurring_series(uuid, text) TO authenticated, service_role;
