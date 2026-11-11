-- F443 (whole-app audit 11-10, Worker 5, Medium; job-name half): two bell rows named no job.
--   1. notify_message_recipient turns a job's status row in a chat ("▶ Work started", "✓ Job awarded", ...; written by
--      insert_job_status_system_message with is_system = true) into the receiver's bell row: title = the poster's
--      name, message = "▶ Work started". With several jobs open, the member could not tell which job started.
--      Now a system row's bell message names the job: '▶ Work started: "Paint a fence"'. A member's own message keeps
--      its words as written (it is their text; the thread link already opens the right chat).
--   2. sweep_unread_message_reminders wrote 'Unread message' / "<Name> is waiting on your reply." Now:
--      '<Name> is waiting on your reply about "Paint a fence". Next: open the message and reply.' (job with no title:
--      the old words). The two rungs still differ in words, so suppress_exact_duplicate_notification keeps both.
-- The other half of F443 (a support cancel reason "E2E full ..." shown in the bell) is test-account free text, closed
-- under the deleted-test-accounts rule (owner 11-04).
--
-- Both functions are restated VERBATIM from their newest definitions (20261030212051, 20261101183017), changing only
-- the lines marked CHANGED 20261111194802. No condition, link, type, throttle, email or grant moves.
-- Replay-safe: CREATE OR REPLACE; triggers and cron untouched; grants restated as live.
-- Proof: src/test/pglite/threadNoticesNameTheJob.pglite.mjs (red without this migration, green with it, 3x).

CREATE OR REPLACE FUNCTION public.notify_message_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  sender_short text;
  preview text;
  preview_full text;
  v_link text;
  v_show_preview boolean;
  v_email_on boolean;
  v_job_title text;
