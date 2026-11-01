-- Unread reminders for DECLUTTER talk (B110 leftover 4, lead 11-01; the job-chat half is 20261101183017). A Declutter
-- order chat or handover chat message still unread 15 minutes after it arrived sends its recipient ONE reminder
-- (bell + push, through declutter_notify, with the chat's own link); still unread at 2 hours, one more. At most 2
-- reminders per chat per recipient per Louisiana day; nothing 9 PM to 8 AM Central (unread_reminder_quiet), the first
-- run from 8 AM sends what is due. The same rungs and caps as job chat.
--
-- 1. Per-person read state: buyer_read_at / seller_read_at on declutter_order_talks and declutter_handover_talks
--    (the tables had none, so "still unread" could not be known). A message is unread for its recipient when it is
--    newer than the recipient's read_at AND the recipient has not written in that chat since (a reply reads it).
-- 2. declutter_mark_talk_read(p_kind, p_ref): the caller marks their side read ('order': p_ref = the order id;
--    'handover': p_ref = the talk id). Only the chat's buyer or seller; anyone else: item_not_found.
-- 3. sweep_declutter_talk_reminders(p_now): every 5 minutes (cron), once per (recipient, message, rung)
--    (declutter_talk_reminder_sends). Skipped: a blocked pair, a deleted sender, messages older than 7 days.
-- MONEY: none. REPLAY-SAFE: IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name; grants by role name.
-- Proof: src/test/pglite/declutterTalkUnreadReminders.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).

ALTER TABLE public.declutter_order_talks ADD COLUMN IF NOT EXISTS buyer_read_at timestamptz;
ALTER TABLE public.declutter_order_talks ADD COLUMN IF NOT EXISTS seller_read_at timestamptz;
ALTER TABLE public.declutter_handover_talks ADD COLUMN IF NOT EXISTS buyer_read_at timestamptz;
ALTER TABLE public.declutter_handover_talks ADD COLUMN IF NOT EXISTS seller_read_at timestamptz;

