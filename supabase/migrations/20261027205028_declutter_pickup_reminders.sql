-- Q2432 (lead 2026-10-27, growth lane): Declutter pickup no-show protection.
-- Both sides get a reminder 1 hour before a booked pickup (or porch) time: a
-- bell row (declutter_notify, which the push fan-out turns into a push per the
-- member's push settings) and an email through send-notification-email, which
-- applies the member's own email settings for 'job_updates' and the master
-- email switch. Sent ONCE per booked time: a moved booking gets one reminder
-- for its new time.
--
-- MONEY: none. No deposit, no hold (the card hold is separate work). The
-- buyer's booking screen only restates the existing no-show rule
-- (declutter_report_no_show / declutter_close_paid_order).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by
-- name (re-scheduling the same name replaces it), ON CONFLICT upsert.

ALTER TABLE public.declutter_bookings ADD COLUMN IF NOT EXISTS reminded_slot_start timestamptz;
COMMENT ON COLUMN public.declutter_bookings.reminded_slot_start IS
  'Q2432: the slot_start the 1-hour pickup reminder was sent for (NULL = none yet). A moved booking differs, so it is reminded again for the new time.';

-- One reminder to one side: the bell (and push) row, then the email. Seed
-- isolation as declutter_notify: a test counterpart never reaches a real member.
CREATE OR REPLACE FUNCTION public.declutter_pickup_remind(p_user uuid, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.declutter_notify(p_user, 'job_updates', p_title, p_message, p_link, p_other);
  IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.user_id = p_other AND o.is_seed)
     AND NOT EXISTS (SELECT 1 FROM public.profiles r WHERE r.user_id = p_user AND r.is_seed) THEN
    RETURN;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', 'job_updates', 'link', p_link)
    );
  EXCEPTION WHEN OTHERS THEN
    -- The bell row above already landed; an email that could not be queued is
    -- recorded where the alerting reads (error_logs), not only the Postgres log.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'declutter pickup reminder email could not be queued',
            jsonb_build_object('source', 'declutter_pickup_remind'),
            jsonb_build_object('user_id', p_user::text, 'error', SQLERRM));
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) TO service_role;

-- The sweep: every booked pickup of a paid sale that starts within the next
-- hour and has not been reminded for this time. The row is claimed
-- (reminded_slot_start set) before anything is sent, under FOR UPDATE SKIP
-- LOCKED, so two overlapping runs can never send the same reminder twice. Test
-- sales are reminded too (to their test accounts, so the reminder can be
-- proven on prod); declutter_pickup_remind keeps a test side from ever
-- reaching a real member. One failing booking is logged to error_logs and
-- left unclaimed for the next run; it never stops the others.
CREATE OR REPLACE FUNCTION public.declutter_pickup_reminder_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
  v_at text;
  v_what text;
  v_more integer;
  v_day text;
  v_buyer_title text;
  v_seller_title text;
BEGIN
  FOR r IN
    SELECT b.order_id, b.buyer_id, b.seller_id, b.slot_start, b.porch_mode, o.handover
      FROM public.declutter_bookings b
      JOIN public.declutter_orders o ON o.id = b.order_id
     WHERE b.slot_start IS NOT NULL
       AND b.slot_start > now()
       AND b.slot_start <= now() + interval '60 minutes'
       AND b.reminded_slot_start IS DISTINCT FROM b.slot_start
       AND o.status = 'paid'
       AND o.handover IN ('pickup_home', 'porch')
     ORDER BY b.slot_start
       FOR UPDATE OF b SKIP LOCKED
  LOOP
   BEGIN
    UPDATE public.declutter_bookings
       SET reminded_slot_start = r.slot_start
     WHERE order_id = r.order_id
       AND reminded_slot_start IS DISTINCT FROM r.slot_start;
    CONTINUE WHEN NOT FOUND;

    v_at := to_char(r.slot_start AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM');
    v_day := CASE WHEN (r.slot_start AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
                  THEN 'today' ELSE 'tomorrow' END;
    -- Booked less than 50 minutes ahead: the reminder names the time, never "in 1 hour".
    IF r.slot_start - now() >= interval '50 minutes' THEN
      v_buyer_title := CASE WHEN r.handover = 'porch' OR r.porch_mode IS NOT NULL THEN 'Porch pickup in 1 hour' ELSE 'Pickup in 1 hour' END;
    ELSE
      v_buyer_title := CASE WHEN r.handover = 'porch' OR r.porch_mode IS NOT NULL THEN 'Porch pickup at ' ELSE 'Pickup at ' END || v_at;
    END IF;
    v_seller_title := v_buyer_title;
    SELECT (array_agg(i.title ORDER BY c.created_at, c.id))[1], count(*) - 1
      INTO v_what, v_more
      FROM public.declutter_cart_items c
      JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.order_id = r.order_id;
    v_what := COALESCE(NULLIF(btrim(v_what), ''), 'your Declutter item')
              || CASE WHEN COALESCE(v_more, 0) > 0 THEN format(' and %s more', v_more) ELSE '' END;

    IF r.handover = 'porch' OR r.porch_mode IS NOT NULL THEN
      PERFORM public.declutter_pickup_remind(r.buyer_id, v_buyer_title,
        format('Your porch pickup of %s is at %s %s. If you can''t make it, move the time now in your order.', v_what, v_at, v_day),
        '/declutter?view=cart', r.seller_id);
      PERFORM public.declutter_pickup_remind(r.seller_id, v_seller_title,
        format('The buyer picks up %s from your porch at %s %s. Set it out before then and post the porch photo.', v_what, v_at, v_day),
        '/declutter?view=selling', r.buyer_id);
    ELSE
      PERFORM public.declutter_pickup_remind(r.buyer_id, v_buyer_title,
        format('Your pickup of %s is at %s %s. If you can''t make it, move the time now in your order.', v_what, v_at, v_day),
        '/declutter?view=cart', r.seller_id);
      PERFORM public.declutter_pickup_remind(r.seller_id, v_seller_title,
        format('The buyer comes for %s at %s %s. Have it ready at the door.', v_what, v_at, v_day),
        '/declutter?view=selling', r.buyer_id);
    END IF;
    v_sent := v_sent + 1;
   EXCEPTION WHEN OTHERS THEN
    -- This booking's claim and any rows it wrote roll back with it (the
    -- block's own savepoint), so the next run tries it again; the others go on.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'declutter pickup reminder failed for one booking',
            jsonb_build_object('source', 'declutter_pickup_reminder_sweep', 'order_id', r.order_id::text),
            jsonb_build_object('error', SQLERRM));
   END;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_reminder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_reminder_sweep() TO service_role;

-- The cron: every 5 minutes, so a reminder lands 55 to 60 minutes before the time.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-pickup-reminders', interval '30 minutes',
            'Declutter (Q2432): both sides of a booked pickup or porch pickup get a bell, push and email reminder 1 hour before the time.',
            'exempt', 'Almost every run finds no pickup starting within the hour: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-pickup-reminders', '4-59/5 * * * *',
      $c$SELECT public.cron_record_work('declutter-pickup-reminders', to_jsonb(public.declutter_pickup_reminder_sweep()));$c$);
  END IF;
END
$do$;
