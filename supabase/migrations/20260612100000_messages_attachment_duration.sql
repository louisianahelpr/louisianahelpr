-- Add attachment_duration to the messages table so voice notes can store
-- their length in seconds. Idempotent. No new RLS needed (adding a column
-- to an existing RLS-enabled table inherits existing policies).
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_duration int;
