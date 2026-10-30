-- Messages audit E3 M4 (list #21): a snoozed chat alerts again when the snooze ends.
--
-- notify_message_recipient read ANY thread_mutes row as muted. is_thread_muted and get_muted_threads (what the screen
-- shows) honour mute_until, and nothing deletes an ended snooze, so a member whose 1-hour snooze ended saw the chat as
-- unmuted and got no bell, push or email from it again. Only the mute clause changes; the rest is restated from prod
-- (md5(prosrc) 4d09e5a7d6d7c4b3e11a03c6b3c25980, 2026-10-30). Proof: src/test/pglite/messageSnoozeExpires.pglite.mjs.

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
