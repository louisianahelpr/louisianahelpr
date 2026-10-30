-- Messages audit E3 (10-30) H1 + M6 + M4, owner 09:12 via the lead: "new-message email, ON for everyone by default".
--
-- Before (prod, read 2026-10-30): notify_message_recipient (md5 of pg_get_functiondef 39b1a493) inserted one bell row
-- per message with an 80-character preview; fan_out_push_on_notification turned every row into a push. No email was
-- ever sent for a message (0 rows in notification_logs category 'messages'): the Settings "Messages" email switch
-- (email_messages, DEFAULT false, 5 members on) gated a send nobody made. A muted thread (thread_mutes, "Hide
-- alerts") still pushed.
--
-- After:
--   1. notify_message_recipient is restated from that prod definition, changing only:
--      a. a muted thread (thread_mutes row for the recipient, this job and the sender) gets no bell, no push and no
--         email; the unread count in Messages still moves (M4).
--      b. at most one alert per conversation per 15 minutes for the recipient, the way Declutter order chat does
--         (20261030004216): the last 'message' bell row for the same conversation link inside 15 minutes holds the
--         next one back. A transaction advisory lock on (recipient, link) keeps two messages sent at the same
--         moment from both passing (M6).
--      c. the member's new message_preview switch (DEFAULT true): off, the bell and push say "Sent you a message."
--         instead of the words (M6).
--      d. one email per alert, through send-notification-email with type 'message' (its TYPE_MAP already gates
--         'message' on email_messages and the Email master switch, and applies the seed boundary). The email never
--         carries the message text: only who wrote and a link to the conversation (H1). A failed queue goes to
--         error_logs; the bell row has already landed.
--   2. email_messages DEFAULT true, and every existing row set to true once (owner: ON for everyone). The switch was
--      dead (no message email was ever sent), so no member's off was ever a choice that did anything. The UPDATE
--      runs only while the column still defaults false, so a replay never overrides a member's later choice.
--
-- Grants unchanged: the trigger function stays executable by postgres and service_role only.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, the once-only default flip. Applied 3x in PGlite
-- (src/test/pglite/messageAlertThrottleMute.pglite.mjs).

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS message_preview boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.notification_preferences.message_preview IS
  'Messages audit M6: true = new-message alerts (bell and push) show the first words of the message; false = "Sent you a message." only. Emails never carry the words.';

-- Once only: while the column still defaults false (the state before this migration). A replay finds the default
-- already true and leaves every member's later choice alone.
DO $once$
BEGIN
  IF (SELECT c.column_default FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'notification_preferences'
         AND c.column_name = 'email_messages') IS DISTINCT FROM 'true' THEN
    ALTER TABLE public.notification_preferences ALTER COLUMN email_messages SET DEFAULT true;
    UPDATE public.notification_preferences SET email_messages = true WHERE email_messages IS DISTINCT FROM true;
  END IF;
END
$once$;

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
  -- The unread count in Messages still moves; mute is not "ignore".
  IF NEW.job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.thread_mutes tm
     WHERE tm.user_id = NEW.receiver_id
       AND tm.job_id = NEW.job_id
       AND tm.other_user_id = NEW.sender_id
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
GRANT EXECUTE ON FUNCTION public.notify_message_recipient() TO service_role;
