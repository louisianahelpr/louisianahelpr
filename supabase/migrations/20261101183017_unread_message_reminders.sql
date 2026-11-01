-- Unread-message reminders (owner, 11-01, through the lead: "The owner missed a Helpr's message: no text,
-- no push"). A job-chat message still unread 15 minutes after it arrived sends its recipient ONE reminder
-- (bell + push + text when opted in); still unread at 2 hours, one more. At most 2 reminders per conversation
-- (recipient, job, sender) per Louisiana day. Nothing is written 9 PM to 8 AM Central: the sweep simply does not
-- send then, and the first run from 8 AM sends what is due (the "queue to 8 AM").
--
-- Channels are the ones a message already uses: the reminder is a notifications row of type 'message' with the
-- SAME link notify_message_recipient writes ('/messages?jobId=<job>&userId=<sender>'), so
--   * fan_out_push_on_notification pushes it (push_enabled still wins),
--   * sms_fan_out_on_notification queues a text: sms_kind_for maps type 'message' to the 'message' kind, whose
--     fixed phrase is smsPolicy's "You have a new message."; sms_claim_due checks consent (sms_opt_in), quiet
--     hours and that the alert is still unread,
--   * mark_message_notifications_read marks it read the moment the thread is read (it matches that link).
-- Skipped like the original notice: a muted thread (thread_mutes, unexpired), a hidden (flagged) message, a
-- system row, a team thread (support has its own owner text), a self-send. The seed boundary trigger on
-- notifications still drops a seed actor's row to a real member.
--
-- Not covered here (handoff, b102): Declutter handover / order talk and delivery (helpr_task) talk have NO read
-- state per participant (their tables carry no read column, measured read-only 2026-11-01), so "still unread"
-- cannot be known for them yet; and the "needs you" deadline reminders (approve, still on, pay).
--
-- Once per (recipient, message, rung): public.unread_message_reminder_sends. Replay-safe: IF NOT EXISTS,
-- CREATE OR REPLACE, cron.schedule by name. Proof: src/test/pglite/unreadMessageReminders.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.unread_message_reminder_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  -- The conversation, for the 2-a-day cap: '<job_id>:<sender_id>'.
  conversation text NOT NULL,
  -- 1 = the 15-minute reminder, 2 = the 2-hour one.
  rung smallint NOT NULL CHECK (rung IN (1, 2)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id, rung)
);
-- No second index: the primary key leads with user_id, and the cap reads one member's few rows of the day.
ALTER TABLE public.unread_message_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unread_message_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unread_message_reminder_sends TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- True from 9 PM to 8 AM Louisiana time: no reminder is written then.
CREATE OR REPLACE FUNCTION public.unread_reminder_quiet(p_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT extract(hour FROM (p_at AT TIME ZONE 'America/Chicago')) >= 21
      OR extract(hour FROM (p_at AT TIME ZONE 'America/Chicago')) < 8;
$fn$;
REVOKE ALL ON FUNCTION public.unread_reminder_quiet(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unread_reminder_quiet(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_unread_message_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
  v_rung smallint;
  v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_today integer;
  v_name text;
BEGIN
  IF public.unread_reminder_quiet(p_now) THEN
    RETURN 0;
  END IF;

  -- One row per conversation: its OLDEST unread message at least 15 minutes old.
  FOR r IN
    SELECT DISTINCT ON (m.receiver_id, m.job_id, m.sender_id)
           m.id, m.receiver_id, m.sender_id, m.job_id, m.created_at,
           m.job_id::text || ':' || m.sender_id::text AS conv
      FROM public.messages m
     WHERE m.read = false
       AND m.created_at <= p_now - interval '15 minutes'
       -- Older than a week is not a reminder, it is an archive.
       AND m.created_at > p_now - interval '7 days'
       AND m.job_id IS NOT NULL
       AND m.team_thread_user_id IS NULL
       AND COALESCE(m.is_system, false) = false
       AND COALESCE(m.flagged_hidden, false) = false
       AND m.sender_id IS NOT NULL AND m.receiver_id IS NOT NULL AND m.sender_id <> m.receiver_id
       AND NOT EXISTS (
         SELECT 1 FROM public.thread_mutes tm
          WHERE tm.user_id = m.receiver_id AND tm.job_id = m.job_id AND tm.other_user_id = m.sender_id
            AND (tm.mute_until IS NULL OR tm.mute_until > p_now))
     ORDER BY m.receiver_id, m.job_id, m.sender_id, m.created_at
  LOOP
    -- Which rung is due: the 15-minute one first; the 2-hour one only after it, at least 2 hours after the
    -- message and at least 1 hour after the first reminder (a message first reminded at 8 AM after a quiet
    -- night does not get its second one in the same run).
    IF NOT EXISTS (SELECT 1 FROM public.unread_message_reminder_sends s
                    WHERE s.user_id = r.receiver_id AND s.message_id = r.id AND s.rung = 1) THEN
      v_rung := 1;
    ELSIF r.created_at <= p_now - interval '2 hours'
      AND NOT EXISTS (SELECT 1 FROM public.unread_message_reminder_sends s
                       WHERE s.user_id = r.receiver_id AND s.message_id = r.id AND s.rung = 2)
      AND EXISTS (SELECT 1 FROM public.unread_message_reminder_sends s
                   WHERE s.user_id = r.receiver_id AND s.message_id = r.id AND s.rung = 1
                     AND s.sent_at <= p_now - interval '1 hour') THEN
      v_rung := 2;
    ELSE
      CONTINUE;
    END IF;

    -- At most 2 reminders per conversation per Louisiana day.
    SELECT count(*) INTO v_today FROM public.unread_message_reminder_sends s
     WHERE s.user_id = r.receiver_id AND s.conversation = r.conv AND s.sent_at >= v_day_start;
    IF v_today >= 2 THEN
      CONTINUE;
    END IF;

    SELECT public.member_display_name(full_name, 'Someone') INTO v_name FROM public.profiles WHERE user_id = r.sender_id;
    INSERT INTO public.unread_message_reminder_sends (user_id, message_id, conversation, rung, sent_at)
    VALUES (r.receiver_id, r.id, r.conv, v_rung, p_now)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      r.receiver_id,
      'Unread message',
      -- The two rungs differ in words, so suppress_exact_duplicate_notification never drops the second.
      COALESCE(v_name, 'Someone') || CASE WHEN v_rung = 1 THEN ' is waiting on your reply.' ELSE ' is still waiting on your reply.' END
        || ' Next: open the message and reply.',
      'message',
      '/messages?jobId=' || r.job_id::text || '&userId=' || r.sender_id::text,
      r.job_id
    );
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_unread_message_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unread_message_reminders(timestamptz) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('sweep-unread-message-reminders', interval '30 minutes',
            'Owner 11-01: a job-chat message unread at 15 minutes and at 2 hours reminds its recipient (2 a day per conversation, none 9 PM-8 AM).',
            'exempt', 'Most runs find no unread message at a reminder edge: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('sweep-unread-message-reminders', '0-59/5',
      $c$SELECT public.cron_record_work('sweep-unread-message-reminders', to_jsonb(public.sweep_unread_message_reminders()));$c$);
  END IF;
END
$do$;
