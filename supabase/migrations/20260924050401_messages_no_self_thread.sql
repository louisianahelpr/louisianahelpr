-- DH-002: the database accepted a message thread a user has with THEMSELVES
-- (the poster's "Ask a question" on their own job navigated to
-- /messages?userId=<self>). 0 such rows live (2026-09-24). `<>` passes when
-- either side is NULL, so system rows without a sender/receiver are unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_not_to_self' AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_not_to_self CHECK (sender_id <> receiver_id);
  END IF;
END $$;
