-- Part 3 message review (owner UI audit 11-09; lead: wording only, no logic changes).
--
-- F196: member notices used back-office words. "Your payout setup and Stripe ID are done" / "before your payout setup
-- and Stripe ID were done" (the accept-on-setup notice and the three offer-lapsed notices) now say "ID check", the
-- word every screen uses; "Message hidden" (a repeated hidden message) said "off-platform contact" and now says what
-- it looked like: "a phone number, email or outside payment. Keep contact and payments in the app."
-- F199: the Declutter seller-fault notice to the buyer was titled "Setup job cancelled, no fee" while its body said the
-- setup fee is kept, and said "(the one-time account setup fee excepted)". Title "Setup job cancelled"; body "...
-- Nothing is owed for it and what you paid for it comes back, except the one-time account setup fee." No money moves
-- differently: the words only.
--
-- Each body below is the LIVE definition: md5(prosrc) on prod 11-09 equals the newest repo definition byte for byte
-- (apply_message_scan_consequence 535fe99f..., complete_pending_accepts_on_setup 11003ee8..., declutter_apply_seller_fault
-- 87d6aa98..., expire_pending_direct_offers 0148e0cd..., expire_unanswered_offers 3fb29ceb...), with ONLY the quoted
-- strings above changed (src/test/messageWordingPart3.test.ts diffs every function against its previous definition and
-- allows string changes only). Headers are pg_get_functiondef's (SECURITY DEFINER, search_path, lock_timeout).
-- Replay-safe: CREATE OR REPLACE; grants restated as live proacl {postgres=X/postgres,service_role=X/postgres}.
-- Proof: src/test/pglite/noticesPlainBackOfficeWords.pglite.mjs (3x replay; --before red).

