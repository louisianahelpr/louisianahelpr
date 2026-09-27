-- Q755 (owner decision 2026-09-27: "Mark read with thread"). Reading a chat
-- never cleared the bell. Every message spawns a type='message' notifications
-- row (notify_message_recipient), but opening the thread only sets
-- messages.read, so the bell and the app-icon badge (messages + notifications,
-- N-006) kept counting messages the user had already read. Measured live
-- 2026-09-27: 221 unread type='message' notifications.
--
-- Fix: when a message flips to read, mark read the receiver's type='message'
-- notifications for the same thread. A thread's notification link is exactly
-- what notify_message_recipient writes:
--   '/messages?jobId=' || coalesce(job_id,'') || '&userId=' || sender_id
-- (older rows may carry only '/messages?jobId=<job>'). Then a one-time backfill
-- clears the notifications whose thread has no unread message left.
--
-- SECURITY DEFINER so the update does not depend on the notifications RLS
-- policies of whoever flips messages.read; it only touches NEW.receiver_id's rows.
-- Only the receiver (or server code) clears the receiver's bell: a sender may
-- still edit their own message for 15 minutes, read column included, and that
-- must not mark the receiver's notifications read.

CREATE OR REPLACE FUNCTION public.mark_message_notifications_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_server_context() AND auth.uid() IS DISTINCT FROM NEW.receiver_id THEN
    RETURN NULL;
  END IF;
  UPDATE public.notifications n
     SET read = true
   WHERE n.user_id = NEW.receiver_id
     AND n.type = 'message'
     AND n.read = false
     AND (
       n.link = '/messages?jobId=' || COALESCE(NEW.job_id::text, '') || '&userId=' || COALESCE(NEW.sender_id::text, '')
       OR (NEW.job_id IS NOT NULL AND n.link = '/messages?jobId=' || NEW.job_id::text)
     );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_message_notifications_read() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mark_message_notifications_read ON public.messages;
CREATE TRIGGER trg_mark_message_notifications_read
  AFTER UPDATE OF read ON public.messages
  FOR EACH ROW
  WHEN (NEW.read AND NOT OLD.read)
  EXECUTE FUNCTION public.mark_message_notifications_read();

-- Backfill: a thread notification whose thread has no unread message left.
UPDATE public.notifications n
   SET read = true
 WHERE n.type = 'message'
   AND n.read = false
   AND n.link ~ '^/messages\?jobId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(&userId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
   AND NOT EXISTS (
     SELECT 1
       FROM public.messages m
      WHERE m.receiver_id = n.user_id
        AND m.read = false
        AND m.job_id IS NOT DISTINCT FROM NULLIF(substring(n.link FROM 'jobId=([0-9a-f-]*)'), '')::uuid
        AND (substring(n.link FROM 'userId=([0-9a-f-]+)') IS NULL
             OR m.sender_id = substring(n.link FROM 'userId=([0-9a-f-]+)')::uuid)
   );
