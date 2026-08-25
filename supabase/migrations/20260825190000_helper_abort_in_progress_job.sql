-- The last missing exit: a helper who CANNOT FINISH a job already underway.
--
-- BEFORE (verified live, 2026-08-25): exits existed at the offer stage
-- (decline_job_offer) and while booked-but-not-started (helper_cancel_booking,
-- 20260824243000). The moment jobs.status became 'in_progress',
-- helper_cancel_booking RAISEs 'job_already_started' and the only remaining
-- control on the helper's card was "Message". Disputes at that stage are
-- poster-initiated. So a helper whose van breaks down mid-job could ghost or
-- DM support — and GHOSTING WAS CHEAPER, because it records no strike while
-- every sanctioned exit does. That inverted incentive is the defect.
--
-- AFTER: helper_abort_job(uuid, text) — one server-owned door with the
-- consequence stated on it, routed into settlement machinery that already
-- exists. It never invents a money movement; at abort time ZERO cents move.
-- Which of the two existing settlement paths a job lands in is decided by
-- whether the helper ever actually showed up:
--
--   A. NO WORK DONE (never arrived, no proof photos, never marked complete)
--      → the job REOPENS: status 'open', helper_id NULL, every confirmation
--        and tracking stamp reset. Byte-for-byte the end state
--        helper_cancel_booking already produces, so it is a state both cards
--        already render and the poster can act on today.
--        MONEY: nothing moves. The poster's captured escrow stays held on the
--        same PaymentIntent, payment_status 'escrow', ready for whoever they
--        pick next. If nobody is picked, `auto-expire-jobs` cancels it once
--        date_needed rolls past and `void-cancelled-payments` refunds — and
--        because helper_id is NULL, computeCancellationFee() returns 0, so the
--        poster is refunded in full (less only the non-refundable service fee
--        / Stripe processing cost that every cancellation withholds). Clearing
--        helper_id is therefore LOAD-BEARING, not tidiness: leaving it set
--        would make the cron read this as a late poster cancellation and
--        capture 25–50% of the poster's budget as a cancellation fee — and
--        pay it to the helper who walked off. Exactly backwards.
--
--   B. WORK WAS ACTUALLY STARTED (arrived, uploaded proof, or already marked
--      complete — i.e. there is a real question of what the poster owes)
--      → the job goes to DISPUTE via the existing rpc_open_dispute, with the
--        helper as opener. helper_id is KEPT (execute-dispute-split refuses a
--        split that awards a share to a job with no helper_id).
--        MONEY: nothing moves now; the captured escrow stays held for the
--        resolver. An admin settles it from the existing AdminDisputes queue
--        (which reads jobs where status='disputed' joined to `disputes`) using
--        the release / refund / partial-split controls already shipped. Every
--        cent of the authorization ends up transferred, refunded, or withheld
--        as the non-refundable fee by execute-dispute-split — the same code
--        path a poster-filed dispute settles through. Nothing is stranded and
--        nothing moves twice.
--        dispute_status is set to 'escalated' DELIBERATELY: `auto-resolve-
--        disputes` auto-releases the full escrow TO THE HELPER when a
--        non-escalated dispute passes its 72h deadline. That default is right
--        for a poster-filed dispute the poster then abandons; it would be
--        obscene here, paying the helper who quit, in full, by timeout. Marking
--        it escalated makes this branch admin-only — the cron only nags admins.
--
-- CONSEQUENCE, in both branches: one strike on the SAME reliability ladder as
-- declining, letting an offer expire, and cancelling a booking
-- (apply_job_denial_consequence — 1st recorded, 2nd final warning, 3rd 7-day
-- suspension, 4th permanent). No new ban semantics. An honest late abort costs
-- exactly what an honest early cancel costs, which is the whole point: the
-- honest path must never be pricier than ghosting.
--
-- Replay-safety: apply_job_denial_consequence (20260824243000) and
-- rpc_open_dispute (20260609140000) both predate this timestamp, so a
-- from-scratch rebuild has them. The REVOKE/GRANT below targets only the
-- function created immediately above it.

CREATE OR REPLACE FUNCTION public.helper_abort_job(
  p_job_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_uid uuid := auth.uid();
  v_reason text;
  v_work_started boolean;
  v_dispute_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required'
      USING HINT = 'Tell the poster why you can''t finish.';
  END IF;
  -- Keep it a sentence, not an essay dumped into a notification body.
  v_reason := left(v_reason, 1000);

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.helper_arrived_at, j.helper_completed_at,
         j.proof_before_urls, j.proof_after_urls
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Server owns the decision: only the ASSIGNED helper, only from a state
  -- this exit is actually for. A poster (or any third party) hitting this
  -- gets not_authorized, not a partial write.
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_abortable'
      USING HINT = 'Only a job that is underway can be abandoned this way.';
  END IF;

  v_work_started :=
        v_job.helper_arrived_at IS NOT NULL
     OR v_job.helper_completed_at IS NOT NULL
     OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
     OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0;

  -- The strike lands first and identically in both branches — the ladder does
  -- not care which settlement path the money takes.
  v_result := public.apply_job_denial_consequence(
    v_uid, v_job.id,
    'Abandoned a job in progress: "' || COALESCE(v_job.title, 'Unknown')
      || '" — ' || v_reason);

  IF v_work_started THEN
    -- ── Branch B: partial work exists → a human decides who gets what. ──
    v_dispute_id := public.rpc_open_dispute(
      v_job.id,
      'Helpr could not finish the job: ' || v_reason,
      '{}'::text[]);

    -- Admin-only from here (see header): never auto-release to the abandoner.
    UPDATE public.jobs
       SET dispute_status = 'escalated'
     WHERE id = v_job.id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Your Helpr couldn''t finish',
      'Your Helpr had to stop work on "' || COALESCE(v_job.title, 'your job')
        || '": ' || v_reason
        || ' Because work had already started, we''re reviewing it — your payment stays in escrow until a decision is made, and you don''t need to do anything.',
      'warning',
      '/my-posts'
    );

    RETURN v_result || jsonb_build_object(
      'outcome', 'disputed',
      'dispute_id', v_dispute_id);
  END IF;

  -- ── Branch A: nothing was done → reopen, no money moves. ──
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = v_uid AND status = 'accepted';

  -- Same clean slate helper_cancel_booking leaves, so the day-of machinery
  -- runs fresh for the next helper rather than inheriting this one's stamps.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         helper_on_the_way_at = NULL,
         helper_arrived_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL,
         revision_requested_at = NULL,
         revision_note = NULL,
         revision_deadline = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr couldn''t finish',
    'Your Helpr had to drop "' || COALESCE(v_job.title, 'your job')
      || '": ' || v_reason
      || ' They never started, so nothing was charged — the job is open to everyone again and your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/my-posts'
  );

  RETURN v_result || jsonb_build_object('outcome', 'reopened');
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_abort_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_abort_job(uuid, text) TO authenticated;
