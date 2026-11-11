-- F284 (owner 11-11 ~2:10 PM, OWNER-DECISIONS.md): a poster may report a no-show only from 30 minutes after the
-- start time, for a crew member too. rpc_poster_report_member_no_show restated from its newest definition
-- (20261102100421); the ONLY change is the start guard: a timed job is refused until start + 30 minutes and the hint
-- names that clock time, exactly as report_helper_no_show's GUARD 2 (20261111202421). A job with no start time keeps
-- its rule (the day's end).
--
-- Proof: src/test/pglite/crewNoShowOpensAfter30Minutes.pglite.mjs. Guard: src/test/noShowOpensAfter30Minutes.test.tsx.
-- Sensitive: authz/money (a SECURITY DEFINER RPC callable by members; it strikes a Helpr and closes a funded spot).
-- No new access: the poster check is unchanged and the guard only refuses more. Grants unchanged.

CREATE OR REPLACE FUNCTION public.rpc_poster_report_member_no_show(_job_id uuid, _member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_slot record;
  v_starts_at timestamptz;
  v_opens_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_now timestamptz := now();
  v_remaining int;
  v_filled int;
  v_needed int;
  v_done int;
  v_job_complete boolean := false;
  v_gone uuid[];
  v_left int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- The ladder's trusted-write flag, as report_helper_no_show sets it.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  SELECT j.id, j.customer_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.is_group_job, j.status::text AS status, COALESCE(j.helpers_needed, 1) AS helpers_needed
    INTO v_job
    FROM public.jobs j
   WHERE j.id = _job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  -- Only the job's poster may report a member as a no-show.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_job.is_group_job IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_crew_job'
      USING HINT = 'This job has one Helpr: use Report No-Show on the job.';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active'
      USING HINT = 'A no-show can only be reported on a booked job that is not finished.';
  END IF;
  IF v_job.payment_status IS NULL OR v_job.payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;
  -- CHANGED 20261102100421 (Q2588): no start time is "any time that day": a member is not a
  -- no-show until the day is over (the next Central midnight), as report_helper_no_show.
  -- CHANGED 20261111214523 (F284, owner 11-11 ~2:10 PM): a TIMED job opens 30 minutes after its start, as
  -- report_helper_no_show's GUARD 2 (20261111202421); the hint names that clock time.
  v_starts_at := (CASE WHEN v_job.start_time IS NULL THEN (v_job.date_needed + 1) + '00:00'::time ELSE v_job.date_needed + v_job.start_time END)
                   AT TIME ZONE 'America/Chicago';
  v_opens_at := v_starts_at + CASE WHEN v_job.start_time IS NULL THEN interval '0 minutes' ELSE interval '30 minutes' END;
  IF v_starts_at IS NULL OR v_now < v_opens_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = CASE WHEN v_job.start_time IS NULL
        THEN 'This job is any time that day. You can report a no-show once the day is over.'
        ELSE 'You can report a no-show from '
             || CASE WHEN (v_opens_at AT TIME ZONE 'America/Chicago')::date = (v_now AT TIME ZONE 'America/Chicago')::date
                     THEN to_char(v_opens_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')
                     ELSE to_char(v_opens_at AT TIME ZONE 'America/Chicago', 'FMDy, FMMon FMDD "at" FMHH12:MI AM') END
             || ', 30 minutes after the start time.' END;
  END IF;

  -- Once per member per job. Checked before the slot: a reported member's
  -- spot is gone, and the poster should hear "already reported", not "not on
  -- this crew".
  IF EXISTS (
    SELECT 1 FROM public.user_violations
     WHERE job_id = _job_id AND violation_type = 'no_show' AND user_id = _member_id
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'You already reported this crew member as a no-show.';
  END IF;

  SELECT g.* INTO v_slot
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id AND g.helper_id = _member_id
   FOR UPDATE;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;
  IF v_slot.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_never_accepted'
      USING HINT = 'This Helpr never confirmed their spot, so it closes on its own with no strike.';
  END IF;
  IF v_slot.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_done'
      USING HINT = 'This crew member marked their part done, so they cannot be a no-show.';
  END IF;
  IF v_slot.helper_arrived_at IS NOT NULL OR v_slot.poster_confirmed_arrival_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_arrived'
      USING HINT = 'This crew member checked in on this job, so they cannot be reported as a no-show.';
  END IF;
  IF v_slot.helper_arrival_near_miss_at IS NOT NULL
     AND v_slot.helper_arrival_near_miss_at > v_now - interval '12 hours' THEN
    RAISE EXCEPTION 'helper_near_miss_pending'
      USING HINT = 'This crew member checked in near the job, a little way from its map pin. If they are there, tap Confirm arrival; if not, contact support.';
  END IF;

  -- THE STRIKE: the no-show ladder, as report_helper_no_show (20261029180706) calls it.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = _member_id
     AND violation_type = 'no_show'
     AND reported_by IS DISTINCT FROM v_uid;

  v_result := public.apply_consequence_ladder(
    p_user                      => _member_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for crew job: ' || COALESCE(v_job.title, 'Unknown'),
    p_job_id                    => _job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different people who posted jobs and is restricted for 7 days pending your decision.',
    p_ban_reason                => 'Repeated no-show violations'
  );
  -- Attribution: GUARD 3b of the ladder counts DISTINCT reporters.
  UPDATE public.user_violations
     SET reported_by = v_uid
   WHERE job_id = _job_id
     AND violation_type = 'no_show'
     AND user_id = _member_id
     AND reported_by IS NULL;

  -- THE SPOT CLOSES. trg_sync_job_after_roster_departure sets their accepted
  -- application to rejected; the line after says why.
  DELETE FROM public.group_job_helpers WHERE id = v_slot.id;
  UPDATE public.applications
     SET status = 'rejected', closed_reason = 'no_show'
   WHERE job_id = _job_id
     AND helper_id = _member_id
     AND status IN ('accepted', 'rejected')
     AND closed_reason IS NULL;

  -- type 'warning', as the one-Helpr no-show notice (notification-templates
  -- no_show_reported): notifications_type_check has no 'no_show' type, and an
  -- unlisted type would abort this whole report. The title follows the rung
  -- the ladder recorded, never the poster's claim.
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (_member_id,
          CASE WHEN v_result->>'action' = 'pending_ban_review'
               THEN 'Account restricted for 7 days'
               ELSE 'No-show warning' END,
          'The person who posted "' || COALESCE(v_job.title, 'the job')
            || '" reported that you did not show up. Your spot on the crew is closed and you are not paid for it.'
            || CASE WHEN v_result->>'action' = 'pending_ban_review'
                    THEN ' This is your second no-show report, so your account is restricted for 7 days while an admin reviews it. If you think this is wrong, email admin@louisianahelpr.com.'
                    ELSE ' A no-show warning is on your record.' END,
          'warning',
          '/jobs?job=' || _job_id::text,
          _job_id);

  -- THE ROLL-UP, as rpc_group_member_mark_done (20261006031350) runs it after
  -- a member's Done: the rest of the crew may already be finished, and nobody
  -- else will tap Done to complete it.
  SELECT count(*) FILTER (WHERE g.helper_completed_at IS NULL AND g.helper_confirmed_at IS NOT NULL),
         count(*) FILTER (WHERE g.helper_confirmed_at IS NOT NULL OR g.helper_completed_at IS NOT NULL),
         count(*) FILTER (WHERE g.helper_completed_at IS NOT NULL)
    INTO v_remaining, v_filled, v_done
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id;

  -- helpers_needed from the job row this function locked first.
  v_needed := v_job.helpers_needed;

  -- v_done >= 1: a crew where nobody worked does not "complete" by reports
  -- alone (every member a no-show is a cancellation, not a payout).
  IF v_remaining = 0 AND v_done >= 1
     AND (v_filled >= v_needed
          OR (public.crew_completes_when_hired_done() AND v_filled >= 1)) THEN
    BEGIN
      WITH gone AS (
        DELETE FROM public.group_job_helpers
         WHERE job_id = _job_id
           AND helper_confirmed_at IS NULL
           AND helper_completed_at IS NULL
        RETURNING helper_id
      )
      SELECT array_agg(helper_id) INTO v_gone FROM gone;

      UPDATE public.applications a
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE a.job_id = _job_id
         AND a.helper_id = ANY (COALESCE(v_gone, '{}'::uuid[]))
         AND a.status IN ('accepted', 'rejected')
         AND a.closed_reason IS NULL;
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT m,
             'Your offer closed',
             'The rest of the crew finished "' || COALESCE(v_job.title, 'the job')
               || '" before you confirmed your spot, so the offer closed. No strike.',
             'expired',
             '/jobs?job=' || _job_id::text,
             _job_id
        FROM unnest(COALESCE(v_gone, '{}'::uuid[])) AS m
       WHERE m IS NOT NULL;

      SELECT count(*) INTO v_left
        FROM public.group_job_helpers g
       WHERE g.job_id = _job_id
         AND g.helper_completed_at IS NULL;
      IF v_left > 0 THEN
        RAISE EXCEPTION 'crew_changed_under_completion' USING ERRCODE = 'LHC01';
      END IF;

      IF v_filled < v_needed THEN
        UPDATE public.jobs
           SET status = 'accepted'
         WHERE id = _job_id
           AND status = 'open';
      END IF;
      PERFORM set_config('app.group_rollup_rpc', '1', true);
      UPDATE public.jobs
         SET helper_completed_at = v_now
       WHERE id = _job_id
         AND helper_completed_at IS NULL
         AND status IN ('accepted', 'in_progress', 'revision_requested');
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := true;
    EXCEPTION WHEN SQLSTATE 'LHC01' THEN
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := false;
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'helper_id', _member_id,
    'job_title', v_job.title,
    'crew_remaining', v_remaining,
    'job_complete', v_job_complete
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) TO authenticated, service_role;
