-- Q2116 HIGH (lh-money-escrow review of 28a5ed3d7, must-fix 2; re-scoped
-- against train J): a paid quote job could fail to hire its quoter, and the
-- poster was never told.
--   (1) respond_to_direct_offer: an UNFUNDED offer cannot be declined
--       (job_not_funded). The app shows no unfunded offer, so this came only
--       straight at the RPC; on a quote job it left the poster told "declined"
--       and still able to pay a job nobody would be hired for.
--   (2) quote_job_funded_hires_quoter: money that lands after the start (a
--       late-settling ACH) restarts the offer clock into the past, and the
--       reason read offer_expired; it is named job_date_has_passed.
--   (3) Every path where paying did not hire the quoter now tells the POSTER
--       (quote_job_tell_poster_not_hired): finishing setup, accept by hand,
--       the start passed (auto-expire-jobs cancels and refunds), or not hired.
-- create-payment also refuses to charge a booked quote job whose offer is not
-- pending or whose start passed (supabase/functions/create-payment), and the
-- quote request screen reads helper_id, not only payment ("Paid, not booked yet").
-- Bodies: the newest definitions (20261018050953 respond_to_direct_offer,
-- 20261019043546 quote_job_funded_hires_quoter) with only the marked changes.
-- Replay-safe: CREATE OR REPLACE; grants restated.

