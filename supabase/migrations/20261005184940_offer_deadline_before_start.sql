-- A hire offer's answer-by time never runs past the job's start (owner, 2026-10-05).
--
-- Seen live on /posts: a job starting at 1:50 PM, hired at 1:43 PM, said
-- "23h 58m left for them to confirm". accept_application wrote the CLIENT's
-- p_deadline verbatim (now + the dialog's 1-48 h choice, default 24 h), so the
-- Helpr's answer window could end a day after the job was meant to begin, and
-- a client could send any instant at all (a year out, the past, or NULL =
-- never expires).
--
-- The rule, on the server (the card reads jobs.response_deadline back):
--   deadline = LEAST(the poster's chosen window, 48 h from now, the job's start)
-- where the job's start is date_needed + start_time in America/Chicago, and a
-- job with no start_time ("any time that day") runs to the END of its day.
--
-- Hiring into a job that starts in under 15 minutes (or has already started)
-- is REFUSED with `job_starts_too_soon`. That is the shape every existing hire
-- door already has for a job whose date has passed (enforce_application_job_state,
-- direct_accept_block_reason refuse `date_needed < CURRENT_DATE`): the app does
-- not book a Helpr into the past. The poster can move the date or time first.
-- A shorter-than-sane window would hand the Helpr an offer that expires before
-- they could read the push.
--
-- Group hires (accept_group_application, restated below from 20261005172453)
-- get the same rule on group_job_helpers.response_deadline: capped at the start,
-- a hire within 15 minutes of it refused, and an expiry the start caused is
-- never a strike (crew pass in expire_unanswered_offers).

CREATE OR REPLACE FUNCTION public.job_offer_cutoff(p_date_needed date, p_start_time time without time zone)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_date_needed IS NULL THEN NULL
    WHEN p_start_time IS NULL THEN ((p_date_needed + 1)::timestamp AT TIME ZONE 'America/Chicago')
    ELSE ((p_date_needed + p_start_time)::timestamp AT TIME ZONE 'America/Chicago')
  END;
$fn$;

REVOKE ALL ON FUNCTION public.job_offer_cutoff(date, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_offer_cutoff(date, time without time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid, p_deadline timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_helper_id uuid;
  v_app_status text;
  v_job_status text;
  v_job_customer uuid;
  v_date_needed date;
  v_start_time time;
  v_cutoff timestamptz;
  v_deadline timestamptz;
BEGIN
  -- Resolve the application and the job it belongs to. The job is
  -- derived from the application itself, so a poster can only ever
  -- accept against a job that application actually belongs to.
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here.
  SELECT j.status, j.customer_id, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- Authorize: only the job's poster may accept an applicant.
  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction. After not_authorized,
  -- so only the job's own poster ever learns this refusal.
  IF public.are_users_blocked(v_helper_id, v_job_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  -- Race guard: the job must still be open. The second of two
  -- concurrent accepts hits this and is rejected.
  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  -- The answer-by time: never past the job's start, never more than 48 h,
  -- and never what a client says alone (header note).
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;
  v_deadline := LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours', v_cutoff);
  IF v_deadline <= now() THEN
    RAISE EXCEPTION 'invalid_deadline';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = v_helper_id,
         response_deadline = v_deadline
   WHERE id = v_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application(uuid, timestamp with time zone, text) TO authenticated, service_role;

-- An answer-by capped at the job's start can be minutes long, so the sweep
-- files no strike when it was the START that ended the window (lh-money-escrow
-- review of this migration, finding 1). Restated from the newest definition,
-- 20261004184021, which is what prod runs (pg_get_functiondef read 2026-10-05);
-- only the locked SELECT and v_no_strike change.
-- Restated from 20261005172453 (crew pass, Q729) plus this migration's cap rule;
-- an earlier draft restated the 20261004184021 body and would have dropped the crew pass.
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
       AND j.status IN ('open', 'accepted')
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
         AND j.status IN ('open', 'accepted')
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
      IF v_cjob.status = 'accepted' AND v_remaining < COALESCE(v_cjob.helpers_needed, 1) THEN
        UPDATE public.jobs SET status = 'open' WHERE id = v_cjob.id;
      END IF;

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_cjob.customer_id,
        'Offer expired — spot reopened',
        'A Helpr you picked didn''t answer in time for "' || COALESCE(v_cjob.title, 'your job')
          || '". Their spot is open to everyone again, so you can pick somebody else.',
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
               THEN '" when the job started, so your spot went back to everyone. No strike.'
               WHEN v_crew_no_strike
               THEN '" before your payout setup and Stripe ID were done, so your spot went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and your spot went back to everyone. Letting an offer expire counts the same as declining it.'
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

-- The same rule when the START moves under a live offer. respond_job_schedule_change
-- moves date_needed/start_time on an `accepted` job, and that includes an offer
-- the Helpr has not answered yet ("They asked to move this to Tue, Oct 6"): a
-- start moved EARLIER than the answer-by time would put it back past the start.
-- Named zzzz_ so it fires LAST among the BEFORE UPDATE triggers: every check
-- above it (the Helpr column whitelist, the hire-columns lock) judges the
-- caller's own write, never this server-side clamp.
CREATE OR REPLACE FUNCTION public.offer_deadline_follows_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.response_deadline IS NOT NULL
     AND NEW.helper_confirmed_at IS NULL
     AND (NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.start_time IS DISTINCT FROM OLD.start_time) THEN
    IF OLD.response_deadline IS NOT NULL
       AND OLD.response_deadline >= public.job_offer_cutoff(OLD.date_needed, OLD.start_time) THEN
      -- The window WAS the old start: it follows the start either way, later
      -- too (a 2 PM job moved to next week must not expire at 2 PM today),
      -- never past 48 h from now (review finding 3).
      NEW.response_deadline := LEAST(public.job_offer_cutoff(NEW.date_needed, NEW.start_time), now() + interval '48 hours');
    ELSE
      NEW.response_deadline := LEAST(NEW.response_deadline, public.job_offer_cutoff(NEW.date_needed, NEW.start_time));
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.offer_deadline_follows_start() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzzz_offer_deadline_follows_start ON public.jobs;
CREATE TRIGGER zzzz_offer_deadline_follows_start
  BEFORE UPDATE OF date_needed, start_time ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.offer_deadline_follows_start();

-- accept_group_application, restated from 20261005172453 with the same cap: a
-- crew member's answer-by never runs past the job's start either (it was the
-- one writer of a non-null response_deadline left unbounded).
CREATE OR REPLACE FUNCTION public.accept_group_application(p_application_id uuid, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS TABLE(slots_filled integer, slots_total integer, roster_complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff        timestamptz;
  v_crew_deadline      timestamptz;
  v_date_needed   date;
  v_start_time    time without time zone;
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
  v_budget        numeric;
  v_slot          int;
BEGIN
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here, which is what makes
  -- the slot count below trustworthy.
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.budget, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_budget, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- 20261005184940: the answer-by never runs past the job's start, so a hire
  -- too close to it would hand the member a window already gone (and a strike
  -- at the next sweep). Refused like accept_application, before any write.
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;

  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction (see accept_application;
  -- are_users_blocked is symmetric, so the argument order does not matter).
  IF public.are_users_blocked(v_job_customer, v_helper_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  IF v_is_group IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_a_group_job';
  END IF;

  -- Defensive: a group job with missing or invalid capacity would let the
  -- roster grow without bound.
  IF v_needed IS NULL OR v_needed < 1 THEN
    RAISE EXCEPTION 'invalid_helpers_needed';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- The lowest free slot, and its frozen share of the budget in cents
  -- (largest remainder; see crew_slot_share_cents). A slot a departed member
  -- left is reused, so the N shares always add up to the budget.
  SELECT min(s) INTO v_slot
    FROM generate_series(0, v_needed - 1) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = v_job_id AND g.slot_no = s);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot. group_job_helpers_award_gate
  -- judges THIS member: award gate and, since 20260925154606, a funded job.
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
  VALUES (v_job_id, v_helper_id, v_slot,
          public.crew_slot_share_cents(round(COALESCE(v_budget, 0) * 100)::bigint, v_needed, v_slot));

  -- Q729 (owner 2026-10-05): the poster's reply deadline is kept for THIS
  -- member; expire_unanswered_offers reopens the spot once it passes unanswered.
  -- Clamped to the shortest deadline the app offers (1 hour, less 5 minutes
  -- of clock skew): a deadline in the past would get the member struck by the
  -- next sweep before they could answer (lh-authz-rls review #1, 2026-10-05).
  -- The answer-by never runs past the job's start (20261005184940), and a NULL
  -- (never expires) is bounded the same way, as accept_application now is.
  v_crew_deadline := LEAST(GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff);
  UPDATE public.group_job_helpers
     SET response_deadline = v_crew_deadline
   WHERE job_id = v_job_id AND slot_no = v_slot;

  v_current := v_current + 1;

  -- A crew has no lead (Q407): jobs.helper_id stays NULL (trg_group_job_has_no_lead),
  -- and the job-level response_deadline, which timed ONE Helpr's reply, is not
  -- written. p_deadline stays in the signature for existing callers.
  UPDATE public.jobs
     SET
         -- Stay 'open' while partially staffed; only the final slot closes it.
         -- The cast is the fix for the one statement that never ran: a CASE of
         -- two bare literals resolves to text, and Postgres will not assign
         -- text to the job_status enum ("column "status" is of type job_status
         -- but expression is of type text"), so every call since 20260804122000
         -- raised here and rolled back (reproduced in PGlite, R0 in
         -- src/test/pglite/groupCrewNoLead.pglite.mjs).
         status = (CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END)::job_status
   WHERE id = v_job_id;

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) TO authenticated, service_role;
