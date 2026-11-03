-- Q2011: when a cancel closes a direct offer, the offered Helpr is told.
--
-- WHAT WAS BROKEN (read live 2026-11-03, Builder 36):
--   * Since Q1891 (20261017134720) a cancel moves a pending direct offer to
--     'withdrawn' (zzz_jobs_cancel_retires_direct_offer), but nobody tells the
--     offered Helpr: notify_on_job_update only writes to OLD.helper_id, which
--     is NULL on an open job. The offer just vanished from their /jobs list.
--     settle_one_off_jobs_for_banned_account already sends an "Offer closed"
--     notice on its own path (it sets 'declined', never 'withdrawn', so it
--     never reaches the new trigger and is never told twice).
--   * An admin or service-role write that moves a cancelled job back to open
--     kept 'withdrawn' + offered_to_helper_id. get_ranked_open_jobs,
--     job_announceable_to and the saved-search paths treat only
--     declined/expired as public and hid it; get_public_open_jobs,
--     get_open_jobs_for_map and instant-job-match showed it.
--   * respond_to_direct_offer on a withdrawn offer answered offer_not_pending
--     ("This offer isn't yours to respond to any more").
--
-- THE FIX (finding: lh-money-escrow@0f26cf3f1#5):
--   1. New AFTER UPDATE OF status trigger zzz_jobs_cancel_tells_offered_helpr:
--      on a pending -> withdrawn move (the cancel trigger's own write) on a
--      job that was open and listed (job_payment_is_listed, the gate the offer
--      notice notify_helper_on_direct_offer uses, so a Helpr never hears about
--      an offer they were never shown), the offered Helpr gets "Offer closed".
--      The words say "by the person who posted it" only when the poster made
--      the cancel (cancelled_by or the caller); a cron or admin cancel reads
--      "was cancelled". An instant booking is skipped (its Helpr was told
--      "You're booked" in its own words and its end has its own notices).
--      One notice per job and Helpr (NOT EXISTS), so a replayed write never
--      repeats it. AFTER, not inside the BEFORE trigger: a notice only for a
--      row that was really written.
--   2. jobs_reopen_retires_direct_offer: live body (md5(prosrc)
--      65b5cba369e2cb335ff36470976498a3 = 20261003214350, read 2026-11-03)
--      plus 'withdrawn' -> 'expired' on a reopen.
--   3. respond_to_direct_offer: live body (md5(prosrc)
--      0164f2e1254e862daf59572dcb48a5b9 = 20261101071621, read 2026-11-03)
--      plus job_not_open for a withdrawn offer on a closed job.
-- jobs_cancel_retires_direct_offer is unchanged (live md5
-- a243f5b266fabbd48e2e510303e21a1d = 20261017134720). No money or payment
-- state changes: one notice, one offer-status mapping, one error code.
-- Grants restated as live: the trigger functions postgres + service_role;
-- respond_to_direct_offer postgres, authenticated, service_role.
--
-- Proof: src/test/pglite/offerClosedOnCancel.pglite.mjs (applied 3x: ALL
-- PASS; NEW_MIGRATION=skip, the live state: FAILs).
-- Guard: src/test/offerClosedOnCancel.test.ts.

CREATE OR REPLACE FUNCTION public.jobs_cancel_tells_offered_helpr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'cancelled'
     AND OLD.status::text = 'open'
     AND OLD.direct_offer_status = 'pending'
     AND NEW.direct_offer_status = 'withdrawn'
     AND NEW.offered_to_helper_id IS NOT NULL
     AND OLD.instant_decline_until IS NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT
      NEW.offered_to_helper_id,
      'Offer closed',
      CASE WHEN (NEW.customer_id IN (NEW.cancelled_by, auth.uid())) IS TRUE
        THEN format('"%s" was cancelled by the person who posted it, so its offer to you is closed.', COALESCE(NEW.title, 'A job'))
        ELSE format('"%s" was cancelled, so its offer to you is closed.', COALESCE(NEW.title, 'A job'))
      END,
      'warning',
      '/jobs?job=' || NEW.id::text,
      NEW.id
     -- Q2093: the Helpr was told about the offer only on a listed job
     -- (notify_helper_on_direct_offer), so only then is its close news.
     WHERE public.job_payment_is_listed(OLD.payment_status)
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = NEW.offered_to_helper_id
            AND n.job_id = NEW.id
            AND n.title = 'Offer closed'
       );
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.jobs_cancel_tells_offered_helpr() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zzz_jobs_cancel_tells_offered_helpr ON public.jobs;
CREATE TRIGGER zzz_jobs_cancel_tells_offered_helpr
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status = 'withdrawn')
  EXECUTE FUNCTION public.jobs_cancel_tells_offered_helpr();