-- The poster's notice on every path where paying a quote job did not hire the
-- quoter (Q2116 (3)). Never aborts the payment write that fired the trigger:
-- its own subtransaction, a failure raised as a WARNING into the Postgres log
-- and recorded in error_logs.
CREATE OR REPLACE FUNCTION public.quote_job_tell_poster_not_hired(p_job_id uuid, p_poster uuid, p_title text, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text := COALESCE(p_title, 'your job');
  v_msg text;
BEGIN
  IF p_poster IS NULL THEN
    RETURN;
  END IF;
  v_msg := CASE p_kind
    WHEN 'setup' THEN
      'Payment arrived for "' || v_title || '". The member whose quote you booked is finishing their payout setup and is booked as soon as it''s done.'
    WHEN 'accept_by_hand' THEN
      'Payment arrived for "' || v_title || '". The member whose quote you booked needs to accept the job to start; we''ve asked them.'
    WHEN 'date_passed' THEN
      'Payment arrived for "' || v_title || '" after its start time, so the member whose quote you booked couldn''t be hired. The job will be cancelled and your payment refunded automatically.'
    ELSE
      'Payment arrived for "' || v_title || '", but the member whose quote you booked couldn''t be hired automatically. Your payment is held; we''ll tell you what happens next.'
  END;
  BEGIN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (p_poster,
            CASE WHEN p_kind IN ('setup', 'accept_by_hand') THEN 'Payment received' ELSE 'Not booked yet' END,
            v_msg, 'job_updates', '/posts?job=' || p_job_id::text, p_job_id);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error', 'Quote job poster notice not sent',
              jsonb_build_object('source', 'quote_job_tell_poster_not_hired', 'job_id', p_job_id::text),
              jsonb_build_object('kind', p_kind, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quote_job_tell_poster_not_hired: notice for job % failed: %', p_job_id, SQLERRM;
    END;
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_job_tell_poster_not_hired(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

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
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
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

  -- Q2116 (1): an UNFUNDED offer cannot be declined. The app shows a Helpr no
  -- offer until its money arrives (Train J), so a decline here came straight
  -- at the RPC, and on a quote job it left the poster able to pay a job whose
  -- quoter had walked away. Unfunded, the offer simply waits.
  IF NOT public.job_payment_is_funded((SELECT j.payment_status::text FROM public.jobs j WHERE j.id = p_job_id)) THEN
    RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
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
         CASE WHEN public.job_payment_is_funded(payment_status) THEN
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
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.quote_job_funded_hires_quoter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_quoter uuid;
  v_title  text;
  v_reason text;
  v_done   jsonb;
  v_err    text;
  v_state  text;
BEGIN
  -- Only the FIRST funding: from the states the webhooks promote a checkout
  -- from (checkoutSessionCompleted, paymentIntentSucceeded). A redelivered
  -- webhook writes escrow over escrow (funded -> funded) and does nothing; a
  -- cancel or chargeback put back to escrow ('cancelling' / 'chargeback' ->
  -- escrow) is not the poster paying and never hires (lh-money-escrow review
  -- of 28a5ed3d7, M1; notify_on_payment_escrowed skips the same two).
  IF NOT public.job_payment_is_funded(NEW.payment_status::text)
     OR NOT (OLD.payment_status IS NULL OR OLD.payment_status::text IN ('unpaid', 'failed', 'abandoned')) THEN
    RETURN NULL;
  END IF;
  -- Booked from an agreed quote, and offered to the quoter who won it. Not
  -- locked: cancel_quote_request locks request then job, and this already
  -- holds the job; it waits for this transaction and then sees the job funded.
  IF NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id) THEN
    RETURN NULL;
  END IF;
  v_quoter := NEW.offered_to_helper_id;
  SELECT r.title INTO v_title
    FROM public.job_quote_requests r
   WHERE r.job_id = NEW.id AND r.status = 'agreed'
   LIMIT 1;
  -- Still the pending direct offer book_accepted_quote made. A paid quote job
  -- whose offer already lapsed (expire_pending_direct_offers, 48 h from
  -- booking) hires nobody: recorded, never silent (lh-silent-failure review of
  -- 28a5ed3d7, S1).
  IF NEW.status::text <> 'open' OR NEW.direct_offer_status IS DISTINCT FROM 'pending' THEN
    v_reason := 'offer_not_pending:' || COALESCE(NEW.direct_offer_status, 'null') || '/' || NEW.status::text;
    v_done := NULL;
  ELSE

  BEGIN
    -- Everything the completion itself would refuse (a block either way, a
    -- ban or shadowban, the offer expired, the start passed, a credential
    -- tier) is checked FIRST, exactly as respond_to_direct_offer checks it
    -- before it remembers a yes: such a quoter is never told "you're booked"
    -- (across a block that would be contact), and the paid job is logged below
    -- (lh-authz-rls review of 28a5ed3d7, S1).
    v_reason := public.direct_accept_block_reason(NEW.id, v_quoter);
    -- Q2116 (2): money that lands after the start restarts the offer clock into
    -- the past, so direct_accept_block_reason answers offer_expired first; the
    -- real reason is the start.
    IF v_reason = 'offer_expired' AND NEW.date_needed IS NOT NULL
       AND public.job_offer_cutoff(NEW.date_needed, NEW.start_time) <= now() THEN
      v_reason := 'job_date_has_passed';
    END IF;
    IF v_reason IS NULL THEN
      v_reason := public.helper_accept_block_reason(v_quoter);
    ELSE
      v_reason := 'offer_blocked:' || v_reason;
    END IF;
    IF v_reason IS NOT NULL AND v_reason <> 'helper_unknown' AND v_reason NOT LIKE 'offer_blocked:%' THEN
      -- Payout setup or Stripe ID unfinished: the yes is remembered exactly as
      -- respond_to_direct_offer remembers it, and completes when setup is done
      -- (trg_profiles_complete_pending_accepts).
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (NEW.id, v_quoter)
      ON CONFLICT (job_id) DO NOTHING;
      PERFORM public.quote_notify_to(v_quoter, 'Finish setup to start',
        'Payment arrived for "' || COALESCE(v_title, 'your quote') || '". Finish your payout setup and ID check and you''re booked.',
        NEW.customer_id, false, NULL, NEW.id, true);
      -- Q2116 (3): the poster hears it too, never a silent wait.
      PERFORM public.quote_job_tell_poster_not_hired(NEW.id, NEW.customer_id, v_title, 'setup');
      RETURN NULL;
    END IF;
    IF v_reason IS NULL THEN
      v_done := public.complete_direct_offer_accept(NEW.id, v_quoter);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_done := NULL;
    v_err := SQLERRM;
    v_state := SQLSTATE;
  END;
  END IF;

  -- From here nothing may abort the webhook's payment write (lh-silent-failure
  -- review of 28a5ed3d7, S2): each statement has its own subtransaction, and
  -- a failure of the record itself is raised as a WARNING into the Postgres log.
  IF v_done IS NULL THEN
    -- Not hired: the payment write still lands, the direct offer stays as it
    -- is (the quoter can accept a pending one by hand), and this is recorded.
    BEGIN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES (CASE WHEN NEW.is_seed THEN 'info' ELSE 'error' END,
              'Paid quote job did not hire its quoter automatically',
              format('/admin?view=jobs&job=%s', NEW.id),
              jsonb_build_object('source', 'quote_job_funded_hires_quoter', 'job_id', NEW.id::text),
              jsonb_build_object('quoter_id', v_quoter, 'block_reason', v_reason,
                                 'sqlstate', v_state, 'error', v_err));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quote_job_funded_hires_quoter: job % not hired (%), and the error_logs row failed: %',
        NEW.id, COALESCE(v_reason, v_err), SQLERRM;
    END;
    -- The completion THREW (nothing refused it): the offer is still the
    -- quoter's to accept by hand, and section 8 kept the direct-offer notice
    -- back for this job, so the quoter hears it here (lh-money-escrow review
    -- of 8ef7cd25b, #2). Only when the offer is re-read live as still pending,
    -- open and in time, and never across a block (the throw may have been the
    -- block check itself).
    IF v_err IS NOT NULL AND v_reason IS NULL THEN
      BEGIN
        -- FOR SHARE: this transaction already holds the row (its payment write
        -- fired this trigger), so the lock costs nothing; it keeps the read a
        -- locked one for scripts/check-race-class.mjs.
        PERFORM 1 FROM public.jobs j
         WHERE j.id = NEW.id AND j.status::text = 'open' AND j.helper_id IS NULL
           AND j.offered_to_helper_id = v_quoter AND j.direct_offer_status = 'pending'
           AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at > now())
           AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now())
         FOR SHARE;
        IF FOUND AND NOT public.are_users_blocked(v_quoter, NEW.customer_id) THEN
          PERFORM public.quote_notify_to(v_quoter, 'Accept to start',
            'Payment arrived for "' || COALESCE(v_title, 'your quote') || '". Accept the direct offer to start.',
            NEW.customer_id, false, NULL, NEW.id, false);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'quote_job_funded_hires_quoter: accept-by-hand notice for job % failed: %', NEW.id, SQLERRM;
      END;
    END IF;
    -- Q2116 (3): every not-hired path tells the POSTER what happens next.
    PERFORM public.quote_job_tell_poster_not_hired(NEW.id, NEW.customer_id, v_title,
      CASE
        WHEN v_reason LIKE '%job_date_has_passed' THEN 'date_passed'
        WHEN v_err IS NOT NULL AND v_reason IS NULL THEN 'accept_by_hand'
        ELSE 'not_hired'
      END);
    RETURN NULL;
  END IF;

  -- complete_job_accept already told the poster "<name> accepted your offer".
  BEGIN
    PERFORM public.quote_notify_to(v_quoter, 'You''re booked',
      'Payment arrived for "' || COALESCE(v_title, 'your quote') || '". You''re hired for it.',
      NEW.customer_id, false, NULL, NEW.id, false);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error', 'Quote hire notice not sent',
              jsonb_build_object('source', 'quote_job_funded_hires_quoter', 'job_id', NEW.id::text),
              jsonb_build_object('quoter_id', v_quoter, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quote_job_funded_hires_quoter: hire notice for job % failed: %', NEW.id, SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.quote_job_funded_hires_quoter() FROM PUBLIC, anon, authenticated;
