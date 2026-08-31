-- Cap message content length server-side.
--
-- WHAT WAS MISSING: there was no length limit on public.messages.content
-- anywhere — not on send, not on the edit feature just added in
-- 20260831003117. A client bug or a direct API call could insert/UPDATE an
-- arbitrarily large row. The client now also enforces this cap (see
-- src/lib/messageLimits.ts, used by both RichMessageInput's send path and
-- ChatView's edit dialog), but the client is not the authority — this
-- CHECK constraint is what actually stops an oversized value.
--
-- 4000 characters is generous for a chat message (well past what any real
-- conversation needs) while still bounding worst-case row/payload size.
-- NULL content is allowed through (attachment-only messages have empty/short
-- content already, and CHECK constraints pass on NULL by SQL semantics —
-- explicit here for clarity, not because it changes behavior).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname = 'messages_content_length_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_content_length_check
      CHECK (content IS NULL OR char_length(content) <= 4000);
  END IF;
END $$;
