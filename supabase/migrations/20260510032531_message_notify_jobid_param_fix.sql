-- Hotfix to 20260506420000 + 20260506460000 (the chat-notify trigger).
--
-- Bug: notify_message_recipient set link='/messages?job=<jobId>' but
-- src/pages/Messages.tsx parses `?jobId=` (camelCase, line 69:
--   const deepLinkJobId = searchParams.get("jobId");
-- ). Mismatch means tapping the push lands on the messages list with
-- no thread auto-opened. Recipient has to scroll the conversation
-- list to find the right one — defeats the whole point of the deep
-- link.
--
-- Fix: emit `jobId=` (matching the parser). Pure data fix — function
-- replaced via CREATE OR REPLACE; trigger binding from 420000
-- unchanged.
--
-- Also bumps the link value to include `&userId=` if we knew the
-- sender — actually we DON'T need to, because Messages.tsx will
-- resolve the conversation from job_id alone (helper-poster pair is
-- determined by job ownership). Keeping the link minimal.

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

  -- Skip messages flagged as hidden by scan_message_content (the off-
  -- platform-content scanner already created a fraud_flag for the
  -- sender; the recipient never sees these in their UI).
  IF NEW.flagged_hidden = true THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name (NULL-safe fallback to "Someone")
  SELECT COALESCE(NULLIF(TRIM(full_name), ''), 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L." privacy convention (matches src/lib/utils.ts formatName)
  IF position(' ' IN sender_name) > 0 THEN
    sender_short := split_part(sender_name, ' ', 1)
      || ' ' || left(split_part(sender_name, ' ', array_length(string_to_array(sender_name, ' '), 1)), 1)
      || '.';
  ELSE
    sender_short := sender_name;
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
  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (
    NEW.receiver_id,
    sender_short,
    preview,
    'message',
    '/messages?jobId=' || COALESCE(NEW.job_id::text, ''),
    false
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;
