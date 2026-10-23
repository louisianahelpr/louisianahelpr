-- Quote reminders and the "Quotes are closed" notice also go by EMAIL, with
-- their own email switch (Q2120; owner decided 2026-10-21 and again
-- 2026-10-22: "quote reminders also by EMAIL with own setting").
--
-- Before: sweep_quote_alerts (20261019043546) sent the 48 h reply-window
-- reminder ("A quote is waiting on you" / "A counter-offer is waiting on
-- you") and the window-closed notice ("Quotes are closed") as in-app + push
-- only (p_email false), so a member who was not in the app missed the end of
-- the window. The close notice also counted EVERY quote on the request, so
-- "1 quote came in ... Accept it" could go out about a quote that had already
-- been declined, withdrawn or had run out of its 48 h (lh-silent-failure
-- review of 28a5ed3d7, nit 5).
--
-- Now:
--   1. notification_preferences.email_quote_reminders (boolean, default true,
--      the same default as every other transactional email switch): the
--      member's own switch for these emails, on the Notifications screen as
--      "Quote reminders". send-notification-email maps the email type
--      'quote_reminder' to it. The in-app row and its push keep type
--      'new_offers' (the "Job offers" switch), exactly as before, so no
--      notifications.type is added and the six type registries do not move.
--   2. quote_notify_to gains p_email_type (DEFAULT 'new_offers'): the type
--      its email is sent as. Every existing caller passes 8 arguments and
--      keeps 'new_offers' unchanged; the old 8-argument function is dropped
--      first, because Postgres would find an 8-argument call ambiguous
--      between it and the new one. Its body is the newest one
--      (20261019043546, md5 of prod's definition matched the file on
--      2026-10-23) with only the email body's 'type' changed.
--   3. sweep_quote_alerts sends both reminders and the close notice with
--      p_email true and p_email_type 'quote_reminder', and the close notice
--      counts the quotes the poster can answer now (pending, reply window
--      still open, a quoter on it, the poster's turn) apart from the ones that
--      came in ("3 quotes came in for "X", and 1 is waiting on you."), and
--      past the 2-hour start rule says only what came in.
--      Restated from 20261019043546; every other token is that migration's.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS on the old
-- signature, CREATE OR REPLACE. Grants as before: quote_notify_to is not
-- client-callable (REVOKE ... FROM PUBLIC, anon, authenticated),
-- sweep_quote_alerts runs as service_role only.
--
-- Proof: src/test/pglite/quoteHireOnPay.pglite.mjs (the "remind" checks;
-- --remind-before leaves this migration out and exactly those fail).

-- ---------------------------------------------------------------------------
-- 1. The switch.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_quote_reminders boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.email_quote_reminders IS
  'Email for quote reminders (the 48 h reply window is ending) and the Quotes are closed notice (Q2120). send-notification-email type quote_reminder. Default true.';

-- ---------------------------------------------------------------------------
-- 2. The one quote notice, with the type its email is sent as.

DROP FUNCTION IF EXISTS public.quote_notify_to(uuid, text, text, uuid, boolean, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.quote_notify_to(
  p_user uuid, p_title text, p_message text, p_actor uuid, p_email boolean,
  p_request_id uuid, p_job_id uuid, p_payout_setup boolean,
  p_email_type text DEFAULT 'new_offers'
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
    -- seed-policy: no seed branch: missing vault secrets are a platform fault, the same for a
    -- seed or a real recipient, and the row names only the notification (no member data).
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
                               'message', p_message, 'type', COALESCE(p_email_type, 'new_offers'), 'link', v_link)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_notify_to(uuid, text, text, uuid, boolean, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The alert sweep: reminders and the close notice by email too; the close
--    notice says how many quotes are waiting on the poster.

CREATE OR REPLACE FUNCTION public.sweep_quote_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r          record;
  v_count    bigint;
  v_live     bigint;
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
        r.quoter_id, true, r.request_id, NULL, false, 'quote_reminder');
    ELSE
      PERFORM public.quote_notify_to(r.quoter_id, 'A counter-offer is waiting on you',
        'The $' || (r.price_cents / 100) || ' counter-offer on "' || r.title
          || '" ends in a few hours. Accept, counter or decline it before then.',
        r.poster_id, true, r.request_id, NULL, false, 'quote_reminder');
    END IF;
    v_reminded := v_reminded + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.job_quotes SET reminder_sent_for = NULL WHERE id = r.id;
      PERFORM public.log_cron_defect('sweep_quote_alerts', r.id::text, SQLERRM,
        jsonb_build_object('phase', 'reminder', 'quote_id', r.id));
    END;
  END LOOP;

  -- The window closed: tell the poster how many quotes came in, and how many
  -- of them the poster can answer right now: pending, its 48 h not run out, a
  -- quoter still on it, and the poster's turn (the quoter made the last offer),
  -- the same rules respond_to_job_quote enforces (lh-silent-failure review of
  -- the Q2120 branch, #1). Past the 2-hour start rule nothing can be agreed or
  -- posted any more (create_quote_request caps the window there), so the
  -- notice then only says what came in. Only windows closed in the last day,
  -- so a switch turned on later never sends old news.
  FOR r IN
    UPDATE public.job_quote_requests req
       SET close_notice_sent_at = now()
     WHERE req.status = 'open'
       AND req.poster_id IS NOT NULL
       AND req.close_notice_sent_at IS NULL
       AND req.quotes_close_at <= now()
       AND req.quotes_close_at > now() - interval '1 day'
       AND public.feature_enabled_for_user('quotes', req.poster_id)
    RETURNING req.id, req.title, req.poster_id,
              ((req.date_needed + COALESCE(req.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago')
                - interval '2 hours' <= now() AS too_late
  LOOP
    BEGIN
    SELECT count(*),
           count(*) FILTER (WHERE q.status = 'pending' AND q.respond_until > now()
                              AND q.quoter_id IS NOT NULL AND q.last_offer_side = 'quoter')
      INTO v_count, v_live
      FROM public.job_quotes q WHERE q.request_id = r.id;
    PERFORM public.quote_notify_to(r.poster_id, 'Quotes are closed',
      CASE WHEN r.too_late AND v_count = 0
           THEN 'No quotes came in for "' || r.title || '".'
           WHEN r.too_late
           THEN CASE WHEN v_count = 1 THEN '1 quote' ELSE v_count || ' quotes' END
                || ' came in for "' || r.title || '", but the job starts too soon to agree on one now.'
           WHEN v_count = 0
           THEN 'No quotes came in for "' || r.title || '". You can set your own price and post it.'
           WHEN v_live = 0
           THEN CASE WHEN v_count = 1 THEN '1 quote' ELSE v_count || ' quotes' END
                || ' came in for "' || r.title || '", and none is waiting on you. You can set your own price and post it.'
           WHEN v_count = 1
           THEN '1 quote came in for "' || r.title || '". Accept it, counter it, or set your own price.'
           WHEN v_live = v_count
           THEN v_count || ' quotes came in for "' || r.title || '". Pick one, counter, or set your own price.'
           WHEN v_live = 1
           THEN v_count || ' quotes came in for "' || r.title || '", and 1 is waiting on you. Accept it, counter it, or set your own price.'
           ELSE v_count || ' quotes came in for "' || r.title || '", and ' || v_live
                || ' are waiting on you. Pick one, counter, or set your own price.' END,
      r.poster_id, true, r.id, NULL, false, 'quote_reminder');
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
