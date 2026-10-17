-- Quotes on jobs, owner answers 8, 10 and 11 (2026-10-17 ~04:50Z, pop-ups;
-- docs/specs/owner-questions-hub-1015.md "OWNER ANSWERS").
--
--   8  HIRE AUTOMATICALLY when the poster pays for an agreed quote: no extra
--      Accept tap. The job booked from an agreed quote is a direct offer to the
--      quoter (book_accepted_quote). When its payment settles (payment_status
--      becomes funded: the one escrow checkout, checkoutSessionCompleted for a
--      card, paymentIntentSucceeded for an async method) the AFTER UPDATE
--      trigger trg_quote_job_funded_hires_quoter completes the quoter's accept
--      through the SAME completion a direct-offer accept uses
--      (complete_direct_offer_accept), or, when the quoter's payout setup / ID
--      is unfinished, remembers the yes in job_accept_pending exactly as
--      respond_to_direct_offer does, so trg_profiles_complete_pending_accepts
--      completes it once setup is done. No second payment path: nothing here
--      moves or reads money; it reacts to the funded state the webhook wrote.
--      Idempotent on webhook redelivery: it acts only on the transition from
--      unfunded to funded (a redelivered escrow write is funded -> funded), and
--      complete_direct_offer_accept itself only completes a still-pending offer.
--      Race-safe: it runs inside the webhook's own UPDATE, holding the job row
--      lock; a concurrent cancel_quote_request waits on that lock and then sees
--      the funded job and refuses. A failure (any error, a deadlock included)
--      rolls back only its own subtransaction: the payment write always lands,
--      the offer stays pending (the quoter can still accept it by hand), and the
--      failure goes to error_logs.
--  10  Alerts. Push already fans out from every notifications row
--      (fan_out_push_on_notification, by the new_offers preference). Email: the
--      new quote_notify_about() also posts the row to send-notification-email
--      (the one email path SQL producers use; it honours email_new_offers, the
--      test-recipient gate and the seed boundary) for each new quote and each
--      counter (to whichever side it now waits on). sweep_quote_alerts() (pg_cron
--      'quote-alerts', every 15 minutes) sends a reminder about 4 hours before a
--      48 h reply window ends and a notice to the poster when the quote window
--      closes, saying how many quotes came in. Each is claimed by an UPDATE ...
--      RETURNING on its own marker column (reminder_sent_for = the respond_until
--      it was sent for, so a counter's new window gets its own reminder;
--      close_notice_sent_at), so two runs never send one twice. Both respect
--      the 'quotes' switch for the recipient.
--  11  Poster cancels after agreeing but before paying: the unpaid job is
--      DELETED automatically, only when it provably never held money (open, no
--      Helpr, payment_status unpaid / abandoned, no Checkout Session, no
--      PaymentIntent: the poster's own delete policy plus no PaymentIntent).
--      A funded job is refused as before ('request_booked').
--
-- Restated from main's NEWEST bodies (20261015091114_job_quotes.sql, the only
-- definition of each; check-out-of-order-restatements: 0 conflicts):
-- submit_job_quote and respond_to_job_quote (only their new-quote / counter
-- notices change, to quote_notify_about(..., true)), cancel_quote_request
-- (the agreed branch deletes the never-funded job), quote_notify (now a thin
-- wrapper; accept / decline notices stay push-only, as before).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS before CREATE TRIGGER, cron.schedule upserts by name, the work
-- expectation is upserted. Grants restated.

-- ---------------------------------------------------------------------------
-- 1. Markers for the alert sweep.

ALTER TABLE public.job_quotes ADD COLUMN IF NOT EXISTS reminder_sent_for timestamptz;
ALTER TABLE public.job_quote_requests ADD COLUMN IF NOT EXISTS close_notice_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. The one quote notice: the notifications row (push fans out from it) and,
--    when asked, the same row by email. p_actor is the member the notice is
--    about (the seed boundary reads ?user=<actor>, Q137); the email goes only
--    when the row survived that boundary (RETURNING id is NULL when it dropped it).

