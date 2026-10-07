-- Q1214 (2) (lh-authz-rls review of Q1187/Q1188): the series pickup is an
-- accept like any other, and the award gate stops leaning on another trigger.
--
-- enforce_helper_award_gate let ONE confirming write through without
-- app.accept_rpc: the caller taking an open job with nobody on it and
-- confirming it at once. Its only live writer is claim_series_dates' pickup
-- of a vacated visit (pg_proc 2026-10-07: the functions that stamp
-- jobs.helper_confirmed_at are complete_job_accept, which sets the flag, and
-- claim_series_dates; rpc_group_member_confirm writes group_job_helpers). The
-- exemption was safe only because trg_hire_columns_rpc_only refuses a client's
-- helper_id. Now claim_series_dates sets app.accept_rpc around that one UPDATE
-- (as complete_job_accept does) and the gate refuses every other confirming
-- UPDATE outright. Readiness (helper_accept_block_reason) is still judged.
--
-- Both bodies are the LIVE ones (pg_get_functiondef read 2026-10-07; md5(prosrc)
-- claim_series_dates acbc836d0f6467d3a99a770debe83405, enforce_helper_award_gate
-- 3476dfde455c8685fc0f5ad2ceb21d16) with only the edits marked Q1214 (2).
-- Grants restated as live: claim_series_dates EXECUTE for authenticated and
-- service_role; the trigger function for service_role only.
-- Guard: src/test/seriesClaimIsAnAccept.test.ts (+ PGlite proof in
-- ~/.lh-pglite/q1214.mjs, recorded in docs/OPEN.md Q1214).

CREATE OR REPLACE FUNCTION public.enforce_helper_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason   text;
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged. An anon request is an end-user
  -- session with no uid, not a server write.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Nothing starts, finishes or is disputed on an offer the Helpr has not
  -- accepted, ready or not: the accept goes through accept_job_offer, which
  -- tells the poster. Refused outright (lh-authz-rls re-review 2026-10-03:
  -- a READY Helpr who never tapped Accept could mark_helper_arrival into
  -- in_progress with no poster notice, and either party could open a dispute
  -- on an offer, freezing the escrow). Server sweeps and system disputes run
  -- in server context and returned above.
  IF TG_OP = 'UPDATE' AND NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NULL
     AND ((OLD.status::text = 'accepted'
           AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed'))
          OR (NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL)) THEN
    RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';
  END IF;

  v_awarding :=
       -- the accept itself, with or without a Helpr on the row (F2: a stamp
       -- before the Helpr is on the job is judged against nobody and refused)
       (NEW.helper_confirmed_at IS NOT NULL
          AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL))
       -- a confirmed row changing Helpr is a new accept (F3)
    OR (NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NOT NULL
          AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id);

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  -- Q1187: the accept of an offer is written only by an accept RPC that sets
  -- app.accept_rpc for its one UPDATE (complete_job_accept; claim_series_dates'
  -- pickup of a vacated visit since Q1214 (2)). A direct PATCH of
  -- helper_confirmed_at confirmed a job with no poster notice and the other
  -- applications left pending (lh-authz-rls review #8). Q1214 (2): the
  -- take-an-open-job exemption is gone, so the gate no longer leans on
  -- trg_hire_columns_rpc_only to refuse a client's helper_id. INSERTs are
  -- trg_jobs_insert_column_lock's (a poster's new job is born unconfirmed).
  IF TG_OP = 'UPDATE' AND current_setting('app.accept_rpc', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501',
      HINT = 'An offer is accepted with Accept (accept_job_offer), which tells the person who posted it; the confirmation is never written directly.';
  END IF;

  v_reason := public.helper_accept_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;

  RETURN NEW;
END;
$function$;

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
  v_holder uuid;
  v_name text;
  v_list text;
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

  -- The earliest uncreated date a future charge-recurring-visits run can still
  -- fund (see the check in the loop). Deliberately UTC, not Chicago
  -- (scheduling review LOW-2): it models the cron's own clock (06:06 UTC,
  -- funding dates strictly after its UTC run date), so both sides of the
  -- comparison are in the cron's frame. v_today above stays Chicago.
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
    SELECT NULLIF(btrim(p.full_name), '') INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_claimed) AS d;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (v_job.customer_id, v_job.id,
            CASE WHEN cardinality(v_claimed) = 1 THEN 'A visit date was picked up' ELSE 'Visit dates were picked up' END,
            format('%s took %s on "%s".', COALESCE(v_name, 'A Helpr'), v_list, COALESCE(v_job.title, 'your series')),
            'job_updates', '/posts?job=' || v_job.id::text);
  END IF;

  RETURN jsonb_build_object('claimed', to_jsonb(v_claimed), 'taken', to_jsonb(v_taken), 'refused', to_jsonb(v_refused),
                            'already_yours', to_jsonb(v_already));
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_series_dates(uuid, date[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_helper_award_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_helper_award_gate() TO service_role;
