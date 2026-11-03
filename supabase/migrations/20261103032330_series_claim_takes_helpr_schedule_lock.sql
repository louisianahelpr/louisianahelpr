-- Q1919 part 2 (lh-authz-rls@78c205c37#1), the series claim: picking up a
-- vacated series visit books the Helpr onto it (jobs.helper_id, status
-- 'accepted') with no lock against respond_job_schedule_change, so a visit
-- picked up at the same moment as a schedule-change accept for the same Helpr
-- could double-book them with nobody told (see 20261103032329 for the solo
-- hire writers and the lock-order rule).
--
-- Fix: claim_series_dates takes pg_advisory_xact_lock(hashtext('helpr_schedule:'
-- || caller)) after is_series_party and BEFORE the series row's FOR UPDATE,
-- with no row held. Lock order: respond_job_schedule_change holds a job booked
-- to the Helpr, then waits for this lock, then takes FOR SHARE on the Helpr's
-- other booked jobs. This claim, holding the lock, can then lock a series row
-- or visit booked to the same Helpr (the series' own Helpr, or a date already
-- theirs); if respond holds that exact row at that moment, Postgres ends one
-- of the two calls with a deadlock error and nothing is written by it. Both
-- are taps by a person, who can try again; no money moves in either. No
-- placement of the lock avoids that, because respond holds a booked job on
-- both sides of its own lock (two schedule changes for one Helpr can meet the
-- same way today).
--
-- Restated on Q2247's body (20261102230059_series_claim_unready_holds_one,
-- wip/b11-1102, in l43-next; prosrc md5 b04498970515508cf4ad9bdd1ff5f721), which
-- restated live prod (md5 f519242aa17dd1b4e3b21d10361ddd5c, 2026-11-02) adding
-- the unready-holds-one cap. The only change here is the PERFORM and its
-- comment. LANDS AFTER l43-next (lead 2026-11-02): Q2247's migration must be
-- applied first; this file keeps its cap. Grants as prod has them.