CREATE OR REPLACE FUNCTION public.quote_notify_about(
  p_user uuid, p_title text, p_message text, p_actor uuid, p_email boolean
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
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user, p_title, p_message, 'new_offers',
          CASE WHEN p_actor IS NULL THEN '/quotes' ELSE '/quotes?user=' || p_actor::text END)
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
            jsonb_build_object('source', 'quote_notify_about', 'origin', 'server'),
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
REVOKE ALL ON FUNCTION public.quote_notify_about(uuid, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- The accept / decline notices keep calling this: push only, the actor is the caller.
CREATE OR REPLACE FUNCTION public.quote_notify(p_user uuid, p_title text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.quote_notify_about(p_user, p_title, p_message, (SELECT auth.uid()), false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_notify(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. New quote and counter: push + email (restated, only the notice changes).

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
  PERFORM public.quote_notify_about(v_req.poster_id, 'New quote',
    'You got a quote of $' || (p_price_cents / 100) || ' for "' || v_req.title || '".', v_uid, true);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) TO authenticated, service_role;

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
    PERFORM public.quote_notify(v_other, 'Quote declined',
      'Your offer on "' || v_req.title || '" was declined.');
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
    PERFORM public.quote_notify_about(v_other, 'New counter-offer',
      'You got a counter-offer of $' || (p_price_cents / 100) || ' on "' || v_req.title || '".', v_uid, true);
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
  PERFORM public.quote_notify(v_other, 'Quote accepted',
    CASE WHEN v_side = 'poster'
         THEN 'Your quote of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. It is booked once the poster pays.'
         ELSE 'Your offer of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. Pay to book it.' END);
  RETURN 'accepted';
END;
$fn$;
REVOKE ALL ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Owner answer 11: cancelling an agreed request before paying DELETES its
--    unpaid job. Restated from 20261015091114; the agreed branch now takes the
--    job FOR UPDATE (it may delete it) instead of FOR SHARE, and deletes it
--    only when it provably never held money. Everything else is main's body.

CREATE OR REPLACE FUNCTION public.cancel_quote_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_job_status text;
  v_pay text;
  v_session text;
  v_pi text;
  v_helper uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  -- An 'agreed' request may be cancelled too while its job was never funded
  -- (not booked yet, booking refused for a passed start, or checkout never
  -- finished), so neither side is stuck (lh-money-escrow review of 96ba87037,
  -- should-fix 4). A funded job is cancelled through the job's own cancel flow.
  IF v_req.status = 'agreed' THEN
    -- FOR UPDATE: a payment landing on the job in the same instant waits (and
    -- this may delete the row). Lock order: request, then job, as every quote RPC.
    IF v_req.job_id IS NOT NULL THEN
      SELECT j.status::text, j.payment_status, j.stripe_session_id, j.stripe_payment_intent_id, j.helper_id
        INTO v_job_status, v_pay, v_session, v_pi, v_helper
        FROM public.jobs j WHERE j.id = v_req.job_id FOR UPDATE;
      -- 'unpaid' with a Checkout Session is a live checkout the poster may still
      -- finish (lh-money-escrow re-review of ebe408060, S2): refused too.
      IF FOUND AND v_job_status <> 'cancelled'
         AND COALESCE(v_pay, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN
        RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
          HINT = 'This job is paid for; cancel it from the job instead.';
      END IF;
      IF FOUND AND v_job_status <> 'cancelled' AND v_session IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
          HINT = 'A checkout is open for this job. Finish it, or try again once it expires.';
      END IF;
      -- Owner answer 11 (2026-10-17): the unpaid job goes with the agreement.
      -- Deleted only when it provably never held money: open, nobody hired,
      -- unpaid / abandoned (the poster's own delete policy), no Checkout Session
      -- and no PaymentIntent ever attached. A 'failed' payment (it carries a
      -- PaymentIntent) keeps its job for the record, as before; a cancelled job
      -- is left as it is.
      IF FOUND AND v_job_status = 'open' AND v_helper IS NULL
         AND COALESCE(v_pay, 'unpaid') IN ('unpaid', 'abandoned')
         AND NOT public.job_payment_is_funded(v_pay)
         AND v_session IS NULL AND v_pi IS NULL THEN
        DELETE FROM public.jobs j
         WHERE j.id = v_req.job_id
           AND j.status = 'open' AND j.helper_id IS NULL
           AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned')
           AND j.stripe_session_id IS NULL AND j.stripe_payment_intent_id IS NULL;
        IF NOT FOUND THEN
          -- Unreachable under the row lock above; refuse rather than leave an
          -- agreed job behind a cancelled request.
          RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
            HINT = 'This job could not be removed; cancel it from the job instead.';
        END IF;
      END IF;
    END IF;
  ELSIF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = p_request_id AND status IN ('pending', 'accepted');
  UPDATE public.job_quote_requests SET status = 'cancelled', updated_at = now() WHERE id = p_request_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.cancel_quote_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_quote_request(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Owner answer 8: paying for an agreed quote hires the quoter.

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
  -- Only the step into funded. A redelivered webhook writes escrow over escrow:
  -- funded -> funded does nothing (idempotent).
  IF NOT public.job_payment_is_funded(NEW.payment_status::text)
     OR public.job_payment_is_funded(OLD.payment_status::text) THEN
    RETURN NULL;
  END IF;
  -- Still the pending direct offer book_accepted_quote made.
  IF NEW.status::text <> 'open' OR NEW.helper_id IS NOT NULL
     OR NEW.offered_to_helper_id IS NULL OR NEW.direct_offer_status IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;
  -- Booked from an agreed quote, and offered to the quoter who won it. Not
  -- locked: cancel_quote_request locks request then job, and this already
  -- holds the job; it waits for this transaction and then sees the job funded.
  SELECT q.quoter_id, r.title INTO v_quoter, v_title
    FROM public.job_quote_requests r
    JOIN public.job_quotes q ON q.request_id = r.id AND q.status = 'accepted'
   WHERE r.job_id = NEW.id AND r.status = 'agreed';
  IF NOT FOUND OR v_quoter IS DISTINCT FROM NEW.offered_to_helper_id THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_reason := public.helper_accept_block_reason(v_quoter);
    IF v_reason IS NOT NULL AND v_reason <> 'helper_unknown' THEN
      -- Payout setup or Stripe ID unfinished: the yes is remembered exactly as
      -- respond_to_direct_offer remembers it, and completes when setup is done
      -- (trg_profiles_complete_pending_accepts).
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (NEW.id, v_quoter)
      ON CONFLICT (job_id) DO NOTHING;
      PERFORM public.quote_notify_about(v_quoter, 'Finish setup to start',
        'The poster paid for "' || COALESCE(v_title, 'your quote') || '". Finish your payout setup and ID check and you''re booked.',
        NEW.customer_id, false);
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

  IF v_done IS NULL THEN
    -- Not hired: the payment write still lands, the direct offer stays pending
    -- (the quoter can accept it by hand), and this is recorded, never silent.
    INSERT INTO public.error_logs (severity, message, url, tags, context)
    VALUES (CASE WHEN NEW.is_seed THEN 'info' ELSE 'error' END,
            'Paid quote job did not hire its quoter automatically',
            format('/admin?view=jobs&job=%s', NEW.id),
            jsonb_build_object('source', 'quote_job_funded_hires_quoter', 'job_id', NEW.id::text),
            jsonb_build_object('quoter_id', v_quoter, 'block_reason', v_reason,
                               'sqlstate', v_state, 'error', v_err));
    RETURN NULL;
  END IF;

  -- complete_job_accept already told the poster "<name> accepted your offer".
  PERFORM public.quote_notify_about(v_quoter, 'You''re booked',
    'The poster paid for "' || COALESCE(v_title, 'your quote') || '". You''re hired for it.',
    NEW.customer_id, false);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_job_funded_hires_quoter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_job_funded_hires_quoter ON public.jobs;
CREATE TRIGGER trg_quote_job_funded_hires_quoter
  AFTER UPDATE OF payment_status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.offered_to_helper_id IS NOT NULL AND NEW.helper_id IS NULL)
  EXECUTE FUNCTION public.quote_job_funded_hires_quoter();

-- ---------------------------------------------------------------------------
-- 6. Owner answer 10: the reminder before a 48 h reply window ends, and the
--    notice when the quote window closes. Each send is claimed by an UPDATE ...
--    RETURNING on its marker, so a second run (or two at once: the loser
--    re-reads the claimed row and no longer matches) sends nothing twice.

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
    RETURNING q.id, q.price_cents, q.last_offer_side, req.title, req.poster_id, q.quoter_id
  LOOP
    IF r.last_offer_side = 'quoter' THEN
      PERFORM public.quote_notify_about(r.poster_id, 'A quote is waiting on you',
        'The $' || (r.price_cents / 100) || ' quote for "' || r.title
          || '" ends in a few hours. Accept, counter or decline it before then.',
        r.quoter_id, false);
    ELSE
      PERFORM public.quote_notify_about(r.quoter_id, 'A counter-offer is waiting on you',
        'The $' || (r.price_cents / 100) || ' counter-offer on "' || r.title
          || '" ends in a few hours. Accept, counter or decline it before then.',
        r.poster_id, false);
    END IF;
    v_reminded := v_reminded + 1;
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
    SELECT count(*) INTO v_count FROM public.job_quotes q WHERE q.request_id = r.id;
    PERFORM public.quote_notify_about(r.poster_id, 'Quotes are closed',
      CASE WHEN v_count = 0
           THEN 'No quotes came in for "' || r.title || '". You can set your own price and post it.'
           WHEN v_count = 1
           THEN '1 quote came in for "' || r.title || '". Accept it, counter it, or set your own price.'
           ELSE v_count || ' quotes came in for "' || r.title || '". Pick one, counter, or set your own price.' END,
      r.poster_id, false);
    v_closed := v_closed + 1;
  END LOOP;

  RETURN jsonb_build_object('reminders', v_reminded, 'closed_notices', v_closed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_quote_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_quote_alerts() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('quote-alerts', interval '45 minutes',
            'Quotes (owner answer 10): every 15 minutes, reminds the side a quote waits on about 4 hours before its 48 h reply window ends, and tells a poster how many quotes came in once the quote window closes.',
            'exempt',
            'While quotes are off or quiet, a run that sends nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('quote-alerts', '11-59/15 * * * *',
      $c$SELECT public.cron_record_work('quote-alerts', public.sweep_quote_alerts());$c$);
  END IF;
END
$do$;
