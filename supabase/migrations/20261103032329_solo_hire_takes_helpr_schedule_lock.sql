-- Q1919 part 2 (lh-authz-rls@78c205c37#1; part 1, 20261103025348, did the
-- crew seat): a solo hire made at the same moment as a schedule-change accept
-- for the same Helpr could double-book them with nobody told.
--
-- respond_job_schedule_change re-checks the Helpr's bookings under
-- pg_advisory_xact_lock(hashtext('helpr_schedule:' || helper)). The solo hire
-- writers took no such lock, so under READ COMMITTED neither saw the other's
-- uncommitted row: the schedule change found no clash and moved the job, and
-- the hire's clash notice found the old time. Both committed; the Helpr was
-- booked twice and nobody was told.
--
-- Fix: every function that books a Helpr onto a job (sets jobs.helper_id with
-- status 'accepted') takes the same lock before its booking write. This file:
-- accept_application, complete_direct_offer_accept, and the
-- complete_pending_accepts_on_setup trigger that calls it in a loop.
-- claim_series_dates is 20261103032330. The two now take turns, and the
-- second one's statements run on a fresh snapshot and see the first's commit.
--
-- Lock order, per function (respond_job_schedule_change: its job row, booked
-- to Helpr H, then the lock for H, then FOR SHARE on H's other booked jobs and
-- on crew jobs H has a seat on):
--   accept_application: the lock after the application read and BEFORE the
--     job FOR UPDATE, with no row held. The job is open (job_not_open
--     otherwise), so respond never holds it. accept_application_at_suggested_time
--     calls this while already holding that open job: still no cycle with
--     respond, for the same reason.
--   complete_direct_offer_accept: the lock right AFTER its job FOR UPDATE,
--     which every caller already holds (respond_to_direct_offer, the
--     quote_job_funded_hires_quoter trigger, complete_pending_accepts_on_setup),
--     so it cannot come first. That job is open with no Helpr, so respond
--     never holds it or waits for it.
--   complete_pending_accepts_on_setup: the lock BEFORE its FOR UPDATE OF j
--     loop, so the cursor never holds a job plus the lock while it waits for
--     the next job. A cycle can still form with a call that holds a job the
--     cursor wants and then waits for this lock (respond_to_direct_offer on the
--     same offer, or respond_job_schedule_change on a booked job awaiting this
--     Helpr's setup), so the lock and the loop sit in one block that catches a
--     deadlock: the Stripe status write this trigger runs inside is never
--     rolled back by it, the pending accepts wait for the next Stripe update,
--     and the miss goes to error_logs.
--
-- Restated VERBATIM from live prod (pg_proc.prosrc read 2026-11-02):
--   accept_application                 md5 0473ebcf1148403cd44e2909a5b4fe25 = 20261007032040
--   complete_direct_offer_accept       md5 f0ef4ff0284dbd5b5994e5ae3ef96731 = 20261027185146
--   complete_pending_accepts_on_setup  md5 31545eabc312ed40a172396eae8b7974 = 20261021061341
-- The only changes are the PERFORMs, their comments, and the deadlock block
-- in the trigger. Grants restated as prod has them (proacl read 2026-11-02).
-- Proof: src/test/pglite/soloHireTakesHelprScheduleLock.pglite.mjs.
-- Guard: src/test/crewSeatTakesHelprScheduleLock.test.ts.

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

  -- Q1919: the per-Helpr schedule lock respond_job_schedule_change takes, so
  -- this hire and a schedule change for the same Helpr take turns: whichever
  -- runs second sees the other's committed booking (the schedule change then
  -- declines as a clash; this hire's clash notice then fires). Taken BEFORE
  -- the job row below, with no row held: respond_job_schedule_change waits for
  -- it only while holding a job that is booked to this Helpr, and this job is
  -- still open (refused below otherwise), so it never holds this row.
  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_helper_id::text));

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
  -- Q1391: never sooner than the shortest window the app offers (1 hour,
  -- less 5 minutes of clock skew), as accept_group_application already does
  -- (20261005172453). A deadline minutes ahead was stored as sent, and
  -- expire_unanswered_offers then ended the offer before the Helpr could read
  -- the push. The job's start still wins: a job starting sooner keeps its
  -- start as the answer-by (and a lapse the start caused is never a strike).
  v_deadline := LEAST(
    GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'),
    v_cutoff);
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

CREATE OR REPLACE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_customer uuid;
  v_pay text;
  v_app_id   uuid;
BEGIN
  -- Locked here too (both callers already hold it; re-taking it is free), so
  -- this function is race-safe on its own reading (scripts/check-race-class.mjs).
  SELECT j.customer_id, j.payment_status INTO v_customer, v_pay FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  -- Q1919: the per-Helpr schedule lock respond_job_schedule_change takes, so
  -- this hire and a schedule change for the same Helpr take turns (the second
  -- sees the first's committed booking). Taken right after the job row, which
  -- every caller already holds (respond_to_direct_offer, the
  -- quote_job_funded_hires_quoter trigger, complete_pending_accepts_on_setup),
  -- so it cannot come first. No wait cycle with respond_job_schedule_change:
  -- that job is open with no Helpr on it (the UPDATE below requires it), and
  -- respond_job_schedule_change waits for this lock only while holding a job
  -- booked to this Helpr and locks only such jobs (or a crew job they have a
  -- seat on) after it.
  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || p_helper::text));
  IF public.are_users_blocked(p_helper, v_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  -- Everything else the applications gates would have refused in a user
  -- session, checked here because this runs in a server context too.
  IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- ID once (owner 2026-10-20): payout setup and the identity rule, from the
  -- one helper every accept reads. Every caller already asked it
  -- (respond_to_direct_offer, quote_job_funded_hires_quoter,
  -- complete_pending_accepts_on_setup); asked again here so no future caller
  -- can book an unready Helpr through this completion.
  IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Q2399: a card hold is never a hire. direct_accept_block_reason lets a
  -- held job's offer be answered; it completes only once capture_hold (or the
  -- card-hold sweep) has charged the card and moved the job to escrow. Read
  -- under the row lock taken above.
  IF v_pay = 'held' THEN
    RETURN NULL;
  END IF;

  -- The real applications row the synthetic 'direct-<id>' card stood in for.
  -- ON CONFLICT covers a Helpr who also applied before the offer landed.
  INSERT INTO public.applications (job_id, helper_id, message, status)
  VALUES (p_job_id, p_helper, NULL, 'accepted')
  ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
  RETURNING id INTO v_app_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = p_helper,
         direct_offer_status = 'accepted',
         response_deadline = NULL,
         direct_offer_expires_at = NULL
   WHERE id = p_job_id
     AND status = 'open'
     AND helper_id IS NULL
     AND offered_to_helper_id = p_helper
     AND direct_offer_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_active';  -- undoes the applications row above
  END IF;

  IF NOT public.complete_job_accept(p_job_id) THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_pending_accepts_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
          'Your payout setup and Stripe ID are done, so you''ve accepted "' || COALESCE(r.title, 'the job')
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
$fn$;
REVOKE ALL ON FUNCTION public.complete_pending_accepts_on_setup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_accepts_on_setup() TO service_role;
