-- Q1378, lh-money-escrow review of bc9ea3a47 (2026-10-05, should-fix RACE):
-- "rpc_group_member_mark_done counts the roster using the statement's
-- snapshot. Live rpc_group_member_confirm locks only the member's own slot
-- and never the job row. Member B (unconfirmed) confirm in flight while last
-- member A taps Done: the count sees B unconfirmed so completion goes ahead;
-- B's application is rejected and B is told 'Your offer closed'; the DELETE
-- waits on B's row lock, re-checks, sees B confirmed and skips it; the job
-- completes with B still on the roster; process-scheduled-payouts pays every
-- roster row, so B is paid for work never done."
--
-- Fix (the reviewer's): DELETE ... RETURNING first, close and tell only the
-- rows it removed, then re-count with a fresh snapshot; if anyone is still not
-- done, a subtransaction rolls back the closing and the crew does not
-- complete (the caller's own Done stands; the crew completes on the confirmed
-- member's Done). Considered and not taken:
--   * locking the job row in rpc_group_member_confirm: confirm locks its slot
--     first, expire_unanswered_offers' crew pass locks the job then the slot,
--     so a job lock taken after the slot in confirm would invert that order;
--   * payouts skipping roster rows with no helper_completed_at: a crew dispute
--     decision (rpc_decide_crew_dispute) can pay a member who never tapped Done,
--     so the filter would withhold a decided payment.
--
-- rpc_group_member_mark_done restated from 20261006022526 (its newest
-- definition) with only the completion block changed. Replay-safe: CREATE OR
-- REPLACE; grants restated as live (authenticated, service_role).
-- Proof: src/test/pglite/crewCompletionRace.pglite.mjs (--before is red).
-- Guard: src/test/crewRestCarryOn.test.ts.

CREATE OR REPLACE FUNCTION public.rpc_group_member_mark_done(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_now timestamptz := now();
  v_remaining int;
  v_filled int;
  v_needed int;
  v_job_complete boolean := false;
  v_title text;
  v_gone uuid[];
  v_left int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;

  IF v_row.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_done', true, 'helper_completed_at', v_row.helper_completed_at);
  END IF;

  -- The §3 trigger is AUTHORITATIVE and fires on the UPDATE below. This write
  -- is plain: no pre-flight copy of the gates to drift out of step with it.
  UPDATE public.group_job_helpers
     SET helper_completed_at = v_now
   WHERE id = v_slot
     AND helper_completed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'part_not_completable' USING ERRCODE = '42501';
  END IF;

  -- THE ROLL-UP. Lock the job row so two members finishing at once cannot both
  -- decide they were last.
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;

  -- Q1378 money review (2026-10-05): only members who CONFIRMED their spot
  -- count. A member who never confirmed cannot set out, arrive or finish
  -- (rpc_group_member_on_the_way / _mark_arrival refuse them), so counting
  -- them held the crew's completion, and its escrow, until a sweep that never
  -- looked at a started crew removed them.
  SELECT count(*) FILTER (WHERE g.helper_completed_at IS NULL AND g.helper_confirmed_at IS NOT NULL),
         count(*) FILTER (WHERE g.helper_confirmed_at IS NOT NULL OR g.helper_completed_at IS NOT NULL)
    INTO v_remaining, v_filled
  FROM public.group_job_helpers g
  WHERE g.job_id = _job_id;

  SELECT COALESCE(j.helpers_needed, 1) INTO v_needed FROM public.jobs j WHERE j.id = _job_id;

  -- Every slot the poster paid for must be BOTH filled and finished. An
  -- under-filled roster does not complete the job on its own: that is a human
  -- decision about the unallocated share, which process-scheduled-payouts
  -- already pages on, and silently completing here would hand it that decision
  -- by default.
  -- CHANGED 2026-09-25 (money review MEDIUM-4, owner being asked): under the
  -- crew_completes_when_hired_done rule an under-filled crew completes once
  -- every HIRED member is done; the unfilled slots' shares are refunded to the
  -- poster by process-scheduled-payouts. With the rule off, every slot the
  -- poster paid for must be filled and finished, as before.
  IF v_remaining = 0
     AND (v_filled >= v_needed
          OR (public.crew_completes_when_hired_done() AND v_filled >= 1)) THEN
    -- Q1378 money review (2026-10-05): the work is done, so a spot still
    -- unconfirmed closes now, exactly as an unanswered spot expires (owner:
    -- no fee), with no strike (their answer-by had not run out). Taking the
    -- row off the roster is what keeps process-scheduled-payouts from paying
    -- it: the payout pays the roster and refunds the rest of the budget.
    --
    -- RACE (lh-money-escrow review of bc9ea3a47): the count above used this
    -- statement's snapshot, and rpc_group_member_confirm locks only the
    -- member's own slot. A member confirming at this instant is invisible to
    -- the count. So the order is: DELETE first (it waits on that member's row
    -- lock and, once their confirm commits, re-checks the row and skips it),
    -- close and tell ONLY the rows it actually removed, then count again with
    -- a fresh snapshot. If anyone is still not done (the member who just
    -- confirmed), nothing here happens: the subtransaction rolls back the
    -- closing and the crew does not complete. The caller's own Done stands.
    BEGIN
      SELECT j.title INTO v_title FROM public.jobs j WHERE j.id = _job_id;
      WITH gone AS (
        DELETE FROM public.group_job_helpers
         WHERE job_id = _job_id
           AND helper_confirmed_at IS NULL
           AND helper_completed_at IS NULL
        RETURNING helper_id
      )
      SELECT array_agg(helper_id) INTO v_gone FROM gone;

      -- trg_sync_job_after_roster_departure already set each removed member's
      -- accepted application to rejected; say why.
      UPDATE public.applications a
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE a.job_id = _job_id
         AND a.helper_id = ANY (COALESCE(v_gone, '{}'::uuid[]))
         AND a.status IN ('accepted', 'rejected')
         AND a.closed_reason IS NULL;
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT m,
             'Your offer closed',
             'The rest of the crew finished "' || COALESCE(v_title, 'the job')
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

      -- An under-filled crew is still 'open' (only the last slot books it):
      -- close its staffing first, so the job reads as booked by the crew that
      -- did the work and the poster's approval sees a live job.
      IF v_filled < v_needed THEN
        UPDATE public.jobs
           SET status = 'accepted'
         WHERE id = _job_id
           AND status = 'open';
      END IF;
      -- The transaction-local flag enforce_helper_completion_gates reads; it
      -- admits THIS write on a group job only and is dropped right after.
      PERFORM set_config('app.group_rollup_rpc', '1', true);
      UPDATE public.jobs
         SET helper_completed_at = v_now
       WHERE id = _job_id
         AND helper_completed_at IS NULL
         AND status IN ('accepted', 'in_progress', 'revision_requested');
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := true;
    EXCEPTION WHEN SQLSTATE 'LHC01' THEN
      -- Someone confirmed while the roll-up ran: they now count, and the crew
      -- completes on their Done. Nothing above this block is undone.
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'crew_remaining', v_remaining,
    'job_complete', v_job_complete
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_group_member_mark_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_group_member_mark_done(uuid) TO authenticated, service_role;
