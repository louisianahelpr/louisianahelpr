-- Q2127 (lh-money-escrow review of daa251fb0, nit 4): quote_job_funded_hires_quoter's hire block caught
-- EXCEPTION WHEN OTHERS, which in PL/pgSQL never matches query_canceled (57014). A statement_timeout during the hire
-- (complete_direct_offer_accept and the checks before it) therefore aborted the whole webhook statement and rolled
-- back the escrow write; Stripe retried, so no money was lost, but the funding write failed until the retry.
--
-- The item allowed "a bounded local statement_timeout": that does not work inside a trigger. Postgres measures
-- statement_timeout from when the client's statement arrived and arms the timer once, so a SET LOCAL inside the
-- function changes nothing for the statement already running. So the hire block now catches query_canceled by name:
-- the payment write lands, nothing is hired, and the error_logs row records sqlstate 57014 (the existing not-hired
-- path; the accept-by-hand notice follows it as for any other throw).
--
-- quote_job_funded_hires_quoter is restated VERBATIM from its newest definition,
-- 20261019043546_quote_notices_link_the_quoter_view (no later migration restates or rewrites it), with the one
-- CHANGED line marked Q2127. Its trigger is unchanged. Replay-safe: CREATE OR REPLACE and REVOKE only.
-- Proof: src/test/pglite/quoteHireCatchesQueryCanceled.pglite.mjs (applied 3x; NEW_MIGRATION=skip red; MUTANT red).

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
      RETURN NULL;
    END IF;
    IF v_reason IS NULL THEN
      v_done := public.complete_direct_offer_accept(NEW.id, v_quoter);
    END IF;
  -- CHANGED (Q2127): WHEN OTHERS does not catch query_canceled (SQLSTATE 57014: a statement_timeout or a cancel), so
  -- a timeout during the hire rolled back the webhook's whole escrow write. It is caught by name here: the payment
  -- write lands, the job is not hired, and the failure is logged below with its sqlstate (the quoter may still accept
  -- by hand). Postgres arms the statement timer once per statement, so after this catch the rest of this trigger and
  -- the webhook's write run unbounded; they are a few single-row writes.
  EXCEPTION WHEN OTHERS OR query_canceled THEN
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
