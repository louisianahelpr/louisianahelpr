-- JOBS-3 (owner 2026-10-31 ~9:35 PM, pop-up): "crew members are paid
-- individually once the poster confirms they worked; a no-show member gets
-- nothing + a strike; others are never held up."
--
-- WHAT WAS WRONG (measured 2026-10-31, b51 handoff): a crew had no per-member
-- no-show. report_helper_no_show refuses a crew (its helper_id is NULL,
-- src/test/crewHasNoJobLevelNoShow.test.ts). rpc_group_member_mark_done
-- (newest 20261006031350) rolls the crew up only when every CONFIRMED member
-- (helper_confirmed_at NOT NULL) has helper_completed_at, so one confirmed
-- member who never came held the roll-up, and with it every other member's
-- pay, for ever.
--
-- THIS MIGRATION adds ONE function and changes no existing one:
--   public.rpc_poster_report_member_no_show(_job_id uuid, _member_id uuid)
--   * the job's POSTER only (a member, another Helpr or a stranger is refused
--     not_authorized), on a crew job, funded, after the scheduled start;
--   * the member must have CONFIRMED their spot (an unconfirmed spot is not a
--     no-show: it closes on its own, no strike) and must not have arrived,
--     been confirmed arrived by the poster, or finished; a check-in within a
--     mile of the pin in the last 12 hours is refused as for one Helpr
--     (report_helper_no_show GUARD 0b, 20261029180706);
--   * the STRIKE is the existing no-show ladder, called exactly as
--     report_helper_no_show calls it (apply_consequence_ladder, 'no_show',
--     warning then pending ban review, DISTINCT reporters), ONCE per member per
--     job (a no_show user_violations row for this member on this job refuses
--     a second report: already_reported);
--   * the spot CLOSES: the member's roster row is deleted, as when a member
--     leaves (trg_sync_job_after_roster_departure closes their accepted
--     application and, the poster being the caller, lapses a pending detail
--     change), and the application says why (closed_reason 'no_show');
--   * the member is TOLD, with the job as the notice's subject so the seed
--     boundary (trg_notifications_seed_boundary) drops a test job's notice to
--     a real person;
--   * then the crew's ROLL-UP runs again: if every confirmed member left on
--     the crew is done, the crew completes now, exactly as the last member's
--     own Done would have completed it (the roll-up block of
--     rpc_group_member_mark_done 20261006031350, restated below with its
--     race-safe DELETE ... RETURNING and LHC01 re-count, and the same
--     crew_completes_when_hired_done() rule). So the members who worked are
--     never held up by the one who did not come.
--
-- WHERE THE NO-SHOW'S SHARE GOES (lead decision 10-31, from b51's
-- measurement): back to the poster, through the EXISTING unfilled-spot
-- refund. process-scheduled-payouts pays the roster's frozen shares and,
-- under CREW_COMPLETES_WHEN_HIRED_DONE, refundUnfilledCrewShares returns the
-- budget minus what the paid members' frozen shares add up to, once (its
-- payment_refunds row). The closed spot is no longer on the roster, so it is
-- in that remainder, and it is refunded once, by the same code that refunds
-- a spot nobody filled. No payout code changes. The spot is never re-offered:
-- the start has passed (the R1 refill in crewRestCarryOn runs before the
-- start only) and this function does not reopen the job.
--
-- LOCK ORDER: job row FOR UPDATE first, then the member's slot FOR UPDATE,
-- the order expire_unanswered_offers' crew pass uses. rpc_group_member_mark_done
-- locks its own slot and then the job, so a member tapping Done on the SAME
-- slot at the same instant can deadlock with this report; Postgres aborts one
-- of the two (40P01) and nothing is half-written. Otherwise whichever commits
-- first wins: if the Done wins, the slot has helper_completed_at and this
-- report is refused (helper_already_done); if the report wins, the Done finds
-- no slot (not_on_this_crew).
--
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated each run.
-- Proof: src/test/pglite/crewMemberNoShow.pglite.mjs (--before is red).
-- Guard: src/test/crewMemberNoShow.test.ts.

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
  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR v_now < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
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
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
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

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (_member_id,
          'Reported as a no-show',
          'The poster of "' || COALESCE(v_job.title, 'the job')
            || '" reported that you did not show up. Your spot on the crew is closed, you are not paid for it, and a no-show is on your record.',
          'no_show',
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
