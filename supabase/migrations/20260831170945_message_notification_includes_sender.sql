-- Message notifications never opened the conversation they pointed at.
--
-- notify_message_recipient (20260510032531) built its link as
-- '/messages?jobId=' || NEW.job_id, but useMessagesData.ts required BOTH
-- `jobId` AND `userId` before it would auto-open a thread. Verified against
-- live rows — every type='message' notification in prod carries jobId only:
--     /messages?jobId=e84582b2-1e3b-4db4-8b82-5c09f595e7ea
-- so tapping a new-message notification always landed on the inbox.
--
-- That earlier migration fixed `job=` -> `jobId=` for exactly this reason; the
-- missing second param went unnoticed because the failure is silent — you land
-- somewhere plausible.
--
-- This is the ORIGINAL function body verbatim with only the link expression
-- changed. Everything else is preserved deliberately: the self-send and
-- flagged_hidden guards, the "First L." privacy convention, the
-- attachment-only "Attachment" preview, the 80-char truncation with ellipsis,
-- and the empty-message skip. A from-scratch rewrite dropped four of those on
-- the first attempt.
--
-- The client also now opens on jobId alone when that job has exactly one
-- conversation, which rescues the notifications already in users' lists.

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
    -- BOTH params. `jobId` stays camelCase to match searchParams.get("jobId");
    -- `userId` is the SENDER, who is the "other user" from the recipient's
    -- point of view. The client required both before it would auto-open a
    -- thread, so a jobId-only link always landed on the inbox instead.
    '/messages?jobId=' || COALESCE(NEW.job_id::text, '')
      || '&userId=' || COALESCE(NEW.sender_id::text, ''),
    false
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;
