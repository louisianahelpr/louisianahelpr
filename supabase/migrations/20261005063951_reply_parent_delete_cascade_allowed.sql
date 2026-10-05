-- Q1242 (docs/OPEN.md): a person could not delete a message the other party
-- had replied to.
--
-- messages_reply_to_id_fkey is ON DELETE SET NULL. Deleting the parent fires
-- the FK's cascade, which UPDATEs the reply (reply_to_id -> NULL) inside the
-- deleter's request: auth.uid() is the deleter, who did not send the reply, so
-- enforce_message_non_sender_read_only raised "a message may only be edited
-- by the person who sent it" and the DELETE failed as a whole (the client
-- shows "Couldn't delete that one"). Live 2026-10-03: 1 such reply.
--
-- The trigger now lets exactly the FK's own action through (see the comment
-- in the body); a client's own change of reply_to_id on someone else's
-- message is still refused.
--
-- Restated from its newest definition, 20261004001242 (md5(prosrc) live
-- 2026-10-05 816df9b5562b573d904422f7f9c8f0bf = that file), plus the one
-- branch. Replay-safe: CREATE OR REPLACE; the trigger is unchanged.
-- Guard: src/test/replyParentDeleteCascade.test.ts +
-- src/test/pglite/replyParentDeleteCascade.pglite.mjs.

CREATE OR REPLACE FUNCTION public.enforce_message_non_sender_read_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / cron / edge functions: not a user write. anon is.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Q1242: the reply_to_id self-FK is ON DELETE SET NULL, and that cascade
  -- UPDATEs the reply while the DELETER's request is still in place, so it
  -- arrived here as a non-sender's write and failed the whole DELETE ("a
  -- message may only be edited by the person who sent it"): nobody could
  -- delete a message the other party had replied to. Let exactly the FK's own
  -- action through: inside another trigger (the RI action, pg_trigger_depth()
  -- > 1), reply_to_id going to NULL, the message it named already gone, and
  -- not one other column changed. A client's own PATCH of reply_to_id is
  -- depth 1 and still refused below.
  IF pg_trigger_depth() > 1
     AND OLD.reply_to_id IS NOT NULL
     AND NEW.reply_to_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.messages p WHERE p.id = OLD.reply_to_id)
     AND (to_jsonb(NEW) - 'reply_to_id') = (to_jsonb(OLD) - 'reply_to_id')
  THEN
    RETURN NEW;
  END IF;

  -- The sender's own edit is governed by the 15-minute window in the edit
  -- policy, which is where that rule belongs. The read receipt is not the
  -- sender's (Q1166): read / read_at belong to the receiver, so a sender's
  -- change to them is IGNORED, not refused (a mark-read statement that also
  -- matches a row the caller sent must not fail as a whole).
  IF auth.uid() = OLD.sender_id THEN
    NEW.read    := OLD.read;
    NEW.read_at := OLD.read_at;
    RETURN NEW;
  END IF;

  IF NEW.content              IS DISTINCT FROM OLD.content
  OR NEW.edited_at            IS DISTINCT FROM OLD.edited_at
  OR NEW.id                   IS DISTINCT FROM OLD.id
  OR NEW.job_id               IS DISTINCT FROM OLD.job_id
  OR NEW.sender_id            IS DISTINCT FROM OLD.sender_id
  OR NEW.receiver_id          IS DISTINCT FROM OLD.receiver_id
  OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  OR NEW.is_system            IS DISTINCT FROM OLD.is_system
  OR NEW.reply_to_id          IS DISTINCT FROM OLD.reply_to_id
  OR NEW.attachment_url       IS DISTINCT FROM OLD.attachment_url
  OR NEW.attachment_mime      IS DISTINCT FROM OLD.attachment_mime
  OR NEW.attachment_size      IS DISTINCT FROM OLD.attachment_size
  OR NEW.attachment_duration  IS DISTINCT FROM OLD.attachment_duration
  THEN
    RAISE EXCEPTION 'a message may only be edited by the person who sent it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_message_non_sender_read_only() FROM PUBLIC, anon, authenticated;
