-- Q2604 (Jobs audit 1102b row 18, 11-01 JA-49): a poster with an offer out had
-- no way to take it back short of cancelling the whole job. This adds the
-- poster's Withdraw offer: the mirror of the offer running out
-- (expire_unanswered_offers, newest 20261030232108; expire_pending_direct_offers,
-- newest 20261027185146), for one job, by its poster, now.
--
-- WHAT IT ENDS. One unanswered offer on a one-person job:
--   * a Hire's offer: status 'accepted', the Helpr named, not confirmed. The
--     job reopens exactly as the expiry reopens it (status 'open', helper_id and
--     response_deadline cleared) and the Helpr's application closes as
--     'rejected' / closed_reason 'offer_withdrawn' (new value below), so their
--     card says the offer was withdrawn, never "You weren't picked".
--   * a direct offer (an instant booking among them): open, offered to them,
--     pending. The offer is cleared, not marked 'declined' or 'expired' (as
--     rpc_instant_book_decline clears it): record_backout_notice would tell the
--     poster about their own act. instant_decline_until is cleared too, so
--     card-hold-sweep's instant-booking pass no longer matches the job.
-- A crew (is_group_job) is refused: its members are seats on a roster, not one
-- offer. A pending accept (job_accept_pending) ends with the offer and is
-- deleted here explicitly, as rpc_instant_book_decline does: the trigger
-- trg_jobs_clear_accept_pending does NOT remove a Hire's pending accept when
-- the job reopens (its direct-offer arm compares NULL offered_to_helper_id,
-- so NOT (false OR NULL) is NULL and the row stays; measured in the PGlite proof).
--
-- THE MONEY. Nothing moves. The card hold (or the money paid at post) belongs
-- to the JOB, not to the offer: the expiry leaves it in place and the job is
-- listed again, and so does this. A held card stays held for whoever is hired
-- next; card-hold-sweep renews or releases it on its own rules, and a later
-- cancel releases it as today. What must never happen is a withdraw racing the
-- Helpr's own Accept, which captures the held card BEFORE the hire completes
-- (create-payment capture_hold; card-hold-sweep for a pending accept):
--   * the hold row is locked after the job, as a capture's claim writes it
--     (rpc_instant_book_decline's rule). A claim committed first is seen here
--     ('capturing') and the withdraw is refused, nothing changed; a claim after
--     this commit re-reads the job and gives itself back (captureCardHold
--     offerTo / hireOf), so nothing is charged.
--   * a hold captured in the last 30 minutes (card-hold-sweep's
--     CAPTURED_UNHIRED_GRACE_MS) on a job whose offer is still unanswered is the
--     moment between the capture and the hire: refused too, so the charge is
--     never left with nobody hired by this withdraw.
-- In both refusals the poster reads "<Helpr> is accepting right now".
--
-- Replay-safe: DROP/ADD CONSTRAINT, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/posterWithdrawsAnOffer.pglite.mjs (NEW_MIGRATION=skip
-- is red; PLANT=<name> turns its checks red). Guard:
-- src/test/posterWithdrawOffer.test.ts.

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_closed_reason_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_closed_reason_check
  CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed', 'no_show', 'helper_cancelled', 'offer_withdrawn'));

CREATE OR REPLACE FUNCTION public.rpc_poster_withdraw_offer(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_hold record;
  v_helpr uuid;
  v_kind text;
  v_listed boolean;
  v_poster text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.customer_id, j.title, j.status::text AS status, j.helper_id, j.helper_confirmed_at,
         j.offered_to_helper_id, j.direct_offer_status, j.is_group_job, j.payment_status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  -- One refusal for "no such job" and "not yours": a stranger learns nothing.
  IF NOT FOUND OR v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_job' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'group_job_not_supported' USING ERRCODE = '22023';
  END IF;

  IF v_job.status = 'accepted' AND v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NULL THEN
    v_kind := 'offer';
    v_helpr := v_job.helper_id;
  ELSIF v_job.status = 'open' AND v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending' THEN
    v_kind := 'direct';
    v_helpr := v_job.offered_to_helper_id;
  ELSE
    RAISE EXCEPTION 'offer_not_active' USING ERRCODE = '22023';
  END IF;

  -- The hold, locked after the job (header: THE MONEY).
  SELECT h.state, h.updated_at INTO v_hold
    FROM public.job_card_holds h
   WHERE h.job_id = p_job_id
   FOR UPDATE;
  IF FOUND AND (v_hold.state = 'capturing'
                OR (v_hold.state = 'captured' AND v_hold.updated_at > now() - interval '30 minutes')) THEN
    RAISE EXCEPTION 'offer_being_accepted' USING ERRCODE = '55006';
  END IF;

  v_listed := public.job_payment_is_listed(v_job.payment_status);

  IF v_kind = 'offer' THEN
    UPDATE public.applications
       SET status = 'rejected', closed_reason = 'offer_withdrawn'
     WHERE job_id = p_job_id AND helper_id = v_helpr AND status = 'accepted';
    -- record_backout_notice files nothing: auth.uid() is the poster (A2-B15).
    UPDATE public.jobs
       SET status = 'open',
           helper_id = NULL,
           response_deadline = NULL
     WHERE id = p_job_id;
    DELETE FROM public.job_accept_pending WHERE job_id = p_job_id;
  ELSE
    UPDATE public.jobs
       SET offered_to_helper_id = NULL,
           direct_offer_status = NULL,
           direct_offer_expires_at = NULL,
           instant_decline_until = NULL
     WHERE id = p_job_id;
    DELETE FROM public.job_accept_pending WHERE job_id = p_job_id;
  END IF;

  -- The Helpr is told when the offer was ever shown to them: a direct offer on
  -- a job whose money never arrived was not (get_my_pending_direct_offers).
  IF v_kind = 'offer' OR v_listed THEN
    SELECT NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), '') INTO v_poster
      FROM public.profiles p WHERE p.user_id = v_uid;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (v_helpr,
            'Offer withdrawn',
            COALESCE(v_poster, 'The person who posted it') || ' withdrew the offer for "' || COALESCE(v_job.title, 'a job')
              || '". Nothing is owed and no strike.',
            'job_updates',
            '/jobs?job=' || p_job_id::text,
            p_job_id);
  END IF;

  RETURN jsonb_build_object('kind', v_kind, 'open_to_everyone', v_listed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_poster_withdraw_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_poster_withdraw_offer(uuid) TO authenticated;
