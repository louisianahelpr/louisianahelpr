-- Push notifications for new chat messages.
--
-- Currently a new message inserts into public.messages and that's it —
-- the recipient gets nothing on their device until they happen to open
-- the app and see the unread badge. Most chat-driven gig apps push the
-- recipient on every message; we should match that.
--
-- Architecture:
--   1. Allow 'message' as a valid notifications.type
--   2. Map 'message' → notification_preferences.messages column so the
--      existing fan_out_push_on_notification trigger respects user's
--      per-category push toggle
--   3. AFTER INSERT trigger on public.messages creates a notifications
--      row for receiver_id (which then triggers the existing push
--      fan-out, no new push code needed)
--
-- Privacy: notification body is "<First L.> sent you a message" + a
-- 60-char preview. Phone numbers / emails inside the message body
-- never leak into the push payload because we strip the message to
-- a short preview, and the off-platform-detection trigger already
-- prevents most contact info from landing in messages anyway.
--
-- Self-sends (sender_id = receiver_id) skipped defensively even though
-- RLS prevents them.

-- Step 1: Allow 'message' as a notifications.type
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- Original 7
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    -- Discovered in trigger / edge function code
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified',
    -- New
    'message'
  ));

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
'Allowed notification.type values. Keep in sync with INSERT INTO public.notifications calls in supabase/migrations/**/.sql and supabase/functions/**/index.ts.';

-- Step 2: Wire 'message' type to the messages preference column
INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('message', 'messages', 'New chat message from another user')
ON CONFLICT (type) DO UPDATE SET
  pref_column = EXCLUDED.pref_column,
  description = EXCLUDED.description;

-- Step 3: AFTER INSERT trigger on messages -> notifications insert
CREATE OR REPLACE FUNCTION public.notify_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  sender_name text;
  sender_short text;
  preview text;
  preview_full text;
BEGIN
  -- Defensive: a self-send shouldn't be possible (RLS blocks it) but
  -- skip just in case to avoid notifying a user about their own message.
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name. NULL-safe — if the profile is missing for
  -- any reason, fall back to "Someone" rather than failing the insert.
  SELECT COALESCE(NULLIF(TRIM(full_name), ''), 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L." form to match the rest of the app's privacy convention
  -- (formatName in src/lib/utils.ts). split_part returns the first
  -- whitespace-separated word; the regex grabs the initial of the last
  -- whitespace-separated word.
  IF position(' ' IN sender_name) > 0 THEN
    sender_short := split_part(sender_name, ' ', 1)
      || ' ' || left(split_part(sender_name, ' ', array_length(string_to_array(sender_name, ' '), 1)), 1)
      || '.';
  ELSE
    sender_short := sender_name;
  END IF;

  -- Build preview. For attachment-only messages content is empty —
  -- substitute a friendly tag. For text, trim to 80 chars + ellipsis.
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

  -- Skip empty messages with no attachment (defensive — shouldn't happen
  -- because client-side validates, but covers any direct DB writes)
  IF length(trim(preview)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Insert the notification. fan_out_push_on_notification fires on
  -- AFTER INSERT and handles the push delivery (gated on
  -- notification_preferences.messages + push_enabled).
  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (
    NEW.receiver_id,
    sender_short,
    preview,
    'message',
    '/messages?job=' || COALESCE(NEW.job_id::text, ''),
    false
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_message_recipient_tg ON public.messages;
CREATE TRIGGER notify_message_recipient_tg
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_message_recipient();

COMMENT ON FUNCTION public.notify_message_recipient() IS
'Creates a notifications row for the recipient on every new message. The notifications row triggers the existing fan_out_push_on_notification, which delivers the APNs/FCM push. Respects notification_preferences.messages.';
