-- Q1281 (owner decision 2026-10-05, pop-up): NO strike for declining OR
-- ignoring an offer. Strikes are only for backing out after accepting.
--
-- What was wrong (live bodies read 2026-10-12; prosrc md5 equal to the newest
-- migration bodies: decline_job_offer a3df7081... from 20261003193541,
-- expire_unanswered_offers cc0c0b54... from 20261006022526): decline_job_offer
-- and both passes of expire_unanswered_offers (single offer and crew spot)
-- called apply_job_denial_consequence, so a Helpr who turned down an offer, or
-- let its answer-by run out, took a reliability strike for a job they had
-- never accepted. Q706 made the Helpr's Accept the hire moment; these two were
-- left striking until the owner chose.
--
-- Fix: both functions are restated from those effective bodies with every
-- strike call removed. decline_job_offer returns
-- {"action":"none","reason":"offer_free_to_decline"} (the app already reads
-- 'none' as a plain "Offer declined"); the sweep's Helpr notice now says
-- "No strike." on every branch. Nothing else changes: same locks, same reopen,
-- same notices to the poster, same error logging.
--
-- apply_job_denial_consequence is restated at the end with its words only
-- changed (it no longer says declining or ignoring counts).
--
-- Untouched on purpose: helper_cancel_booking (backing out of an ACCEPTED job,
-- gated on the accept stamp since Q706), helper_abort_job,
-- report_helper_no_show, series_give_up_strike, block_user_and_settle.
--
-- Replay-safe: CREATE OR REPLACE only; grants restated as live
-- (pg_proc.proacl 2026-10-12: decline_job_offer authenticated + service_role,
-- expire_unanswered_offers service_role only).
-- Proof: src/test/pglite/offerFreeToRefuse.pglite.mjs (--before is red).
-- Guard: src/test/offerFreeToRefuse.test.ts.

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
  v_setup_unfinished boolean;
  v_crew_setup_unfinished boolean;
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

      -- Q1281 (owner, 2026-10-05): letting an offer run out is free, like
      -- declining it. Nothing is committed until the Helpr taps Accept, so
      -- this sweep files no strike. The two flags below only pick the
      -- Helpr's sentence: the answer-by was capped at the job's start
      -- (20261005184940), or their Stripe setup was unfinished / their
      -- Accept was still waiting on it (Q1180).
      v_cap_ended := v_locked.response_deadline >= public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time);
      v_setup_unfinished := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);

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
               WHEN v_setup_unfinished
               THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and it went back to everyone. No strike.'
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
  -- single offer expires: no strike (Q1281), application closed as
  -- offer_expired, both sides told; the spot reopens (a full crew goes back
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

      -- Q1281: no strike here either; the flags only pick the sentence.
      v_crew_cap := v_slot.response_deadline >= public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time);
      v_crew_setup_unfinished := public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_cjob.id AND p.helper_id = v_slot.helper_id);

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
               WHEN v_crew_setup_unfinished
               THEN '" before your payout setup and Stripe ID were done, so you lost your spot. No strike. Finish both so you can accept the next offer.'
               ELSE '" and you lost your spot. No strike.'
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

CREATE OR REPLACE FUNCTION public.decline_job_offer(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_customer uuid;
  v_job_status text;
  v_job_confirmed timestamptz;
  v_result jsonb;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title, j.customer_id, j.status::text, j.helper_confirmed_at
    INTO v_job_helper, v_job_title, v_customer, v_job_status, v_job_confirmed
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id), and still be an
  -- OFFER. Q1180: a confirmed booking is cancelled with helper_cancel_booking
  -- and a started job aborted with helper_abort_job, which clear the stamps
  -- and carry their own consequences; this decline reopened both with the
  -- stamps left behind (lh-authz-rls re-review 2026-10-03, R1-R3).
  IF v_job_helper IS DISTINCT FROM auth.uid()
     OR v_job_status IS DISTINCT FROM 'accepted'
     OR v_job_confirmed IS NOT NULL THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  -- Q1281 (owner, 2026-10-05): turning down an offer is free. Nothing is
  -- committed until the Helpr taps Accept, so declining files no strike;
  -- backing out AFTER accepting is helper_cancel_booking's strike.
  v_result := jsonb_build_object('action', 'none', 'reason', 'offer_free_to_decline');

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  -- ADDED 2026-09-05. Written HERE, in the same transaction as the reopen,
  -- rather than from the client: the client's own admin fan-out for this event
  -- is structurally dead (RLS), and the notifications INSERT policy is
  -- admin/service-role only, so an ordinary helper's browser cannot write this
  -- row at all. A SECURITY DEFINER RPC is the only seat that can.
  -- customer_id is nullable (account deletion anonymises rather than deletes),
  -- and notifications.user_id is NOT NULL — so guard it rather than throwing
  -- inside a decline that has otherwise already succeeded.
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_customer,
      'Offer declined — job reopened',
      'Your Helpr turned down "' || COALESCE(v_job_title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_job_id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;


REVOKE ALL ON FUNCTION public.decline_job_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_job_offer(uuid) TO authenticated, service_role;


-- apply_job_denial_consequence: restated from its effective definition
-- (20260923205635; live prosrc md5 57a548d5..., equal, measured 2026-10-12)
-- with ONLY its words changed. After Q1281 the ladder is reached only by
-- backing out of a job the Helpr accepted, so the rung-2 notice, the admin
-- message and the ban reason no longer say "declining, ignoring"
-- (lh-money-escrow review of 250d0d72a, finding 1). Grants as live.
CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Shielded strikes don't count toward escalation.
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper
     AND violation_type = 'job_denial'
     AND COALESCE(action_taken, '') <> 'forgiven_elite_shield';

  -- Active Elite + no shield used in the rolling window?
  SELECT (p.subscription_tier = 'elite'
          AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
    INTO v_is_elite
    FROM public.profiles p WHERE p.user_id = p_helper;

  IF COALESCE(v_is_elite, false) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.user_violations
       WHERE user_id = p_helper
         AND action_taken = 'forgiven_elite_shield'
         AND created_at > now() - interval '180 days'
    ) INTO v_shield_available;
  END IF;

  IF v_shield_available THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_helper, 'job_denial', p_description, p_job, 'forgiven_elite_shield');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (p_helper, 'Your Elite shield absorbed this one',
            'As an Elite member, your first reliability strike every 6 months is forgiven. This one''s on the house — the next one counts.',
            'info', '/profile?tab=warnings', p_job);
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => p_helper,
    p_violation_type            => 'job_denial',
    p_description               => p_description,
    p_job_id                    => p_job,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['none', 'warning', 'temp_ban', 'pending_ban_review'],
    p_effects                   => ARRAY['record', 'final_warning', 'suspend', 'permanent'],
    p_copy                      => jsonb_build_array(
      -- Rung 1 is recorded SILENTLY: no notification. Cast is required —
      -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
      null::jsonb,
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second reliability strike. One more — backing out of a job you accepted — and your account is suspended for 7 days.'),
      jsonb_build_object(
        'title', 'Account suspended for 7 days',
        'message', 'Third reliability strike — your account is suspended for 7 days. A fourth strike restricts your account again while an admin decides whether to ban it permanently.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Fourth reliability strike — your account is restricted for 7 days and an admin is reviewing it for a permanent ban. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => false,
    p_admin_message_format      => '%s has %s reliability strikes on file (backed out of jobs they accepted) and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept so the direct-ban
    -- path stays fully specified if that policy is ever revisited.
    p_ban_reason                => 'Fourth reliability strike (backed out of jobs they accepted)'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) TO service_role;
