-- Q262 (receiver half), 2026-09-24.
--
-- Owner decision (pop-up, 2026-09-24): when an account is deleted, the
-- messages a SURVIVING user sent to it are KEPT. So messages.receiver_id
-- becomes nullable and references auth.users ON DELETE SET NULL. (The sender
-- half, messages_sender_id_fkey ON DELETE CASCADE, is 20260924010547.)
--
-- Measured live before this was written (fncmgoasalhdgfwzhsqa, 2026-09-24):
-- no FK on receiver_id, attnotnull = true, 0 rows whose receiver_id has no
-- auth.users row, so the constraint validates without a cleanup step.
--
-- Every server reader of receiver_id was read with pg_get_functiondef:
--   * can_message_in_job / can_send_message_to_in_job / get_messaging_closes_at
--     compare `= <uuid>`, never true for NULL: a kept message grants nothing,
--     and the INSERT policy (can_send_message_to_in_job(job, NULL) = false)
--     refuses any new row with no receiver from a user.
--   * notify_message_recipient already returns early on a NULL receiver.
--   * enforce_block_on_message_insert is INSERT-only.
--   * get_my_reply_latency: LEAST/GREATEST skip the NULL, so a kept message
--     forms a thread of the sender's own turns only and yields no reply sample.
--   * RLS: "mark as read" and the receiver branch of "view" use
--     auth.uid() = receiver_id, NULL-safe (the sender branch still shows it).
--   * insert_job_status_system_message DID assume it: it fans a system row out
--     to "the other participant" of each thread, which for a kept message is
--     now NULL. Replaced below to skip a NULL participant (a system row for a
--     deleted account is addressed to nobody) and a NULL poster (an ownerless
--     job has no sender for the NOT NULL sender_id; before this that insert
--     raised 23502 and aborted the job's status change).
--
-- The SET NULL itself is an UPDATE on messages and runs its BEFORE UPDATE
-- triggers. The auth row is deleted by GoTrue (auth.admin.deleteUser) or the
-- postgres/service role, where auth.uid() is NULL and is_server_context() is
-- true: enforce_message_non_sender_read_only and stamp_message_read_at return
-- early, enforce_ban_gate only acts when auth.uid() IS NOT NULL, and the
-- UPDATE OF content / reply_to_id triggers do not fire for a receiver_id-only
-- update. No public function deletes from auth.users (checked live).
--
-- The FK lookup on receiver_id is served by idx_messages_receiver_created.
-- Client: src/lib/deletedCounterparty.ts. Guard:
-- src/test/messagesReceiverNullable.test.ts.

ALTER TABLE public.messages ALTER COLUMN receiver_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'messages_receiver_id_fkey'
                    AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_receiver_id_fkey
      FOREIGN KEY (receiver_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.insert_job_status_system_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
BEGIN
  -- Only fire on meaningful status transitions
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Q262: an ownerless job (poster deleted, customer_id SET NULL) has nobody
  -- to attribute the row to, and messages.sender_id is NOT NULL.
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Compare on ::text so an unknown label degrades to NULL (no message)
  -- instead of raising an enum-cast error that would abort the transition.
  v_content := CASE NEW.status::text
    WHEN 'accepted'    THEN '✓ Job awarded'
    WHEN 'in_progress' THEN '▶ Work started'
    WHEN 'completed'   THEN '✓ Job completed'
    WHEN 'cancelled'   THEN '✕ Job cancelled'
    WHEN 'disputed'    THEN '⚠ Dispute opened'
    ELSE NULL
  END;

  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Insert one system message per unique participant in this job's threads.
  -- `sender_id = NEW.customer_id` (poster) satisfies the NOT NULL
  -- constraint on the column; `is_system=true` is what marks the row as
  -- system-generated in the UI, so poster-attribution here is a semantic
  -- no-op — both parties see the same system-styled row.
  -- Q262: a participant is NULL when that account was deleted
  -- (messages_receiver_id_fkey ON DELETE SET NULL); nobody to tell.
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NEW.customer_id,
    p.participant,
    v_content,
    false,
    true
  FROM (
    SELECT CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END AS participant
    FROM messages m
    WHERE m.job_id = NEW.id
      AND m.is_system = false
      AND m.sender_id IS NOT NULL
  ) p
  WHERE p.participant IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Restate the live ACL (measured 2026-09-24: postgres + service_role only).
REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_job_status_system_message() TO service_role;