-- Live body (20261003214350) + the 'withdrawn' reopen mapping (Q2011).
CREATE OR REPLACE FUNCTION public.jobs_reopen_retires_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status::text = 'open' AND NEW.helper_id IS NULL AND NEW.direct_offer_status = 'accepted' THEN
    NEW.direct_offer_status := 'expired';
  -- Q2011: a cancelled job moved back to open (an admin or service-role
  -- write) must not carry a 'withdrawn' offer, which the ranked feed, the
  -- announce and saved-search paths hide while the public feed, the map and
  -- instant-job-match show it. 'expired' is what every reader treats as public.
  ELSIF NEW.status::text = 'open' AND NEW.direct_offer_status = 'withdrawn' THEN
    NEW.direct_offer_status := 'expired';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_reopen_retires_direct_offer() FROM PUBLIC, anon, authenticated;

-- Live body (20261101071621) + job_not_open on a withdrawn offer (Q2011).
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_now timestamptz := now();
  v_reason text;
  v_block text;
  v_done jsonb;
  v_pay text;
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id, payment_status
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer, v_pay
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  -- Q2011: an offer withdrawn by its job's cancel answers that the job is
  -- closed ("This job is no longer open."), not "isn't yours to respond to".
  IF v_offer_status = 'withdrawn' AND v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- Q1185 (re-review must-fix A, should-fix B): everything the deferred
    -- completion will check is checked now, so nobody is told "thanks" for an
    -- accept that can never complete.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_block := public.direct_accept_block_reason(p_job_id, auth.uid());
    IF v_block = 'credential_tier_required' THEN
      RAISE EXCEPTION 'credential_tier_required' USING ERRCODE = '42501';
    ELSIF v_block = 'job_date_has_passed' THEN
      RAISE EXCEPTION 'job_date_has_passed' USING ERRCODE = '42501';
    ELSIF v_block = 'job_expired' THEN
      RAISE EXCEPTION 'job_expired' USING ERRCODE = '42501';
    ELSIF v_block = 'job_not_funded' THEN
      RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
    ELSIF v_block = 'account_restricted' THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;

    -- Q1185 (owner, 2026-10-03: "Same as a regular offer"): the accept needs
    -- payout setup and Stripe ID, as accept_job_offer's does. Unready, the
    -- direct offer stays exactly as it is (open, pending, on its own clock,
    -- the poster told nothing) and the yes is remembered in job_accept_pending;
    -- trg_profiles_complete_pending_accepts completes it once both are done.
    v_reason := public.helper_accept_block_reason(auth.uid());
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (p_job_id, auth.uid())
      ON CONFLICT (job_id) DO UPDATE
        SET helper_id = EXCLUDED.helper_id, requested_at = now()
        WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(auth.uid())));
    END IF;

    -- Q2399: a ready Helpr on a held card: create-payment capture_hold charges
    -- the card first (the job moves to escrow), then this accept is retried.
    -- Read under the row lock taken above.
    IF v_pay = 'held' THEN
      RAISE EXCEPTION 'payment_not_captured' USING ERRCODE = '42501';
    END IF;

    -- Ready: the accept completes now, through the one completion both doors
    -- share (the poster is told "<name> accepted your offer"). NULL means it
    -- did not (the offer moved on between the check and the write): an error,
    -- never an answer the app shows as "Job accepted" (final review #4).
    v_done := public.complete_direct_offer_accept(p_job_id, auth.uid());
    IF v_done IS NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN v_done;
  END IF;

  -- CMP-4 (20261101071621): declining an instant booking IS the instant-book
  -- decline: its refusals (the window, a capture in flight) and its words
  -- ("can't make it ... not charged"), never the generic "declined your offer".
  IF EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND instant_decline_until IS NOT NULL) THEN
    RETURN public.rpc_instant_book_decline(p_job_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         -- Q2131: only a funded job is "open to everyone again".
         CASE WHEN public.job_payment_is_listed(payment_status) THEN
           'Your direct offer for "' || title || '" was declined. The job is open to everyone again.'
         ELSE
           'Your direct offer for "' || title || '" was declined.'
         END,
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;

REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated, service_role;
