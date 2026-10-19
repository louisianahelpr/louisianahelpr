-- A paid quote job always hires its quoter, or the poster is told what
-- happens to their money (Q2116, lh-money-escrow review of 28a5ed3d7, must-fix
-- 2, re-scoped against train J).
--
-- Before: three ways a poster paid for an agreed quote and nobody was hired,
-- and the poster never heard:
--   (1) the quoter could DECLINE the unfunded direct offer by calling
--       respond_to_direct_offer with the job id (the app hides unfunded
--       offers, the RPC's decline branch did not check funding). The poster
--       could still pay, and the paid job opened to everyone at the agreed
--       price with nobody hired.
--   (2) money that settled after the start cutoff (a slow bank payment): the
--       hire trigger logged 'offer_expired' (it was the START that passed) and
--       nobody was told until auto-expire-jobs cancelled it a day later.
--   (3) a quoter blocked, banned or shadowbanned between booking and payment,
--       one whose completion threw, or one still finishing payout setup: the
--       job sat paid, and later opened to everyone, the poster told nothing.
--
-- Now:
--   * respond_to_direct_offer refuses a decline on an unfunded job
--     (job_not_funded, 42501), the same refusal its accept branch makes.
--     Restated from 20261018050953 (the newest body, prod md5 checked by that
--     migration); only the payment_status read and the refusal are new.
--   * quote_job_funded_hires_quoter names a payment landing after the start
--     cutoff 'job_date_has_passed', and tells the POSTER on every path where
--     the payment did not hire (emailed: it is about money): start passed or
--     job cancelled -> cancelled automatically and refunded under the usual
--     refund rules (the refund notice carries the exact amount; nothing here
--     moves money); quoter refused -> cancel for a refund or keep it open to
--     everyone at the same price; completion threw -> the quoter still has to
--     accept; quoter finishing setup -> booked once that is done. Restated
--     from 20261019043546 (the newest body); each new notice runs in its own
--     subtransaction so it can never abort the webhook's payment write.
--   create-payment refuses to open a checkout for a quote job whose offer is
--   not pending or whose start has passed (supabase/functions/create-payment),
--   and the request screen reads helper_id (src/lib/quotes/api.ts).
--
-- Replay-safe: CREATE OR REPLACE only. Grants as before: respond_to_direct_offer
-- callable by authenticated (PUBLIC and anon revoked); the hire trigger by
-- nobody but its trigger.
--
-- Proof: src/test/pglite/quoteHireOnPay.pglite.mjs (Q2116 steps).

-- ---------------------------------------------------------------------------
-- 1. The offered quoter cannot decline an offer nobody has paid for yet.

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
  v_pay text;
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

  -- Q2116 (1): an offer on an UNFUNDED job was never made to anyone (the
  -- offer list and its notice wait for the money, train J), so it cannot be
  -- declined either. Before this a quoter could decline a booked quote by
  -- calling this RPC with the job id; the poster could then still pay, and the
  -- paid job opened to everyone at the agreed price with nobody hired. The
  -- accept branch above already refuses the same job (job_not_funded).
  IF NOT public.job_payment_is_funded(v_pay) THEN
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

-- ---------------------------------------------------------------------------
-- 2. Paying for an agreed quote hires the quoter, or the poster is told.

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
  v_req_id uuid;
  v_name   text;
  v_poster_title text;
  v_poster_msg   text;
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
  SELECT r.id, r.title INTO v_req_id, v_title
    FROM public.job_quote_requests r
   WHERE r.job_id = NEW.id AND r.status = 'agreed'
   LIMIT 1;
  -- Q2116: the poster is told by name whenever the payment does not hire.
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Your quoter') INTO v_name
    FROM public.profiles p WHERE p.user_id = v_quoter;
  v_name := COALESCE(v_name, 'Your quoter');
  -- Still the pending direct offer book_accepted_quote made. A paid quote job
  -- whose offer already lapsed (expire_pending_direct_offers, 48 h from
  -- booking) hires nobody: recorded, never silent (lh-silent-failure review of
  -- 28a5ed3d7, S1).
  IF NEW.status::text <> 'open' OR NEW.direct_offer_status IS DISTINCT FROM 'pending' THEN
    v_reason := 'offer_not_pending:' || COALESCE(NEW.direct_offer_status, 'null') || '/' || NEW.status::text;
    v_done := NULL;
  -- Q2116 (2): money that lands after the start cutoff (a late-settling bank
  -- payment). The clock restart has put the offer's window at the cutoff, so
  -- direct_accept_block_reason would call it offer_expired; it is the start
  -- that passed, and the poster is told the job will be cancelled and refunded
  -- (auto-expire-jobs cancels it, void-cancelled-payments refunds it under the
  -- usual refund rules and sends the refund notice).
  ELSIF NEW.date_needed IS NOT NULL
        AND public.job_offer_cutoff(NEW.date_needed, NEW.start_time) <= now() THEN
    v_reason := 'job_date_has_passed';
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
      -- Q2116 (3): the poster hears that the money arrived and the quoter is
      -- not booked yet. Its own subtransaction: a failed notice never undoes
      -- the remembered yes above.
      BEGIN
        PERFORM public.quote_notify_to(NEW.customer_id, 'Payment received',
          'Payment arrived for "' || COALESCE(v_title, 'your quote') || '". ' || v_name
            || ' is finishing payout setup and is booked as soon as that''s done. If they don''t finish in time, the job opens to everyone at the same price.',
          v_quoter, false, v_req_id, NULL, false);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'quote_job_funded_hires_quoter: setup notice to the poster of job % failed: %', NEW.id, SQLERRM;
      END;
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
    -- Q2116 (2, 3): the poster is told on EVERY path where the payment did
    -- not hire, with what happens to the money. Emailed: it is about money.
    BEGIN
      IF v_reason = 'job_date_has_passed' OR NEW.status::text = 'cancelled' THEN
        v_poster_title := 'Quote not booked';
        v_poster_msg := 'Your payment for "' || COALESCE(v_title, 'your quote') || '" arrived '
          || CASE WHEN v_reason = 'job_date_has_passed' THEN 'after the job''s start time' ELSE 'after the job was cancelled' END
          || ', so ' || v_name || ' could not be booked. The job is cancelled automatically and you''ll get a refund notice with the exact amount.';
      ELSIF v_err IS NOT NULL AND v_reason IS NULL THEN
        v_poster_title := 'Payment received';
        v_poster_msg := 'Payment arrived for "' || COALESCE(v_title, 'your quote') || '". ' || v_name
          || ' still needs to accept the booking to start. If they don''t in time, the job opens to everyone at the same price.';
      ELSE
        v_poster_title := 'Quote not booked';
        v_poster_msg := 'Payment arrived for "' || COALESCE(v_title, 'your quote') || '", but ' || v_name
          || ' can''t be booked for it. You can cancel the job for a refund, or keep it and it opens to everyone at the same price.';
      END IF;
      PERFORM public.quote_notify_to(NEW.customer_id, v_poster_title, v_poster_msg, v_quoter, true, v_req_id, NULL, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quote_job_funded_hires_quoter: not-hired notice to the poster of job % failed: %', NEW.id, SQLERRM;
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
