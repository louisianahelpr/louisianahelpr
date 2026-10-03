-- A SIGNED-IN CLIENT INSERTS A MESSAGE WITH THE TEN COLUMNS IT SENDS, NOT ALL EIGHTEEN (Q340).
--
-- `authenticated` held TABLE-level INSERT on public.messages (relacl
-- authenticated=ardxm, read live 2026-10-03), so a direct POST /rest/v1/messages
-- could set every column, including the ones only the server writes. The
-- "Users can send messages" policy checks sender, thread membership and the
-- attachment path; it says nothing about these:
--   * is_system    -> a member posts a message the thread renders as a platform
--                     notice (insert_job_status_system_message is the only real
--                     writer, SECURITY DEFINER), and "Users can edit their own
--                     sent messages" refuses is_system rows, so it cannot even
--                     be taken back;
--   * created_at   -> a future timestamp keeps the 15-minute edit window
--                     (created_at > now() - 15 min) open forever; a past one
--                     reorders the thread AND slips under enforce_message_rate's
--                     30-per-hour cap, which counts created_at > now() - 1 hour;
--   * read / read_at, edited_at, id -> state the triggers and the recipient own.
--   (flagged_hidden / flag_reason were never settable in practice:
--   scan_message_content overwrites both on every insert. Revoked anyway.)
-- This is the INSERT door only. The UPDATE path's leftovers (a sender marking
-- their own message read, erasing edited_at) are filed separately.
--
-- The anon half (no signed-out INSERT at all) shipped in 20260925144708. The
-- authenticated half waited on Q387 (an older installed native build might
-- send more columns). Measured instead of waited on, 2026-10-03: every client
-- insert into messages in the WHOLE git history (10 distinct payload shapes,
-- read by the write-contract AST extractor at every commit that touched a file
-- containing from("messages"), 2026-03-11 .. today, none unreadable) names only
-- columns from this list, so no build cut from this repo sends a column this
-- revokes. No edge function inserts into messages.
--
-- THE ORDER MATTERS: a column-level REVOKE does nothing while the role holds
-- the table-level privilege (it implies every column). The table-level INSERT
-- goes first (that also clears any column INSERT grants), then the ten columns
-- are granted back.
--
-- UPDATE (column-level: content, read, edited_at) and DELETE are unchanged.
-- SECURITY DEFINER inserts (insert_job_status_system_message writes read and
-- is_system) run as postgres and are unaffected.
--
-- GUARD: scripts/ci/client-insert-columns.sql, run live by
-- scripts/check-live-privileges.mjs after every db-deploy and nightly, and on
-- the replayed schema by db-smoke; src/test/messagesInsertColumnsClientScoped.test.ts
-- pins its column list to the client's own insert payloads (two-way).
-- REPLAY-SAFE: skipped when public.messages does not exist; fails the deploy
-- if any of the ten columns is missing rather than granting a partial set.

DO $q340$
DECLARE
  v_cols int;
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'messages'
     AND column_name IN ('client_id', 'job_id', 'sender_id', 'receiver_id', 'content',
                         'attachment_url', 'attachment_mime', 'attachment_size',
                         'attachment_duration', 'reply_to_id');
  IF v_cols <> 10 THEN
    RAISE EXCEPTION 'messages_insert_columns_client_scoped: expected 10 client send columns on public.messages, found %', v_cols;
  END IF;

  REVOKE INSERT ON public.messages FROM PUBLIC, anon, authenticated;
  GRANT INSERT (client_id, job_id, sender_id, receiver_id, content,
                attachment_url, attachment_mime, attachment_size,
                attachment_duration, reply_to_id)
     ON public.messages TO authenticated;
END
$q340$;