CREATE OR REPLACE FUNCTION public.complete_pending_accepts_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        record;
  v_poster text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_accept_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force (is_caller_banned's predicate) completes nothing; the
  -- pending row waits and goes when the offer moves on (review #6: in server
  -- context enforce_ban_gate is skipped, so the poster would hear "accepted").
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  -- Q1919: the per-Helpr schedule lock respond_job_schedule_change takes
  -- (complete_direct_offer_accept below takes it too), taken here BEFORE the
  -- FOR UPDATE OF j loop: if it were first taken inside the loop, this
  -- trigger would hold one job plus the lock while the cursor waits for the
  -- next job, which respond_to_direct_offer can hold while it waits for the
  -- lock (a wait cycle). The lock and the loop sit in one block that catches a
  -- deadlock: a wait cycle can still form with a call that holds one of these
  -- jobs and then waits for this lock (respond_to_direct_offer on a job the
  -- cursor also wants, or respond_job_schedule_change on a booked job awaiting
  -- this Helpr's setup), and the deadlock error used to roll back the Stripe
  -- status write this trigger runs inside. Now that write is kept, the
  -- pending accepts wait (completed by the next Stripe update of this row, as
  -- a failed one below is), and the miss is logged.
  BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || NEW.user_id::text));
  FOR r IN
    -- seed: a seed job, or a seed/test Helpr (detect_stuck_payments' rule)
    SELECT p.job_id, j.title, j.customer_id,
           coalesce(j.is_seed OR NEW.is_seed, false) AS seed,
           (j.status = 'open') AS direct
      FROM public.job_accept_pending p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
       AND (  -- a Hire's offer (Q1180)
              (j.status = 'accepted' AND j.helper_id = p.helper_id)
              -- a direct offer still live and still this Helpr's (Q1185)
           OR (j.status = 'open' AND j.helper_id IS NULL
               AND j.offered_to_helper_id = p.helper_id
               AND j.direct_offer_status = 'pending'
               AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at >= now())
               -- anything that would refuse it now (a block, the date passing, a
               -- tier, a ban): completes nothing, logs nothing
               AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL))
     ORDER BY p.requested_at
       FOR UPDATE OF j
  LOOP
    -- One job that cannot complete never rolls back the Stripe status write
    -- this trigger runs inside (review #3; settle_one_off_jobs_for_banned_account's
    -- pattern): it is logged, and the rest still complete.
    BEGIN
      -- (parenthesised: plpgsql's IF reads its condition up to the first THEN)
      IF (CASE WHEN r.direct THEN public.complete_direct_offer_accept(r.job_id, NEW.user_id) IS NOT NULL
               ELSE public.complete_job_accept(r.job_id) END) THEN
        SELECT public.member_display_name(pp.full_name, 'the person who posted it') INTO v_poster
          FROM public.profiles pp WHERE pp.user_id = r.customer_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your payout setup and ID check are done, so you''ve accepted "' || COALESCE(r.title, 'the job')
            || '", and ' || COALESCE(v_poster, 'the person who posted it') || ' has been told.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E job logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN r.seed THEN 'info' ELSE 'error' END,
        'pending accept completion failed',
        jsonb_build_object('source', 'complete_pending_accepts_on_setup' || CASE WHEN r.seed THEN '-seed' ELSE '' END,
                           'seed', r.seed, 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  EXCEPTION WHEN deadlock_detected THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN coalesce(NEW.is_seed, false) THEN 'info' ELSE 'error' END,
      'pending accept completion deadlocked',
      jsonb_build_object('source', 'complete_pending_accepts_on_setup' || CASE WHEN coalesce(NEW.is_seed, false) THEN '-seed' ELSE '' END,
                         'seed', coalesce(NEW.is_seed, false), 'user_id', NEW.user_id::text),
      jsonb_build_object('user_id', NEW.user_id, 'helper_id', NEW.user_id,
                         'pending_count', (SELECT count(*) FROM public.job_accept_pending p WHERE p.helper_id = NEW.user_id),
                         'err', SQLERRM, 'sqlstate', SQLSTATE)
    );
  END;
  RETURN NULL;
END;
$function$
;

REVOKE ALL ON FUNCTION public.complete_pending_accepts_on_setup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_accepts_on_setup() TO service_role;

CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
       -- Q1891: only an offer on a job still open lapses into "open to
       -- everyone". A cancelled job's offer is retired by the cancel itself.
       AND status::text = 'open'
       -- An unfunded offer was never shown to anyone, so it cannot lapse; its
       -- window starts when the money arrives (owner, 2026-10-17).
       AND public.job_payment_is_listed(payment_status)
    RETURNING id, customer_id, title, date_needed, date_window_end, start_time
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now open to everyone.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
       -- Past the start cutoff the job is not "open to everyone" in any
       -- useful sense (money that landed late, delta review #3): it lapses
       -- quietly.
       AND (date_needed IS NULL
            OR public.job_offer_cutoff(COALESCE(date_window_end, date_needed), start_time) > now())
    RETURNING 1
  ), told AS (
    -- Q1185 (re-review should-fix C): a Helpr who said yes while their setup
    -- was unfinished hears the offer lapsed, with no strike, as a regular
    -- offer's Helpr does (expire_unanswered_offers). The statement's snapshot
    -- still holds the pending rows trg_jobs_clear_accept_pending removes.
    -- Setup can be done and the accept still not complete (the job's date
    -- passed, a block): the copy says which (final review #3).
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT p.helper_id,
           'You lost a job offer',
           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL
                THEN 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your payout setup and ID check were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
                ELSE 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your accept could be completed, so it went back to everyone. No strike.'
           END,
           'expired',
           '/jobs?job=' || e.id::text,
           e.id
      FROM expired e
      JOIN public.job_accept_pending p ON p.job_id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$
;

REVOKE ALL ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_direct_offers() TO service_role;

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
  v_too_late boolean;
  v_crew_cap boolean;
  v_crew_too_late boolean;
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
      SELECT j.id, j.title, j.customer_id, j.helper_id, j.response_deadline, j.date_needed, j.start_time, j.payment_status
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
      -- Q1889: accept_application's own rule. Past it, nobody else can be hired for this start.
      v_too_late := public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time) <= now() + interval '15 minutes';
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
      -- A failed payment (the card hold could not be charged): the Helpr did nothing wrong, often
      -- tapped Accept, and the job is off the list until the poster pays again, so neither
      -- "didn't answer" nor "open to everyone" would be true (job 02a6e1b5, 2026-10-30).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.customer_id,
        CASE WHEN v_locked.payment_status = 'failed'
             THEN 'Offer expired — payment needed'
             WHEN v_too_late
             THEN 'Offer expired'
             ELSE 'Offer expired — job reopened' END,
        CASE WHEN v_locked.payment_status = 'failed'
             THEN 'Your payment for "' || COALESCE(v_locked.title, 'your job')
                    || '" didn''t go through before the offer ran out, so nobody was hired. Open the job to pay again.'
             WHEN v_too_late
             THEN 'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
                    || '", and it''s now too late to hire someone else for that time.'
             ELSE 'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
                    || '". It''s open to everyone again, so you can pick somebody else.'
        END,
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
               WHEN v_locked.payment_status = 'failed'
               THEN '" while it was waiting on payment from the person who posted it, so the offer closed. No strike.'
               WHEN v_setup_unfinished
               THEN '" before your payout setup and ID check were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
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
      SELECT j.id, j.title, j.customer_id, j.status::text AS status, j.helpers_needed, j.payment_status
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
      -- Q1889: the same cutoff rule as the single offer; past it, nobody can fill the spot.
      v_crew_too_late := public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time) <= now() + interval '15 minutes';
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
        CASE WHEN v_cjob.payment_status = 'failed'
             THEN 'Offer expired — payment needed'
             WHEN v_crew_too_late
             THEN 'Offer expired'
             ELSE 'Offer expired — spot reopened' END,
        CASE WHEN v_cjob.payment_status = 'failed'
             THEN 'Your payment for "' || COALESCE(v_cjob.title, 'your job')
                    || '" didn''t go through before a Helpr''s offer ran out, so they weren''t confirmed. Open the job to pay again'
             -- Q2331 (owner 2026-11-03): say who, "Bea T. didn't answer in time"; the role words only for a blank name.
             ELSE public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = v_slot.helper_id), 'A Helpr you picked')
                    || ' didn''t answer in time for "' || COALESCE(v_cjob.title, 'your job') END
          || CASE WHEN v_cjob.payment_status = 'failed' THEN '.'
               WHEN v_cjob.status = 'in_progress' AND v_remaining > 0
               THEN '". The rest of your crew is still on, and that spot''s share is refunded to you once the job is done.'
               WHEN v_crew_too_late AND v_remaining > 0
               THEN '". The rest of your crew is still on. It''s now too late to fill that spot for that time, so that spot''s share is refunded to you once the job is done.'
               WHEN v_crew_too_late
               THEN '". It''s now too late to fill that spot for that time.'
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
               WHEN v_cjob.payment_status = 'failed'
               THEN '" while it was waiting on payment from the person who posted it, so you lost your spot. No strike.'
               WHEN v_crew_setup_unfinished
               THEN '" before your payout setup and ID check were done, so you lost your spot. No strike. Finish both so you can accept the next offer.'
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
$function$
;

REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.apply_message_scan_consequence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := COALESCE(NEW.flag_reason, 'Off-platform contact detected');
  v_result jsonb;
BEGIN
  -- Evidence trail, unchanged in shape and column set so anything already
  -- reading fraud_flags keeps working.
  INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
  VALUES (NEW.sender_id, 'off_platform_contact',
    v_reason || ' — message: ' || left(NEW.content, 200),
    NEW.job_id);

  -- The ladder acts on auth.uid(), and the messages INSERT policy already
  -- guarantees auth.uid() = sender_id. Re-checked rather than assumed: a
  -- service-role or console write records the evidence and escalates NOBODY.
  IF auth.uid() IS NULL OR auth.uid() <> NEW.sender_id THEN
    RETURN NULL;
  END IF;

  v_result := public.message_violation_ladder(v_reason, NEW.content, true);

  -- The ladder speaks for itself on a first, second or third strike. It stays
  -- silent only on 'duplicate' (this exact message inside 24h), so cover that
  -- one case here. Exactly one notification per hidden message, either way.
  IF v_result->>'action' = 'duplicate' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.sender_id, 'Message hidden',
      'Your message was hidden because it looked like a phone number, email or outside payment. Keep contact and payments in the app. Repeated attempts can lead to a temporary restriction.',
      'warning', '/profile?tab=warnings');
  END IF;

  RETURN NULL;  -- AFTER trigger: the return value is ignored.