CREATE OR REPLACE FUNCTION public.claim_series_dates(p_job_id uuid, p_dates date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_offered boolean;
  v_on_series boolean;
  v_d date;
  v_releaser uuid;
  v_child_id uuid;
  v_child_status text;
  v_child_helper uuid;
  v_child_start time;
  v_min_fundable date;
  v_claimed date[] := ARRAY[]::date[];
  v_taken date[] := ARRAY[]::date[];
  v_refused date[] := ARRAY[]::date[];
  v_already date[] := ARRAY[]::date[];
  v_needs_setup date[] := ARRAY[]::date[];
  v_block text;
  v_holder uuid;
  v_name text;
  v_list text;
  -- Q2247: future dates the caller already holds on this series.
  v_held_future integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Authz review LOW: a non-party is refused before the row lock, and with one
  -- answer, so it can neither hold the series' lock nor probe which ids exist.
  IF NOT public.is_series_party(p_job_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- Q1919: the per-Helpr schedule lock respond_job_schedule_change takes, so
  -- picking up a vacated visit and a schedule change for the same Helpr take
  -- turns (the second sees the first's committed booking). The caller is the
  -- Helpr. Taken after the party check (a non-party never holds it) and
  -- BEFORE the series row below, with no row held.
  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_uid::text));

  -- One claim at a time per series: first to commit wins every contested date.
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.recurring_helper_id, j.recurrence_days,
         j.recurrence_weeks, j.parent_job_id, j.date_needed, j.series_ended_on, j.status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;
  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'series_ended';
  END IF;
  IF v_uid = v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_offered := EXISTS (SELECT 1 FROM public.series_date_offers o
                        WHERE o.parent_job_id = v_job.id AND o.helper_id = v_uid)
               OR (v_job.recurring_helper_id = v_uid AND v_job.helper_id = v_uid);
  v_on_series := v_offered OR EXISTS (
    SELECT 1 FROM public.series_visit_holds h
     WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date >= v_today);
  IF NOT v_on_series THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.are_users_blocked(v_job.customer_id, v_uid) THEN
    RAISE EXCEPTION 'applicant_blocked';
  END IF;
  -- ID once (owner 2026-10-20): the claimer's readiness, from the one helper
  -- every accept reads. A future date stays accept-first (the hold records the
  -- yes; charge-recurring-visits books it only for a ready holder and
  -- otherwise releases it with a notice). A vacated visit is booked on the
  -- spot below, so an unready claimer is never put on it: that date is
  -- answered needs_setup, and the answer names what is missing.
  v_block := public.helper_accept_block_reason(v_uid);
  IF v_block = 'helper_unknown' THEN
    RAISE EXCEPTION 'helper_unknown';
  END IF;

  -- The earliest uncreated date a future charge-recurring-visits run can still
  -- fund (see the check in the loop). Deliberately UTC, not Chicago
  -- (scheduling review LOW-2): it models the cron's own clock (06:06 UTC,
  -- funding dates strictly after its UTC run date), so both sides of the
  -- comparison are in the cron's frame. v_today above stays Chicago.
  -- Q2247 (owner 2026-10-21): a Helpr whose setup is unfinished holds only
  -- the next 1 series date. Dates are walked earliest first, so the first one
  -- this call can hold is that date; every later one is answered needs_setup
  -- (the answer names what is missing). Holds made before this rule stand.
  SELECT count(*) INTO v_held_future
    FROM public.series_visit_holds h
   WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date >= v_today;

  v_min_fundable := (now() AT TIME ZONE 'UTC')::date
                    + (CASE WHEN (now() AT TIME ZONE 'UTC')::time < '05:30'::time THEN 1 ELSE 2 END);

  FOREACH v_d IN ARRAY (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::date[]) FROM unnest(p_dates) AS x)
  LOOP
    IF v_d <= v_job.date_needed
       OR NOT EXISTS (SELECT 1 FROM public.series_visit_dates(v_job.date_needed, v_job.recurrence_days, v_job.recurrence_weeks) AS s
                       WHERE s = v_d) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    v_child_id := NULL;
    SELECT c.id, c.status::text, c.helper_id, c.start_time
      INTO v_child_id, v_child_status, v_child_helper, v_child_start
      FROM public.jobs c
     WHERE c.parent_job_id = v_job.id AND c.date_needed = v_d
     FOR UPDATE;
    -- Scheduling review MEDIUM-2: the past is judged by the visit's own local
    -- start, not by the calendar day. A visit vacated this morning for a 5pm
    -- start can still be picked up today; one whose start has passed cannot.
    -- A date with no visit row yet needs a day of lead time (fundability
    -- below), so today is always too late for it.
    IF (v_child_id IS NULL AND v_d <= v_today)
       OR (v_child_id IS NOT NULL AND v_child_status = 'open' AND v_child_helper IS NULL
           AND ((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now()) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    IF v_child_id IS NOT NULL
       AND NOT (v_child_status = 'open' AND v_child_helper IS NULL
                AND ((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now()) THEN
      -- Review LOW-6: a double tap is not "taken" when the visit is yours.
      IF v_child_helper = v_uid THEN
        v_already := v_already || v_d;
      ELSE
        v_taken := v_taken || v_d;
      END IF;
      CONTINUE;
    END IF;
    -- An uncreated date must still be fundable: charge-recurring-visits runs
    -- daily at 06:06 UTC and funds dates strictly after its run date, so a
    -- date claimed after the last run that could fund it would be held and
    -- never booked (money audit 2026-09-25). 05:30 leaves the run its margin.
    IF v_child_id IS NULL
       AND v_d < v_min_fundable THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    -- Someone already holds it (the other claimer of a race committed first):
    -- `taken`, before the pick-up rule below reads the release row that claim
    -- just deleted.
    v_holder := NULL;
    SELECT h.helper_id INTO v_holder
      FROM public.series_visit_holds h WHERE h.parent_job_id = v_job.id AND h.visit_date = v_d;
    IF v_holder IS NOT NULL THEN
      -- Review LOW-6: the caller's own date (a double tap) is already_yours.
      IF v_holder = v_uid THEN
        v_already := v_already || v_d;
      ELSE
        v_taken := v_taken || v_d;
      END IF;
      CONTINUE;
    END IF;
    v_releaser := NULL;
    SELECT r.helper_id INTO v_releaser
      FROM public.recurring_visit_releases r
     WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
    -- The one who gave a date up does not take it back; a Helpr on the series
    -- without an offer picks up only a date someone gave up.
    IF v_releaser = v_uid OR (NOT v_offered AND v_releaser IS NULL) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    IF v_child_id IS NOT NULL AND v_block IS NOT NULL THEN
      v_needs_setup := v_needs_setup || v_d;
      CONTINUE;
    END IF;
    IF v_block IS NOT NULL AND v_held_future + cardinality(v_claimed) >= 1 THEN
      v_needs_setup := v_needs_setup || v_d;
      CONTINUE;
    END IF;
    INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id)
    VALUES (v_job.id, v_d, v_uid)
    ON CONFLICT (parent_job_id, visit_date) DO NOTHING;
    IF FOUND THEN
      v_claimed := v_claimed || v_d;
      DELETE FROM public.recurring_visit_releases r
       WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
      -- A vacated visit is already funded: the claimer takes over that row
      -- (its escrow and payout follow helper_id), never a public reopening.
      IF v_child_id IS NOT NULL THEN
        -- Q1214 (2): this UPDATE is the claimer's accept of the vacated
        -- visit, so jobs_award_gate lets it confirm (app.accept_rpc), as
        -- complete_job_accept does. On for this one statement only.
        PERFORM set_config('app.accept_rpc', '1', true);
        UPDATE public.jobs
           SET helper_id = v_uid,
               status = 'accepted',
               helper_confirmed_at = now()
         WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;
        PERFORM set_config('app.accept_rpc', '0', true);
        -- enforce_application_job_state (C11) lets this one row through: the
        -- visit is 'accepted' by now. The flag is local to this INSERT.
        PERFORM set_config('app.series_claim_rpc', '1', true);
        INSERT INTO public.applications (job_id, helper_id, status, message)
        VALUES (v_child_id, v_uid, 'accepted', NULL)
        ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted';
        PERFORM set_config('app.series_claim_rpc', '0', true);
      END IF;
    ELSE
      v_taken := v_taken || v_d;
    END IF;
  END LOOP;

  IF cardinality(v_claimed) > 0 AND v_job.customer_id IS NOT NULL THEN
    SELECT public.member_display_name(p.full_name, NULL) INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_claimed) AS d;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (v_job.customer_id, v_job.id,
            CASE WHEN cardinality(v_claimed) = 1 THEN 'A visit date was picked up' ELSE 'Visit dates were picked up' END,
            format('%s took %s on "%s".', COALESCE(v_name, 'A Helpr'), v_list, COALESCE(v_job.title, 'your series')),
            'job_updates', '/posts?job=' || v_job.id::text);
  END IF;

  RETURN jsonb_build_object('claimed', to_jsonb(v_claimed), 'taken', to_jsonb(v_taken), 'refused', to_jsonb(v_refused),
                            'already_yours', to_jsonb(v_already), 'needs_setup', to_jsonb(v_needs_setup),
                            'missing', CASE WHEN v_block IS NULL THEN '[]'::jsonb
                                            ELSE to_jsonb(public.helper_accept_missing(v_uid)) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_series_dates(uuid, date[]) TO authenticated, service_role;
