-- Add a real read-at timestamp to messages, alongside the existing boolean
-- `read` column. The boolean stays authoritative for unread-count queries
-- (cheap index-friendly filter); read_at is purely for surfacing "Read at
-- <time>" in the chat UI and is only ever set once, on first read.
alter table public.messages
  add column if not exists read_at timestamptz;

-- Backfill: for already-read rows we have no real read moment, so use
-- created_at as a conservative placeholder rather than leaving it null
-- (a null would show the reveal control with nothing to show).
update public.messages
  set read_at = created_at
  where read = true and read_at is null;
