-- Quote notices carry a REFERENCE (the quote request, or the job), and the
-- destination is decided when the member opens the notice, not frozen into
-- the row (Q2177; lead /code-review of wip/reds-1019-8, 2026-10-19).
--
-- Before: quote_notify_about (20261018155222) wrote one link for every
-- recipient, '/quotes' (or '/quotes?user=<actor>' for the seed boundary), and
-- no job_id. /quotes was the hub whose default view was the POSTER's ("Your
-- requests"); since the hub was retired (owner 2026-10-19, QuotesHubRedirect)
-- a bare /quotes opens Posts. So a QUOTER told "New counter-offer", "Quote
-- accepted", "Quote declined", "A counter-offer is waiting on you", "You're
-- booked", "Finish setup to start" or "Accept to start" landed on the poster's
-- page, where their quote is not shown; the email carried the same link.
-- A first fix froze '/quotes?view=mine' into the quoter's rows, which is the
-- same mistake again: a claim about where quotes live, written at send time.
--
-- Now: quote_notify_to(p_user, p_title, p_message, p_actor, p_email,
-- p_request_id, p_job_id, p_payout_setup) is the one quote notice (the
-- notifications row, push fans out from it, and the email when asked):
--   * about a request (new quote, counter, accept, decline, the reminders,
--     "Quotes are closed"): link '/quotes?request=<request id>'. The /quotes
--     route (QuotesHubRedirect) reads the request at open time and sends the
--     member who posted it to its page (/quotes/request/<id>) and anyone else
--     (the quoter) to their quotes (QUOTE_HOMES.myQuotes). Whichever side the
--     row went to, it opens that side's place, wherever it lives then.
--   * about the booked job ("You're booked", "Accept to start"): job_id set
--     and link '/jobs?job=<job id>', the shape every job notice has: the bell
--     (notificationDestination) rebuilds it from job_id and Activity resolves
--     the job's live bucket, where the quoter accepts the direct offer or sees
--     the booked job.
--   * "Finish setup to start": job_id set and link '/profile?tab=payment',
--     the payout setup ("Payout account verified" opens the same page).
--   Every link keeps '&user=<actor>' for the seed boundary
--   (notification_crosses_seed_boundary reads '[?&](?:userId|offerTo|user)=').
-- submit_job_quote, respond_to_job_quote, quote_job_funded_hires_quoter and
-- sweep_quote_alerts call it; quote_notify_about and the 3-argument
-- quote_notify, which nothing calls any more, are dropped.
--
-- Restated from the NEWEST bodies, 20261018155222_quote_hire_on_pay_alerts.sql
-- (no later migration defines any of them). Only the notice calls change (and
-- sweep_quote_alerts' reminder RETURNING adds the request id); every other
-- token is that migration's.
--
-- Replay-safe: CREATE OR REPLACE, DROP ... IF EXISTS after every caller is
-- restated. Grants as before: the notice helper and the hire trigger are not
-- client-callable (REVOKE ... FROM PUBLIC, anon, authenticated),
-- submit_job_quote and respond_to_job_quote stay callable by authenticated
-- (anon revoked), sweep_quote_alerts by service_role only.

-- ---------------------------------------------------------------------------
-- 1. The one quote notice: a reference, never a frozen view.

CREATE OR REPLACE FUNCTION public.quote_notify_to(
  p_user uuid, p_title text, p_message text, p_actor uuid, p_email boolean,
  p_request_id uuid, p_job_id uuid, p_payout_setup boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id   uuid;
  v_link text;
  v_url  text;
  v_key  text;
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  v_link := CASE
    WHEN COALESCE(p_payout_setup, false) THEN '/profile?tab=payment'
    WHEN p_job_id IS NOT NULL THEN '/jobs?job=' || p_job_id::text
    WHEN p_request_id IS NOT NULL THEN '/quotes?request=' || p_request_id::text
    ELSE '/quotes' END;
  IF p_actor IS NOT NULL THEN
    v_link := v_link || CASE WHEN position('?' IN v_link) > 0 THEN '&' ELSE '?' END || 'user=' || p_actor::text;
  END IF;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (p_user, p_title, p_message, 'new_offers', v_link, p_job_id)
  RETURNING id, link INTO v_id, v_link;
  IF v_id IS NULL OR NOT COALESCE(p_email, false) THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    -- The same skip fan_out_push_on_notification makes; the in-app row and its
    -- push still stand. Recorded, not silent.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'Quote email not sent: vault secrets missing',
            jsonb_build_object('source', 'quote_notify_to', 'origin', 'server'),
            jsonb_build_object('notification_id', v_id));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-notification-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('notification_id', v_id, 'user_id', p_user, 'title', p_title,
                               'message', p_message, 'type', 'new_offers', 'link', v_link)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_notify_to(uuid, text, text, uuid, boolean, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A new quote: to the poster, about the request.

CREATE OR REPLACE FUNCTION public.submit_job_quote(
  p_request_id uuid,
  p_price_cents integer,
  p_note text,
  p_available_note text,
  p_photo_paths text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_id  uuid;
  v_photos text[] := COALESCE(p_photo_paths, '{}');
  v_path text;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  FOREACH v_path IN ARRAY v_photos LOOP
    -- Only the quoter's own quotes folder: account deletion erases exactly
    -- job-photos/<uid>/quotes/ (purgeBuckets.ts IDENTITY_SUBFOLDERS), so a
    -- path anywhere else would outlive the purge (lh-silent-failure review).
    IF v_path IS NULL OR v_path NOT LIKE v_uid::text || '/quotes/%' OR v_path LIKE '%..%' THEN
      RAISE EXCEPTION 'invalid_photo' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Per-quoter serialization: the daily cap below is read-then-write.
  PERFORM pg_advisory_xact_lock(hashtext('submit_job_quote'), hashtext(v_uid::text));
  IF (SELECT count(*) FROM public.job_quotes q
       WHERE q.quoter_id = v_uid AND q.created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- FOR SHARE composes with the poster's FOR UPDATE in accept / switch /
  -- cancel: a quote cannot land on a request being closed in the same instant.
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.poster_id IS NULL OR v_req.poster_id = v_uid THEN
    RAISE EXCEPTION 'cannot_quote_own_request' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'open' OR v_req.quotes_close_at <= now() OR v_req.invited_only THEN
    RAISE EXCEPTION 'quotes_closed' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_req.poster_id, v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_quotes q WHERE q.request_id = p_request_id AND q.quoter_id = v_uid) THEN
    RAISE EXCEPTION 'already_quoted' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.job_quotes (request_id, quoter_id, price_cents, note, available_note,
                                 photo_paths, last_offer_side, respond_until)
  VALUES (p_request_id, v_uid, p_price_cents, btrim(p_note), btrim(p_available_note),
          v_photos, 'quoter', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
  VALUES (v_id, 'quoter', p_price_cents, btrim(p_note));

  -- Q10 (owner, 2026-10-17): push AND email for each new quote.
  PERFORM public.quote_notify_to(v_req.poster_id, 'New quote',
    'You got a quote of $' || (p_price_cents / 100) || ' for "' || v_req.title || '".', v_uid, true,
    v_req.id, NULL, false);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Decline, counter and accept: to whichever side did not act, about the
--    request (the /quotes route sends each side to its own place).

CREATE OR REPLACE FUNCTION public.respond_to_job_quote(
  p_quote_id uuid,
  p_action text,
  p_price_cents integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid    uuid;
  v_req_id uuid;
  v_req    public.job_quote_requests%ROWTYPE;
  v_q      public.job_quotes%ROWTYPE;
  v_side   text;
  v_other  uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT q.request_id INTO v_req_id FROM public.job_quotes q WHERE q.id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_q FROM public.job_quotes WHERE id = p_quote_id FOR UPDATE;

  IF v_uid = v_req.poster_id THEN
    v_side := 'poster'; v_other := v_q.quoter_id;
  ELSIF v_uid = v_q.quoter_id THEN
    v_side := 'quoter'; v_other := v_req.poster_id;
  ELSE
    -- Q5: a stranger learns nothing, not even that the quote exists.
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'quote_unavailable' USING ERRCODE = '55000';
  END IF;
  -- Q345: no hire across a block, either direction, on every action (an
  -- accept here is the hire). Same code and errcode as accept_application.
  IF public.are_users_blocked(v_req.poster_id, v_q.quoter_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'open' OR v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'quote_closed' USING ERRCODE = '55000';
  END IF;
  IF v_q.respond_until <= now() THEN
    RAISE EXCEPTION 'quote_expired' USING ERRCODE = '55000';
  END IF;
  -- Past the posted-job start rule (2 hours' notice) the agreed job could never
  -- be booked, so nothing may be agreed or countered any more (decline still may).
  IF p_action <> 'decline' AND ((v_req.date_needed + COALESCE(v_req.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago')
       - interval '2 hours' <= now() THEN
    RAISE EXCEPTION 'job_start_too_soon' USING ERRCODE = '22023',
      HINT = 'This job starts too soon to agree a price now.';
  END IF;
  IF v_q.last_offer_side = v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000',
      DETAIL = 'Waiting for the other side to answer your last offer.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.job_quotes SET status = 'declined', updated_at = now() WHERE id = p_quote_id;
    PERFORM public.quote_notify_to(v_other, 'Quote declined',
      'Your offer on "' || v_req.title || '" was declined.', v_uid, false, v_req.id, NULL, false);
    RETURN 'declined';
  END IF;

  IF p_action = 'counter' THEN
    IF p_price_cents IS NULL THEN
      RAISE EXCEPTION 'price_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.job_quotes
       SET price_cents = p_price_cents, last_offer_side = v_side,
           respond_until = now() + interval '48 hours', offer_count = offer_count + 1,
           updated_at = now()
     WHERE id = p_quote_id;
    INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
    VALUES (p_quote_id, v_side, p_price_cents, NULLIF(btrim(p_note), ''));
    -- Q10 (owner, 2026-10-17): push AND email for each counter, to whichever
    -- side it is now waiting on (the poster, or the quoter).
    PERFORM public.quote_notify_to(v_other, 'New counter-offer',
      'You got a counter-offer of $' || (p_price_cents / 100) || ' on "' || v_req.title || '".', v_uid, true,
      v_req.id, NULL, false);
    RETURN 'countered';
  END IF;

  -- accept: this quote wins at the price on the table; every other quote on the
  -- request closes. The request row is locked FOR UPDATE above, so two accepts
  -- (or an accept racing a switch / cancel) serialize and the second sees
  -- status <> 'open'. job_quotes_one_accepted is the backstop.
  UPDATE public.job_quotes SET status = 'accepted', updated_at = now() WHERE id = p_quote_id;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = v_req.id AND id <> p_quote_id AND status = 'pending';
  UPDATE public.job_quote_requests SET status = 'agreed', updated_at = now() WHERE id = v_req.id;
  PERFORM public.quote_notify_to(v_other, 'Quote accepted',
    CASE WHEN v_side = 'poster'
         THEN 'Your quote of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. It is booked once the poster pays.'
         ELSE 'Your offer of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. Pay to book it.' END,
    v_uid, false, v_req.id, NULL, false);
  RETURN 'accepted';
END;
$fn$;
REVOKE ALL ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Paying for an agreed quote: every notice here goes to the quoter, about
--    the job (or its payout setup).

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

-- ---------------------------------------------------------------------------
-- 5. The alert sweep: the counter-offer reminder goes to the quoter; the quote
--    reminder and the close notice go to the poster.

CREATE OR REPLACE FUNCTION public.sweep_quote_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r          record;
  v_count    bigint;
  v_reminded integer := 0;
  v_closed   integer := 0;
BEGIN
  -- Reminders: a pending offer whose 48 h ends within 4 hours, to the side it
  -- waits on (the side that did NOT make the last offer), once per window.
  FOR r IN
    UPDATE public.job_quotes q
       SET reminder_sent_for = q.respond_until
      FROM public.job_quote_requests req
     WHERE req.id = q.request_id
       AND q.status = 'pending'
       AND req.status = 'open'
       AND q.quoter_id IS NOT NULL
       AND req.poster_id IS NOT NULL
       AND q.respond_until > now()
       AND q.respond_until <= now() + interval '4 hours'
       AND q.reminder_sent_for IS DISTINCT FROM q.respond_until
       -- Past the 2-hour start rule nothing can be agreed any more (respond_to_job_quote).
       AND ((req.date_needed + COALESCE(req.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago')
             - interval '2 hours' > now()
       AND public.feature_enabled_for_user('quotes',
             CASE WHEN q.last_offer_side = 'quoter' THEN req.poster_id ELSE q.quoter_id END)
    RETURNING q.id, q.price_cents, q.last_offer_side, req.title, req.poster_id, q.quoter_id, req.id AS request_id
  LOOP
    -- One row that cannot be sent never holds back the rest (lh-silent-failure
    -- review of 28a5ed3d7, S3): its claim is released so the next run retries
    -- it, and the failure is filed where ops reads it.
    BEGIN
    IF r.last_offer_side = 'quoter' THEN
      PERFORM public.quote_notify_to(r.poster_id, 'A quote is waiting on you',
        'The $' || (r.price_cents / 100) || ' quote for "' || r.title
          || '" ends in a few hours. Accept, counter or decline it before then.',
        r.quoter_id, false, r.request_id, NULL, false);
    ELSE
      PERFORM public.quote_notify_to(r.quoter_id, 'A counter-offer is waiting on you',
        'The $' || (r.price_cents / 100) || ' counter-offer on "' || r.title
          || '" ends in a few hours. Accept, counter or decline it before then.',
        r.poster_id, false, r.request_id, NULL, false);
    END IF;
    v_reminded := v_reminded + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.job_quotes SET reminder_sent_for = NULL WHERE id = r.id;
      PERFORM public.log_cron_defect('sweep_quote_alerts', r.id::text, SQLERRM,
        jsonb_build_object('phase', 'reminder', 'quote_id', r.id));
    END;
  END LOOP;

  -- The window closed: tell the poster how many quotes came in. Only windows
  -- closed in the last day, so a switch turned on later never sends old news.
  FOR r IN
    UPDATE public.job_quote_requests req
       SET close_notice_sent_at = now()
     WHERE req.status = 'open'
       AND req.poster_id IS NOT NULL
       AND req.close_notice_sent_at IS NULL
       AND req.quotes_close_at <= now()
       AND req.quotes_close_at > now() - interval '1 day'
       AND public.feature_enabled_for_user('quotes', req.poster_id)
    RETURNING req.id, req.title, req.poster_id
  LOOP
    BEGIN
    SELECT count(*) INTO v_count FROM public.job_quotes q WHERE q.request_id = r.id;
    PERFORM public.quote_notify_to(r.poster_id, 'Quotes are closed',
      CASE WHEN v_count = 0
           THEN 'No quotes came in for "' || r.title || '". You can set your own price and post it.'
           WHEN v_count = 1
           THEN '1 quote came in for "' || r.title || '". Accept it, counter it, or set your own price.'
           ELSE v_count || ' quotes came in for "' || r.title || '". Pick one, counter, or set your own price.' END,
      r.poster_id, false, r.id, NULL, false);
    v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.job_quote_requests SET close_notice_sent_at = NULL WHERE id = r.id;
      PERFORM public.log_cron_defect('sweep_quote_alerts', r.id::text, SQLERRM,
        jsonb_build_object('phase', 'close_notice', 'request_id', r.id));
    END;
  END LOOP;

  RETURN jsonb_build_object('reminders', v_reminded, 'closed_notices', v_closed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_quote_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_quote_alerts() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Nothing calls the old helpers any more (every caller is restated above).

DROP FUNCTION IF EXISTS public.quote_notify(uuid, text, text);
DROP FUNCTION IF EXISTS public.quote_notify_about(uuid, text, text, uuid, boolean);
