-- "Delete for me" for a message thread (owner-approved site polish, 2026-11-20).
--
-- WHAT WAS MISSING. A member could only ARCHIVE a conversation: it hides from
-- the inbox, sits in the Archived view, and comes back whole (every old
-- message) the moment a new message arrives. There was no way to say "I am done
-- with this conversation, clear it from my side" without the old messages
-- coming back.
--
-- WHAT THIS ADDS. One nullable column on the member's own thread_archives row:
-- cleared_before. When set, every message in that thread created at or before
-- that moment is hidden FROM THIS MEMBER ONLY. The other person still sees the
-- whole thread, and no message row is touched or deleted (messages are kept for
-- disputes and reports). If a new message arrives later, the thread comes back
-- showing only the messages after cleared_before. A cleared thread is not listed
-- in Archived and cannot be restored from there.
--
-- WHY A COLUMN AND NOT A NEW TABLE. It is the same per-member, per-thread,
-- own-rows-only inbox setting as an archive, keyed by the same
-- (user_id, job_id, other_user_id) triple, including the deleted-account NULL
-- row (20260926041106). Extending the row keeps everything that already
-- protects it: owner-only RLS for select/insert/update/delete
-- (20260831011232), grants, the ban-gate exemption (own inbox organisation,
-- invisible to others: scripts/ci/ban-gate-coverage.sql), export_my_data
-- (it exports `to_jsonb(t)` for every row, so a new column is included without
-- a function change), and account deletion (user_id ON DELETE CASCADE). A new
-- table would need each of those rebuilt for no gain.
--
-- How the client writes it (src/lib/archivedConversations.ts):
--   delete for me : upsert archived_at = now, cleared_before = now
--   archive       : upsert archived_at = now (cleared_before untouched)
--   restore       : row with cleared_before -> archived_at = cleared_before
--                   (the thread shows its post-clear messages again);
--                   row without            -> deleted, as before.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; COMMENT is idempotent. The table
-- exists since 20260831011232, which sorts before this file.

ALTER TABLE public.thread_archives
  ADD COLUMN IF NOT EXISTS cleared_before timestamptz NULL;

COMMENT ON COLUMN public.thread_archives.cleared_before IS
  '"Delete for me": messages in this thread created at or before this moment are hidden from user_id only. '
  'NULL = nothing cleared. Never deletes messages; the other party is unaffected.';
