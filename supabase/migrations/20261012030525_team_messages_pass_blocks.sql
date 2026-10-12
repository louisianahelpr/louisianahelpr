-- Q1591(b) (owner pop-up 2026-10-11, "Team messages get through"): a staff
-- message in the "Louisiana Helpr Team" thread is delivered even when the user
-- has blocked that staff member's personal account, and the user can reply in
-- that Team thread. Personal (job) messages stay blocked.
--
-- LAYERS, read live 2026-10-11 (pg_get_functiondef / pg_trigger / proacl):
--   * trg_enforce_block_on_message_insert (BEFORE INSERT ON messages) ran
--     enforce_block_on_message_insert(), SECURITY INVOKER, md5(prosrc)
--     9fbca85d805d91c3dd56f5a2699f0609: outside a server context it raised
--     "You can't message this user." whenever are_users_blocked(sender,
--     receiver). It runs inside admin_send_team_message / send_team_reply too
--     (auth.uid() is set, so is_server_context() is false), so a block either
--     way refused both the admin's message and the user's reply. This is the
--     ONLY server barrier: notify_message_recipient and the notifications
--     fan-out (fan_out_push_on_notification) never read user_blocks (prod:
--     every public function whose source names user_blocks or
--     are_users_blocked, 2026-10-11, does not include them).
--   * The client inbox (loadConversations blockedSet), the nav unread badge
--     (useNavUnreadCount) and the iOS push badge (send-push-notification)
--     filter blocked senders; they exempt team rows in the same commit.
--
-- THE BYPASS, scoped to Team-thread rows only. A row passes the block gate
-- without the block test only when ALL hold:
--   - team_thread_user_id IS NOT NULL and job_id IS NULL (a Team row; the
--     messages_job_xor_team_thread CHECK makes these one fact);
--   - sender_id = auth.uid() (the caller's own send, as both writers make it);
--   - it is either the STAFF side, sender holds the admin role and the
--     receiver is the thread's user, or the USER side, sender is the thread's
--     user and the receiver holds the admin role.
-- A non-staff user can never be the staff side (has_role on the sender), and
-- cannot write a Team row except through send_team_reply, which only ever
-- writes the caller's own thread to the admin who last wrote in it: the
-- client has no INSERT or UPDATE privilege on team_thread_user_id (live
-- information_schema.column_privileges 2026-10-11: authenticated has SELECT
-- and REFERENCES only), and the INSERT policy refuses a job-less row. Every
-- other row (every job message) is tested exactly as before.
--
-- Proof: src/test/pglite/teamMessagesPassBlocks.pglite.mjs (applied 3x; RED
-- with NEW_MIGRATION=skip). Class guard: src/test/teamMessagesPassBlocks.test.ts.
-- Replay-safe: CREATE OR REPLACE; grants restated as live (postgres and
-- service_role EXECUTE only).

CREATE OR REPLACE FUNCTION public.enforce_block_on_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Server contexts only; an anon write (NULL uid, role anon) is checked.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Q1591(b): a "Louisiana Helpr Team" thread row gets through a block, in
  -- both directions, and only between the thread's user and staff.
  IF NEW.team_thread_user_id IS NOT NULL
     AND NEW.job_id IS NULL
     AND NEW.sender_id = auth.uid()
     AND (
       (NEW.receiver_id = NEW.team_thread_user_id
        AND NEW.sender_id <> NEW.team_thread_user_id
        AND COALESCE(public.has_role(NEW.sender_id, 'admin'::public.app_role), false))
       OR
       (NEW.sender_id = NEW.team_thread_user_id
        AND NEW.receiver_id <> NEW.team_thread_user_id
        AND COALESCE(public.has_role(NEW.receiver_id, 'admin'::public.app_role), false))
     )
  THEN
    RETURN NEW;
  END IF;

  IF public.are_users_blocked(NEW.sender_id, NEW.receiver_id) THEN
    RAISE EXCEPTION 'You can''t message this user.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_block_on_message_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_block_on_message_insert() TO service_role;
