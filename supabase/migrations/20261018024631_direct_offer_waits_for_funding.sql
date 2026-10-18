-- The owner's rule (2026-10-17): "The job shouldn't post until the money is
-- paid." A direct offer is a post addressed to one Helpr, so until the job's
-- money has arrived (job_payment_is_funded: escrow, payout_pending, released)
-- the offered Helpr is neither told about it nor shown it.
--
-- MEASURED ON PROD 2026-10-17 22:35Z (read-only SQL): 68 jobs carry an
-- offered_to_helper_id and all 68 are unfunded (all seed); 36 "You got a
-- direct job offer!" notifications exist and all 36 point at an unfunded job.
-- A bank (ACH) checkout completes days before the money settles
-- (checkoutSessionCompleted leaves payment_status 'unpaid' until
-- payment_intent.succeeded), so a real bank-paid offer would have told the
-- Helpr about a job that might never be paid for.
--
-- (1) notify_helper_on_direct_offer fires once the job is funded, and then
--     exactly once per funding: on INSERT of an already-funded offer, on the
--     UPDATE that moves payment_status from unfunded to funded, or when a
--     funded job's offer moves to a new Helpr. The trigger now also listens
--     to payment_status.
-- (2) get_my_pending_direct_offers lists only offers on funded jobs.
-- (3) expire_pending_direct_offers leaves an unfunded offer alone. Its clock
--     ran from the INSERT (the poster's 1/2/4/8 h, jobSubmitHelpers), so a bank
--     payment (up to 4 business days) always outlived it, and the sweep told
--     the poster "The job is now open to everyone" about a job nobody could
--     see: a notice about an unpaid job.
-- (4) The offer's window starts when the money arrives: a BEFORE trigger on
--     the funding UPDATE moves direct_offer_expires_at to now() plus the
--     window the poster picked (expires_at - created_at, floored at 55
--     minutes like Q1391's hire deadline). Funding is written only by the
--     server (service_role webhook, definer RPCs: enforce_poster_jobs_money_lock),
--     and this trigger sorts after trg_hire_columns_rpc_only, so the
--     client-write lock on direct_offer_expires_at never sees it.
--
-- Each body is the newest one in the migrations (expire_pending_direct_offers:
-- 20261017134720, Q1891) with only the funding gate added. Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     -- No notice for a job whose money has not arrived (owner, 2026-10-17).
     AND public.job_payment_is_funded(NEW.payment_status)
     -- Only a live job's offer is news (review #4: not a pending_approval or
     -- cancelled row).
     AND NEW.status::text = 'open'
     -- Money that arrives after the job's start cutoff cannot be answered in
     -- time: no notice about an offer nobody can accept (review #3).
     AND (NEW.date_needed IS NULL
          OR public.job_offer_cutoff(NEW.date_needed, NEW.start_time) > now())
     AND (
       TG_OP = 'INSERT'
       -- The money just arrived for the FIRST time: the notice that waited
       -- for it goes out now. "Never paid" is the set a job leaves only when
       -- money arrives (NULL, unpaid, abandoned, failed), NOT "anything not
       -- funded": escrow -> cancelling -> escrow (cancel_escrow putting a
       -- cancel claim back) is the same money, already announced (review #2).
       OR OLD.payment_status IS NULL
       OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed')
       -- A funded job's offer moved to a different Helpr.
       OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id
     )
  THEN
    SELECT COALESCE(full_name, 'Someone') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helper_on_direct_offer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_helper_on_direct_offer() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_helper_on_direct_offer ON public.jobs;
CREATE TRIGGER trg_notify_helper_on_direct_offer
  AFTER INSERT OR UPDATE OF offered_to_helper_id, payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_direct_offer();

CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
           )
         ) AS rec
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
    -- An offer on a job whose money has not arrived is not an offer yet
    -- (owner, 2026-10-17).
    AND public.job_payment_is_funded(j.payment_status)
  ORDER BY j.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated, service_role;

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
       AND public.job_payment_is_funded(payment_status)
    RETURNING id, customer_id, title, date_needed, start_time
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
            OR public.job_offer_cutoff(date_needed, start_time) > now())
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
                       || '" expired before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
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
$function$;

REVOKE ALL ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_direct_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.restart_direct_offer_clock_on_funding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.direct_offer_status = 'pending'
     AND NEW.direct_offer_expires_at IS NOT NULL
     AND public.job_payment_is_funded(NEW.payment_status)
     -- First arrival of the money only (review #2): a cancel claim put back
     -- (escrow -> cancelling -> escrow) keeps the window already running.
     AND (OLD.payment_status IS NULL
          OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed'))
  THEN
    -- Never past the job's start cutoff (review #3); LEAST ignores the NULL
    -- cutoff of a job with no date.
    NEW.direct_offer_expires_at := LEAST(
      now() + GREATEST(
        OLD.direct_offer_expires_at - OLD.created_at,
        interval '55 minutes'
      ),
      public.job_offer_cutoff(NEW.date_needed, NEW.start_time)
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.restart_direct_offer_clock_on_funding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_direct_offer_clock_on_funding() TO service_role;

DROP TRIGGER IF EXISTS trg_restart_direct_offer_clock_on_funding ON public.jobs;
CREATE TRIGGER trg_restart_direct_offer_clock_on_funding
  BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.restart_direct_offer_clock_on_funding();