END;
$function$
;

REVOKE ALL ON FUNCTION public.apply_message_scan_consequence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_message_scan_consequence() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  rf public.declutter_refunds;
  r record;
  j record;
  v_n integer := 0;
  v_src text;
  v_prev text := COALESCE(current_setting('app.sanctioned_cancel', true), 'off');
  -- The words for what the seller did (review #7): one phrase, every notice.
  v_why text;
BEGIN
  SELECT * INTO rf FROM public.declutter_refunds x WHERE x.id = p_refund_id;
  IF NOT FOUND OR rf.fee_policy IS DISTINCT FROM 'full_seller_pays_fee' THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  v_src := 'declutter_apply_seller_fault' || CASE WHEN rf.is_seed THEN '-seed' ELSE '' END;
  IF rf.order_id IS NULL THEN
    -- The order is gone (an account deletion): its links can no longer be
    -- found from the refund; say so instead of answering 0 (lh-silent-failure
    -- re-review of 24b71630a R2).
    RAISE EXCEPTION 'order_gone' USING ERRCODE = 'P0002',
      HINT = 'The refund''s order was deleted: settle its setup jobs by hand.';
  END IF;
  v_why := CASE rf.reason
    WHEN 'seller_no_show' THEN 'the seller did not show up for the pickup'
    WHEN 'not_as_described' THEN 'the item was not as described'
    WHEN 'seller_out' THEN 'the seller can no longer sell'
    ELSE 'the seller backed out' END;
  BEGIN
  FOR r IN
    SELECT l.job_id FROM public.declutter_order_jobs l
     WHERE l.order_id = rf.order_id AND l.purpose = 'setup' AND l.seller_fault_refund_id IS NULL
     ORDER BY l.job_id
  LOOP
    BEGIN
      SELECT jb.id, jb.title, jb.status::text AS status, jb.helper_id, jb.customer_id, jb.helper_completed_at,
             COALESCE(jb.is_group_job, false) AS crew,
             (jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL) AS committed
             , COALESCE(jb.payment_status::text, 'unpaid') AS pay
             -- Q1938: void-cancelled-payments pays a committed Helpr the jobs late-cancel fee on this cancel
             -- (computeCancellationFee: committed, a budget, and the ladder's percent at the cancel time, now()).
             , (jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL AND COALESCE(jb.budget, 0) > 0
                AND jb.date_needed IS NOT NULL
                AND public.cancellation_fee_percent(true, public.job_hours_until_start(jb.date_needed, jb.start_time, now())) > 0) AS paid_for_time
        INTO j FROM public.jobs jb WHERE jb.id = r.job_id FOR UPDATE;
      IF NOT FOUND OR j.status IN ('cancelled', 'completed') THEN
        CONTINUE;
      END IF;
      IF j.status NOT IN ('open', 'accepted', 'in_progress', 'revision_requested')
         OR j.helper_completed_at IS NOT NULL THEN
        -- Done, disputed or awaiting approval for an item the seller failed to
        -- deliver: worth a look, never a silent skip (review #6).
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (%s%s) of seller-fault Declutter refund %s was left as it is: an admin decides', r.job_id, j.status,
                 CASE WHEN j.helper_completed_at IS NOT NULL THEN ', marked done' ELSE '' END, rf.id));
        CONTINUE;
      END IF;
      -- Only a job whose money is at rest (never paid, or held in escrow): one
      -- mid-cancel ('cancelling'), in a chargeback or anything else is left
      -- for an admin (lh-money-escrow review of c57d948d0 #7).
      IF j.pay NOT IN ('unpaid', 'abandoned', 'failed', 'escrow') THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (payment %s) of seller-fault Declutter refund %s was not cancelled: an admin decides', r.job_id, j.pay, rf.id));
        CONTINUE;
      END IF;
      IF j.crew THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('crew setup job %s of seller-fault Declutter refund %s was not cancelled (a crew''s fee ledger is per member): settle it by hand (no fee, card fee to the seller)', r.job_id, rf.id));
        CONTINUE;
      END IF;
      IF rf.reason = 'seller_no_show' AND j.committed AND NOT p_include_committed THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s has a committed Helpr and its Declutter order was refunded on the buyer''s seller-no-show report (refund %s): not cancelled; normal job rules apply unless an admin runs declutter_admin_apply_seller_fault(%s, true)', r.job_id, rf.id, rf.id));
        -- The buyer is told it is still booked and being looked at (re-review note).
        PERFORM public.declutter_notify(j.customer_id, 'info', 'Your Helpr job is still booked',
          format('Your Declutter order was refunded, but "%s" still has a Helpr booked. We are reviewing it; until then the normal job rules apply.', COALESCE(j.title, 'your setup job')),
          '/jobs?job=' || r.job_id::text);
        CONTINUE;
      END IF;
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.declutter_seller_fault_cancel', 'on', true);
      UPDATE public.jobs
         SET status = 'cancelled',
             cancelled_by = NULL,
             cancelled_at = now(),
             cancellation_reason = format('On the Declutter order this job was booked for, %s, so it was cancelled with no fee.', v_why),
             late_cancellation = false,
             cancellation_fee = 0,
             cancellation_fee_status = NULL
       WHERE id = r.job_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'setup_job_not_cancelled' USING ERRCODE = '55000';
      END IF;
      PERFORM set_config('app.declutter_seller_fault_cancel', 'off', true);
      PERFORM set_config('app.sanctioned_cancel', v_prev, true);
      UPDATE public.declutter_order_jobs
         SET seller_fault_refund_id = rf.id, seller_fault_at = now()
       WHERE job_id = r.job_id AND seller_fault_refund_id IS NULL;
      v_n := v_n + 1;
      PERFORM public.declutter_notify(j.customer_id, 'info', 'Setup job cancelled',
        format('On your Declutter order, %s, so "%s" was cancelled. Nothing is owed for it and what you paid for it comes back, except the one-time account setup fee.', v_why, COALESCE(j.title, 'your setup job')),
        '/jobs?job=' || r.job_id::text);
      -- Q1938 (lead 11-03): a Helpr who is paid for their time is told so; otherwise a neutral line, no fee words.
      PERFORM public.declutter_notify(j.helper_id, 'warning', 'Job cancelled',
        CASE WHEN j.paid_for_time
          THEN format('"%s" was cancelled: on the Declutter order it was booked for, %s. The seller cancelled, so you''ll be paid for your time.', COALESCE(j.title, 'A job'), v_why)
          ELSE format('"%s" was cancelled: on the Declutter order it was booked for, %s. It was not the poster''s choice.', COALESCE(j.title, 'A job'), v_why)
        END,
        '/jobs?job=' || r.job_id::text);
    EXCEPTION WHEN OTHERS THEN
      -- The refund must land: record why this setup job was not cancelled.
      PERFORM public.log_cron_defect(v_src, r.job_id::text,
        format('could not cancel setup job %s of seller-fault Declutter refund %s: %s (%s); retry with declutter_admin_apply_seller_fault(%s)', r.job_id, rf.id, SQLERRM, SQLSTATE, rf.id));
    END;
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Even the list of linked jobs could not be read: the refund still lands.
    PERFORM public.log_cron_defect(v_src, rf.id::text,
      format('could not read the setup jobs of seller-fault Declutter refund %s: %s (%s)', rf.id, SQLERRM, SQLSTATE));
  END;
  RETURN v_n;
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) TO service_role;