BEGIN
  -- Skip self-sends (RLS blocks them but defense-in-depth)
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Skip messages flagged as hidden by scan_message_content (the off-
  -- platform-content scanner already created a fraud_flag for the
  -- sender; the recipient never sees these in their UI).
  IF NEW.flagged_hidden = true THEN
    RETURN NEW;
  END IF;

  -- M4: a muted thread ("Hide alerts") gets no bell, no push and no email.
  -- A snooze that has ended is not a mute, as is_thread_muted and get_muted_threads read it.
  -- The unread count in Messages still moves; mute is not "ignore".
  IF NEW.job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.thread_mutes tm
     WHERE tm.user_id = NEW.receiver_id
       AND tm.job_id = NEW.job_id
       AND tm.other_user_id = NEW.sender_id
       AND (tm.mute_until IS NULL OR tm.mute_until > now())
  ) THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name (NULL-safe fallback to "Someone")
  SELECT public.member_display_name(full_name, 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L.": member_display_name above is formatName (src/lib/utils.ts) in SQL.
  sender_short := sender_name;

  -- Team thread: the staff side speaks as the team, never as one admin.
  IF NEW.team_thread_user_id IS NOT NULL AND NEW.sender_id <> NEW.team_thread_user_id THEN
    sender_short := 'Louisiana Helpr Team';
  END IF;

  -- Build preview. Attachment-only → "📎 Attachment"; text → first 80
  -- chars + ellipsis if longer.
  preview_full := COALESCE(NEW.content, '');
  IF length(trim(preview_full)) = 0 AND NEW.attachment_url IS NOT NULL THEN
    preview := '📎 Attachment';
  ELSE
    IF length(preview_full) > 80 THEN
      preview := left(preview_full, 80) || '…';
    ELSE
      preview := preview_full;
    END IF;
  END IF;

  -- Skip empty messages with no attachment (defensive)
  IF length(trim(preview)) = 0 THEN
    RETURN NEW;
  END IF;

  -- CHANGED 20261111194802 (F443): a job's status row ("▶ Work started") names the job in the bell, so a member with
  -- several jobs can tell which one moved. A member's own words stay as written.
  IF COALESCE(NEW.is_system, false) AND NEW.job_id IS NOT NULL THEN
    SELECT NULLIF(btrim(j.title), '') INTO v_job_title FROM public.jobs j WHERE j.id = NEW.job_id;
    IF v_job_title IS NOT NULL THEN
      preview := preview || ': "' || v_job_title || '"';
    END IF;
  END IF;

  -- IMPORTANT: link param is `jobId` (camelCase), matching
  -- searchParams.get("jobId") in src/pages/Messages.tsx. Earlier
  -- version used `job=` and broke deep-link auto-open.
  -- BOTH params. `jobId` stays camelCase to match searchParams.get("jobId");
  -- `userId` is the SENDER, who is the "other user" from the recipient's
  -- point of view. The client required both before it would auto-open a
  -- thread, so a jobId-only link always landed on the inbox instead.
  -- A team-thread row has no job: `teamThread=<the thread's user>` instead,
  -- still carrying `userId=<sender>` so the seed boundary can see the actor.
  v_link := CASE
    WHEN NEW.team_thread_user_id IS NOT NULL THEN
      '/messages?teamThread=' || NEW.team_thread_user_id::text
        || '&userId=' || COALESCE(NEW.sender_id::text, '')
    ELSE
      '/messages?jobId=' || COALESCE(NEW.job_id::text, '')
        || '&userId=' || COALESCE(NEW.sender_id::text, '')
  END;

  -- M6: at most one alert per conversation per 15 minutes (as Declutter order
  -- chat). The link names the conversation from the recipient's side. The lock
  -- makes two messages committed at the same moment take turns.
  PERFORM pg_advisory_xact_lock(hashtextextended('notify_message_recipient:' || NEW.receiver_id::text || v_link, 0));
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = NEW.receiver_id
       AND n.type = 'message'
       AND n.link = v_link
       AND n.created_at > now() - interval '15 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.message_preview, p.email_messages
    INTO v_show_preview, v_email_on
    FROM public.notification_preferences p
   WHERE p.user_id = NEW.receiver_id;
  -- No row = the column defaults: previews on, message email on.
  v_show_preview := COALESCE(v_show_preview, true);
  v_email_on := COALESCE(v_email_on, true);

  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (
    NEW.receiver_id,
    sender_short,
    CASE WHEN v_show_preview THEN preview ELSE 'Sent you a message.' END,
    'message',
    v_link,
    false
  );

  -- H1: the email. Never the words; send-notification-email re-checks the
  -- Email master and email_messages and the seed boundary itself.
  IF v_email_on THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', NEW.receiver_id,
          'title', 'New message from ' || sender_short,
          'message', sender_short || ' sent you a message on Louisiana Helpr. Open the conversation to read it and reply.',
          'type', 'message',
          'link', v_link,
          'job_id', NEW.job_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- seed-policy: this logs a failed email queue for a message, not a money or job-state alert; it reads jobs only
      -- for the title (F443). A seed conversation's failed queue is the same defect as a real one, so both are logged.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error', 'new-message email could not be queued',
              jsonb_build_object('source', 'notify_message_recipient'),
              jsonb_build_object('user_id', NEW.receiver_id::text, 'error', SQLERRM));
    END;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;

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
  v_job_title text;
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
    -- CHANGED 20261111194802 (F443): the reminder names the job the message is about.
    v_job_title := NULL;
    SELECT NULLIF(btrim(j.title), '') INTO v_job_title FROM public.jobs j WHERE j.id = r.job_id;
    INSERT INTO public.unread_message_reminder_sends (user_id, message_id, conversation, rung, sent_at)
    VALUES (r.receiver_id, r.id, r.conv, v_rung, p_now)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      r.receiver_id,
      'Unread message',
      -- The two rungs differ in words, so suppress_exact_duplicate_notification never drops the second.
      COALESCE(v_name, 'Someone') || CASE WHEN v_rung = 1 THEN ' is waiting on your reply' ELSE ' is still waiting on your reply' END
        || COALESCE(' about "' || v_job_title || '"', '') || '. Next: open the message and reply.',
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
