-- Q282 + Q262 (sender half), 2026-09-24.
--
-- notification_preferences.user_id had no foreign key, so every account
-- removed by a path that skips purge_user_data (admin-API fixture cleanup,
-- Q205(d)) left its row behind: 255 of 315 rows had no auth.users row when
-- measured 2026-09-24 (none had a profile either). The rows describe nobody,
-- so they are deleted, then ON DELETE CASCADE matches what purge_user_data
-- already does to this table.
--
-- messages.sender_id had no foreign key either (0 orphans measured
-- 2026-09-24). purge_user_data deletes a leaver's sent messages before the
-- auth row goes (their attachment paths must be read first), so CASCADE is a
-- backstop that matches it. The cascade's DELETE runs the messages triggers in
-- service context: enforce_ban_gate passes (auth.uid() is NULL) and
-- enforce_message_non_sender_read_only is UPDATE-only.
-- Second order (review 2026-09-24): deleting those messages SET NULLs
-- reply_to_id on other people's replies (messages_reply_to_id_fkey), an
-- UPDATE that runs the BEFORE UPDATE triggers; is_server_context() is true for
-- GoTrue/postgres/service role, so non_sender_read_only passes, and
-- messages_validate_reply returns early on a NULL reply_to_id.
--
-- messages.receiver_id is NOT touched here: the owner chose (2026-09-24) to
-- keep a survivor's messages to a deleted account (nullable + SET NULL), which
-- needs the client readers changed first. docs/OPEN.md Q262.
--
-- The FK lookup on messages.sender_id is served by idx_messages_sender_created
-- (20260519000000). Guard: src/test/userIdForeignKeys.test.ts.

DELETE FROM public.notification_preferences n
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = n.user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'notification_preferences_user_id_fkey'
                    AND conrelid = 'public.notification_preferences'::regclass) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'messages_sender_id_fkey'
                    AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