CREATE TABLE IF NOT EXISTS public.declutter_talk_reminder_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- A declutter_order_talk_messages or declutter_handover_talk_messages id (kind says which).
  message_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('order', 'handover')),
  -- The chat, for the 2-a-day cap: '<kind>:<talk id>'.
  conversation text NOT NULL,
  rung smallint NOT NULL CHECK (rung IN (1, 2)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id, rung)
);
ALTER TABLE public.declutter_talk_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_talk_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.declutter_talk_reminder_sends TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.declutter_mark_talk_read(p_kind text, p_ref uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_buyer uuid;
  v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'order' THEN
    SELECT o.buyer_id, o.seller_id INTO v_buyer, v_seller FROM public.declutter_orders o WHERE o.id = p_ref;
    IF v_uid IS DISTINCT FROM v_buyer AND v_uid IS DISTINCT FROM v_seller THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.declutter_order_talks t
       SET buyer_read_at = CASE WHEN v_uid = v_buyer THEN now() ELSE t.buyer_read_at END,
           seller_read_at = CASE WHEN v_uid = v_seller THEN now() ELSE t.seller_read_at END
     WHERE t.order_id = p_ref;
  ELSIF p_kind = 'handover' THEN
    SELECT h.buyer_id, h.seller_id INTO v_buyer, v_seller FROM public.declutter_handover_talks h WHERE h.id = p_ref;
    IF v_uid IS DISTINCT FROM v_buyer AND v_uid IS DISTINCT FROM v_seller THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.declutter_handover_talks h
       SET buyer_read_at = CASE WHEN v_uid = v_buyer THEN now() ELSE h.buyer_read_at END,
           seller_read_at = CASE WHEN v_uid = v_seller THEN now() ELSE h.seller_read_at END
     WHERE h.id = p_ref;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_talk_read(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_talk_read(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sweep_declutter_talk_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
  v_rung smallint;
  v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_today integer;
BEGIN
  IF public.unread_reminder_quiet(p_now) THEN
    RETURN 0;
  END IF;
  -- One row per (chat, recipient): the OLDEST message to them that is still unread and at least 15 minutes old.
  FOR r IN
    WITH msgs AS (
      SELECT 'order'::text AS kind, t.id AS talk_id, m.id, m.created_at, m.sender_id,
             CASE WHEN m.sender_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END AS to_id,
             CASE WHEN m.sender_side = 'buyer' THEN t.seller_read_at ELSE t.buyer_read_at END AS read_at,
             m.sender_side AS from_side,
             CASE WHEN m.sender_side = 'buyer' THEN '/declutter?tab=selling&order_talk=' ELSE '/declutter?tab=buying&order_talk=' END
               || o.id::text AS link
        FROM public.declutter_order_talk_messages m
        JOIN public.declutter_order_talks t ON t.id = m.talk_id
        JOIN public.declutter_orders o ON o.id = t.order_id
      UNION ALL
      SELECT 'handover', h.id, m.id, m.created_at, m.sender_id,
             CASE WHEN m.sender_id = h.buyer_id THEN h.seller_id ELSE h.buyer_id END,
             CASE WHEN m.sender_id = h.buyer_id THEN h.seller_read_at ELSE h.buyer_read_at END,
             CASE WHEN m.sender_id = h.buyer_id THEN 'buyer' ELSE 'seller' END,
             CASE WHEN m.sender_id = h.buyer_id THEN '/declutter?tab=selling&talk=' ELSE '/declutter?tab=buying&talk=' END
               || h.id::text
        FROM public.declutter_handover_talk_messages m
        JOIN public.declutter_handover_talks h ON h.id = m.talk_id
    ), mine AS (
      SELECT 'order'::text AS kind, m.talk_id, m.sender_id, m.created_at FROM public.declutter_order_talk_messages m
      UNION ALL
      SELECT 'handover', m.talk_id, m.sender_id, m.created_at FROM public.declutter_handover_talk_messages m
    )
    SELECT DISTINCT ON (x.kind, x.talk_id, x.to_id) x.*, x.kind || ':' || x.talk_id::text AS conv
      FROM msgs x
     WHERE x.to_id IS NOT NULL AND x.sender_id IS NOT NULL AND x.sender_id <> x.to_id
       AND x.created_at <= p_now - interval '15 minutes'
       AND x.created_at > p_now - interval '7 days'
       AND (x.read_at IS NULL OR x.created_at > x.read_at)
       -- A reply reads it.
       AND NOT EXISTS (SELECT 1 FROM mine y WHERE y.kind = x.kind AND y.talk_id = x.talk_id AND y.sender_id = x.to_id
                         AND y.created_at > x.created_at)
       AND NOT COALESCE(public.are_users_blocked(x.sender_id, x.to_id), false)
     ORDER BY x.kind, x.talk_id, x.to_id, x.created_at
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.declutter_talk_reminder_sends s
                    WHERE s.user_id = r.to_id AND s.message_id = r.id AND s.rung = 1) THEN
      v_rung := 1;
    ELSIF r.created_at <= p_now - interval '2 hours'
      AND NOT EXISTS (SELECT 1 FROM public.declutter_talk_reminder_sends s
                       WHERE s.user_id = r.to_id AND s.message_id = r.id AND s.rung = 2)
      AND EXISTS (SELECT 1 FROM public.declutter_talk_reminder_sends s
                   WHERE s.user_id = r.to_id AND s.message_id = r.id AND s.rung = 1
                     AND s.sent_at <= p_now - interval '1 hour') THEN
      v_rung := 2;
    ELSE
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_today FROM public.declutter_talk_reminder_sends s
     WHERE s.user_id = r.to_id AND s.conversation = r.conv AND s.sent_at >= v_day_start;
    IF v_today >= 2 THEN
      CONTINUE;
    END IF;
    INSERT INTO public.declutter_talk_reminder_sends (user_id, message_id, kind, conversation, rung, sent_at)
    VALUES (r.to_id, r.id, r.kind, r.conv, v_rung, p_now)
    ON CONFLICT DO NOTHING;
    -- The two rungs differ in words, so an exact-duplicate filter never drops the second. Never the words themselves.
    PERFORM public.declutter_notify(r.to_id, 'declutter_sales', 'Unread message',
      'The ' || r.from_side || CASE WHEN v_rung = 1 THEN ' is waiting on your reply' ELSE ' is still waiting on your reply' END
        || CASE WHEN r.kind = 'order' THEN ' about your order.' ELSE ' about the handover.' END
        || ' Next: open the message and reply.',
      r.link, r.sender_id);
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_declutter_talk_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_declutter_talk_reminders(timestamptz) TO service_role;

-- Both chats' unread sweeps in one call, for the one cron job below. Service role only. Each half runs in its own
-- block and is recorded on its own: its count in the job's cron_run_log row ({"job_chats": n, "declutter_chats": n}),
-- or, when it fails, NULL there, its name in "failed" and a cron defect (log_cron_defect), so one failing half
-- shows up and never stops the other.
CREATE OR REPLACE FUNCTION public.sweep_chat_unread_reminders(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_jobs integer;
  v_declutter integer;
  v_failed text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_jobs := public.sweep_unread_message_reminders(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'job_chats');
    PERFORM public.log_cron_defect('sweep_chat_unread_reminders', 'sweep_unread_message_reminders', SQLERRM, NULL);
  END;
  BEGIN
    v_declutter := public.sweep_declutter_talk_reminders(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'declutter_chats');
    PERFORM public.log_cron_defect('sweep_chat_unread_reminders', 'sweep_declutter_talk_reminders', SQLERRM, NULL);
  END;
  RETURN jsonb_build_object('job_chats', v_jobs, 'declutter_chats', v_declutter)
         || CASE WHEN cardinality(v_failed) > 0 THEN jsonb_build_object('failed', to_jsonb(v_failed)) ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_chat_unread_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_chat_unread_reminders(timestamptz) TO service_role;

-- The sweep rides the job-chat unread sweep's cron job (sweep-unread-message-reminders, 20261101183017) instead of a
-- job of its own: every 5-minute offset already starts CRON_RESERVE_FLOOR jobs at some minute of the day
-- (cronStartsSpreadAcrossMinutes), so a sixth /5 job cannot fit. Same cadence, same quiet hours; the job records
-- both sweeps' sends as one count. Re-scheduled by name (replay-safe).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    UPDATE public.cron_work_expectations
       SET note = 'Owner 11-01: a job-chat message, and (lead 11-01) a Declutter order or handover chat message, unread at 15 minutes and at 2 hours reminds its recipient (2 a day per conversation, none 9 PM-8 AM).'
     WHERE jobname = 'sweep-unread-message-reminders';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('sweep-unread-message-reminders', '1-59/5 * * * *',
      $c$SELECT public.cron_record_work('sweep-unread-message-reminders', to_jsonb(public.sweep_chat_unread_reminders()));$c$);
  END IF;
END
$do$;
