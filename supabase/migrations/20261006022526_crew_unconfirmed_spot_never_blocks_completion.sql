-- Q1378, lh-money-escrow review of 50a721785 (2026-10-05): "an unconfirmed
-- refill on a crew that goes in_progress is never removed by the expiry sweep,
-- so the job can't complete and the escrow stays held."
--
-- How: a member hired into a crew (a refill, or any first-fill member) is
-- unconfirmed until they answer. A member who already confirmed can arrive
-- early (rpc_group_member_mark_arrival has no time gate), which moves the crew
-- to in_progress. expire_unanswered_offers' crew pass scanned only open and
-- accepted crews, and rpc_group_member_mark_done's roll-up counted every
-- roster row, unconfirmed ones included. An unconfirmed member can never
-- finish (they cannot set out or arrive), so the crew never completed.
--
-- Fix (owner rule already decided 2026-10-05: an unconfirmed crew spot
-- expires like an unanswered offer, no fee):
--   1. expire_unanswered_offers' crew pass also covers in_progress crews; the
--      poster is told the share comes back at payout (a started crew takes no
--      refill: accept_group_application admits open and accepted only).
--   2. rpc_group_member_mark_done's roll-up counts only CONFIRMED members, and
--      when it completes the crew it closes any spot still unconfirmed (no fee,
--      no strike, application closed offer_expired, member told) and takes the
--      row off the roster, so process-scheduled-payouts pays the members who
--      worked and refunds the rest of the budget (budget minus the roster's
--      frozen shares; refundUnfilledCrewShares).
--
-- Both functions are restated from their EFFECTIVE definitions (prosrc md5
-- equal to prod for rpc_group_member_mark_done, 855c3b8f…, measured
-- 2026-10-05; expire_unanswered_offers from 20261006015121). Replay-safe:
-- CREATE OR REPLACE only; grants restated as live (pg_proc.proacl).
-- rpc_group_member_mark_done stays ban-gated through the tables it writes
-- (group_job_helpers, applications, jobs all carry enforce_ban_gate).
-- Proof: src/test/pglite/crewUnconfirmedSpot.pglite.mjs (--before is red).
-- Guard: src/test/crewRestCarryOn.test.ts.

CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
  v_no_strike boolean;
  v_crew_no_strike boolean;
  v_cap_ended boolean;
  v_crew_cap boolean;
  v_slot record;
  v_cjob record;
  v_remaining int;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id, j.helper_id,
           -- Q1188: a seed job, or a seed/test Helpr (detect_stuck_payments'
           -- rule), logs a failure under the '-seed' source.
           (coalesce(j.is_seed, false) OR coalesce(hp.is_seed, false)) AS seed
      FROM public.jobs j
      LEFT JOIN public.profiles hp ON hp.user_id = j.helper_id
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    -- Q1188 (lh-authz-rls round 3 of Q1180, should-fix 2): each offer in its
    -- own subtransaction. accept_job_offer takes the Helpr's profile, then the
    -- job; this sweep holds the job when the strike ladder writes that
    -- profile. If Postgres picks this side of that deadlock (or anything else
    -- in one iteration fails), only this offer rolls back, it is logged with
    -- its job, and every other offer still expires. The next run retries it.
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.helper_id, j.response_deadline, j.date_needed, j.start_time
        INTO v_locked
        FROM public.jobs j
       WHERE j.id = v_job.id
         AND j.status = 'accepted'
         AND j.helper_id IS NOT NULL
         AND j.response_deadline IS NOT NULL
         AND j.response_deadline < now()
         AND j.helper_confirmed_at IS NULL
       FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT a.id INTO v_app_id
        FROM public.applications a
       WHERE a.job_id = v_locked.id
         AND a.helper_id = v_locked.helper_id
         AND a.status = 'accepted'
       LIMIT 1;

      -- ONE ladder for the whole reliability family — see
      -- apply_job_denial_consequence (20260824243000). The literal copy this
      -- replaced is exactly the drift hazard its own comment warned about.
      -- No strike while the Helpr's Stripe setup is unfinished, or after they
      -- tapped Accept and were still finishing it (owner, 2026-10-03: "it
      -- shouldn't hold up anything"; Q1180).
      -- 20261005184940: an answer-by capped at the job's start can be minutes
      -- long. Letting THAT run out is not a strike (lh-money-escrow review of
      -- the cap, finding 1; the owner's wider Q1281 ruling is separate).
      v_cap_ended := v_locked.response_deadline >= public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time);
      v_no_strike := v_cap_ended
        OR public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);
      IF NOT v_no_strike THEN
        PERFORM public.apply_job_denial_consequence(
          v_locked.helper_id, v_locked.id,
          'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');
      END IF;

      IF v_app_id IS NOT NULL THEN
        -- Q1207: say why it closed, or the Helpr reads "You weren't picked".
        UPDATE public.applications
           SET status = 'rejected', closed_reason = 'offer_expired'
         WHERE id = v_app_id;
      END IF;

      UPDATE public.jobs
         SET status = 'open',
             helper_id = NULL,
             response_deadline = NULL
       WHERE id = v_locked.id;

      -- Both sides are told, because both sides were waiting on this.
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.customer_id,
        'Offer expired — job reopened',
        'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
          || '". It''s open to everyone again, so you can pick somebody else.',
        'job_updates',
        '/posts?job=' || v_locked.id::text,
        v_locked.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
          || CASE WHEN v_cap_ended
               THEN '" when the job started, so it went back to everyone. No strike.'
               WHEN v_no_strike
               THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and it went back to everyone. Letting an offer expire counts the same as declining it.'
             END,
        'expired',
        '/jobs?job=' || v_locked.id::text,
        v_locked.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E offer logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_job.seed THEN 'info' ELSE 'error' END,
        'unanswered offer expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_job.seed THEN '-seed' ELSE '' END,
                           'seed', v_job.seed, 'job_id', v_job.id::text),
        jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  -- ── THE CREW PASS (Q729, owner 2026-10-05) ───────────────────────────────
  -- A crew has no lead, so its members are found on the roster. Each member
  -- whose own reply deadline passed unconfirmed loses the spot, exactly as a
  -- single offer expires: same strike rule and exemptions, application closed
  -- as offer_expired, both sides told; the spot reopens (a full crew goes back
  -- to open). No fee: nothing was committed.
  FOR v_slot IN
    SELECT g.id AS slot_id, g.job_id, g.helper_id,
           g.response_deadline, j.date_needed, j.start_time,
           (j.is_seed IS TRUE OR hp.is_seed IS TRUE) AS seed
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
      LEFT JOIN public.profiles hp ON hp.user_id = g.helper_id
     WHERE j.is_group_job IS TRUE
       -- 'in_progress' (Q1378 money review, 2026-10-05): a member who already
       -- arrived starts the crew, and an unconfirmed spot on it must still
       -- expire, or it holds a share nobody will work.
       AND j.status IN ('open', 'accepted', 'in_progress')
       AND g.helper_id IS NOT NULL
       AND g.helper_confirmed_at IS NULL
       AND g.response_deadline IS NOT NULL
       AND g.response_deadline < now()
  LOOP
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.status::text AS status, j.helpers_needed
        INTO v_cjob
        FROM public.jobs j
       WHERE j.id = v_slot.job_id
         AND j.is_group_job IS TRUE
         AND j.status IN ('open', 'accepted', 'in_progress')
       FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
      -- Re-checked under the job's lock: a confirm that landed first wins.
      PERFORM 1
        FROM public.group_job_helpers g
       WHERE g.id = v_slot.slot_id
         AND g.helper_confirmed_at IS NULL
         AND g.response_deadline IS NOT NULL
         AND g.response_deadline < now()
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_crew_cap := v_slot.response_deadline >= public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time);
      v_crew_no_strike := v_crew_cap
        OR public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_cjob.id AND p.helper_id = v_slot.helper_id);
      IF NOT v_crew_no_strike THEN
        PERFORM public.apply_job_denial_consequence(
          v_slot.helper_id, v_cjob.id,
          'Let a job offer expire without answering: "' || COALESCE(v_cjob.title, 'Unknown') || '"');
      END IF;

      UPDATE public.applications
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE job_id = v_cjob.id AND helper_id = v_slot.helper_id AND status = 'accepted';

      DELETE FROM public.group_job_helpers WHERE id = v_slot.slot_id;

      SELECT count(*) INTO v_remaining FROM public.group_job_helpers g WHERE g.job_id = v_cjob.id;
      -- Q1378 (owner 2026-10-05): the rest of the crew carries on; only a
      -- crew with nobody left reopens (see helper_cancel_booking).
      IF v_cjob.status = 'accepted' AND v_remaining = 0 THEN
        UPDATE public.jobs SET status = 'open' WHERE id = v_cjob.id;
      END IF;

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_cjob.customer_id,
        'Offer expired — spot reopened',
        'A Helpr you picked didn''t answer in time for "' || COALESCE(v_cjob.title, 'your job')
          || CASE WHEN v_cjob.status = 'in_progress' AND v_remaining > 0
               THEN '". The rest of your crew is still on, and that spot''s share is refunded to you once the job is done.'
               WHEN v_cjob.status = 'accepted' AND v_remaining > 0
               THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
               ELSE '". Their spot is open to everyone again, so you can pick somebody else.'
             END,
        'job_updates',
        '/posts?job=' || v_cjob.id::text,
        v_cjob.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_slot.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_cjob.title, 'a job')
          || CASE WHEN v_crew_cap
               THEN '" when the job started, so you lost your spot. No strike.'
               WHEN v_crew_no_strike
               THEN '" before your payout setup and Stripe ID were done, so you lost your spot. No strike. Finish both so you can accept the next offer.'
               ELSE '" and you lost your spot. Letting an offer expire counts the same as declining it.'
             END,
        'expired',
        '/jobs?job=' || v_cjob.id::text,
        v_cjob.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_slot.seed THEN 'info' ELSE 'error' END,
        'unanswered crew spot expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_slot.seed THEN '-seed' ELSE '' END,
                           'seed', v_slot.seed, 'job_id', v_slot.job_id::text),
        jsonb_build_object('job_id', v_slot.job_id, 'helper_id', v_slot.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;

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
    -- The transaction-local flag the restated `enforce_helper_completion_gates`
    -- below reads. It admits THIS write, on a group job only, past a job-level
    -- arrival predicate that a crew job never satisfies (the arrivals are on the
    -- roster rows, and each of them has already passed the per-member gate
    -- above). It is dropped immediately after its single UPDATE, so nothing
    -- later in the transaction inherits it.
    -- An under-filled crew is still 'open' (only the last slot books it):
    -- close its staffing first, so the job reads as booked by the crew that
    -- did the work and the poster's approval sees a live job.
    IF v_filled < v_needed THEN
      UPDATE public.jobs
         SET status = 'accepted'
       WHERE id = _job_id
         AND status = 'open';
    END IF;
    -- Q1378 money review: the work is done, so a spot still unconfirmed closes
    -- now, exactly as an unanswered spot expires (owner 2026-10-05: no fee),
    -- and with no strike (their answer-by time had not run out). Taking the
    -- row off the roster is what keeps process-scheduled-payouts from paying
    -- it: the payout pays the roster and refunds the rest of the budget.
    SELECT j.title INTO v_title FROM public.jobs j WHERE j.id = _job_id;
    UPDATE public.applications a
       SET status = 'rejected', closed_reason = 'offer_expired'
      FROM public.group_job_helpers g
     WHERE g.job_id = _job_id
       AND g.helper_confirmed_at IS NULL
       AND g.helper_completed_at IS NULL
       AND a.job_id = _job_id
       AND a.helper_id = g.helper_id
       AND a.status = 'accepted';
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT g.helper_id,
           'Your offer closed',
           'The rest of the crew finished "' || COALESCE(v_title, 'the job')
             || '" before you confirmed your spot, so the offer closed. No strike.',
           'expired',
           '/jobs?job=' || _job_id::text,
           _job_id
      FROM public.group_job_helpers g
     WHERE g.job_id = _job_id
       AND g.helper_id IS NOT NULL
       AND g.helper_confirmed_at IS NULL
       AND g.helper_completed_at IS NULL;
    DELETE FROM public.group_job_helpers
     WHERE job_id = _job_id
       AND helper_confirmed_at IS NULL
       AND helper_completed_at IS NULL;
    PERFORM set_config('app.group_rollup_rpc', '1', true);
    UPDATE public.jobs
       SET helper_completed_at = v_now
     WHERE id = _job_id
       AND helper_completed_at IS NULL
       AND status IN ('accepted', 'in_progress', 'revision_requested');
    PERFORM set_config('app.group_rollup_rpc', '0', true);
    v_job_complete := true;
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
