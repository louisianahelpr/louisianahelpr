-- Hotfix to 20260506420000_message_notifications.sql
--
-- Bug: notify_message_recipient_tg fires AFTER INSERT on every message
-- row. The scan_message_content BEFORE INSERT scanner from migration
-- 20260418082439 sets `NEW.flagged_hidden = true` on off-platform-content
-- violations but ALLOWS the row to land (it doesn't RAISE). So the
-- recipient was about to get a push notification ("Marie B. — Call me
-- at 504...") about a message they would never actually see in their
-- inbox because the UI hides flagged messages.
--
-- Fix: short-circuit notify_message_recipient when flagged_hidden=true.
-- The sender already gets a separate violation-warning toast client-side,
-- and admins get a fraud_flags row from the scanner — no recipient push
-- is the correct behavior.
--
-- This migration is idempotent (CREATE OR REPLACE FUNCTION).

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
  -- Skip self-sends (RLS blocks them but defense-in-depth)
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Skip messages flagged as hidden by scan_message_content. The
  -- recipient never sees these in their inbox UI, so they shouldn't
  -- get a push about them either.
  IF NEW.flagged_hidden = true THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name (NULL-safe fallback to "Someone")
  SELECT COALESCE(NULLIF(TRIM(full_name), ''), 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L." form (privacy convention from src/lib/utils.ts formatName)
  IF position(' ' IN sender_name) > 0 THEN
    sender_short := split_part(sender_name, ' ', 1)
      || ' ' || left(split_part(sender_name, ' ', array_length(string_to_array(sender_name, ' '), 1)), 1)
      || '.';
  ELSE
    sender_short := sender_name;
  END IF;

  -- Build preview. Attachment-only messages get "📎 Attachment" tag;
  -- text gets first 80 chars + ellipsis.
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
