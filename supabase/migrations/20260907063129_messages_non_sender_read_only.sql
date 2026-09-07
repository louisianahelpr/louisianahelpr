-- AR-011 — a message receiver could rewrite what the sender said.
--
-- `messages` carries two permissive UPDATE policies. One is the intended
-- 15-minute, sender-only edit window:
--
--   "Users can edit their own sent messages"
--     USING (auth.uid() = sender_id AND is_system = false
--            AND created_at > now() - interval '15 minutes')
--
-- The other exists so a recipient can mark a thread read:
--
--   "Users can mark messages as read"
--     USING (auth.uid() = receiver_id) WITH CHECK (auth.uid() = receiver_id)
--
-- That second policy is column-blind, `content` is UPDATE-granted to
-- `authenticated`, and permissive policies OR — so the read-marking policy
-- grants a full-row write to the receiver and completely defeats the edit
-- window sitting next to it. Postgres has no way to scope a policy to a
-- column, so the fix has to be a trigger.
--
-- Proved against prod 2026-09-06 inside a rolled-back transaction: a message
-- from A to B, updated while impersonating B —
--
--   PROBE RESULT >> receiver-content-update: rows=1;
--                   final_content=[TAMPERED BY RECEIVER]
--
-- One row, rewritten by the person who did not write it. Chat is the evidence
-- record behind every dispute on this platform, and DisputeTimelineDialog and
-- the admin queue both read these rows back as what was said.
--
-- The rule: if you are not the sender, the only thing you may change about a
-- message is whether you have read it.
--
-- `edited_at` IS pinned, and the reason is worth writing down because the
-- first draft of this file left it out on reasoning that turned out to be
-- false. All three pre-existing BEFORE UPDATE triggers on this table are
-- column-qualified — `BEFORE UPDATE OF content` / `OF reply_to_id` — so an
-- update that names neither fires none of them:
--
--   UPDATE messages SET read = true, edited_at = '2020-01-01' WHERE id = <theirs>;
--
-- `edited_at` is UPDATE-granted to `authenticated`, and the read-marking
-- policy passes that statement, so without the pin a receiver could stamp the
-- sender's message as "(edited)" at an arbitrary time — a smaller version of
-- the same tamper, on the same record the dispute timeline reads back. The pin
-- cannot reject a legitimate write: stamp_message_edited_at() only writes
-- edited_at on an update naming `content`, and a non-sender changing content
-- is already rejected on the line above.
--
-- Columns deliberately NOT pinned, and the honest reason is the GRANT, not the
-- trigger chain: `flagged_hidden`, `flag_reason` and `read_at` are not
-- UPDATE-granted to anon or authenticated at all, so no client can reach them.
-- If that ever changes, this list must be revisited — it is not "considered
-- and safe", it is "currently unreachable".
--   read / read_at                — the point of the policy

CREATE OR REPLACE FUNCTION public.enforce_message_non_sender_read_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / cron / edge functions run with no JWT: not a user write.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The sender's own edit is governed by the 15-minute window in the edit
  -- policy, which is where that rule belongs. This trigger has no opinion
  -- about it.
  IF auth.uid() = OLD.sender_id THEN
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

-- Replay-safety, and idempotent across repeated applies of this file.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_messages_non_sender_read_only ON public.messages;
    -- Name matters: BEFORE row triggers fire in name order, and this must sort
    -- AFTER scan_message_on_edit (which may flip flagged_hidden on any update)
    -- so that trigger's own writes are never what this one rejects.
    CREATE TRIGGER trg_messages_non_sender_read_only
      BEFORE UPDATE ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.enforce_message_non_sender_read_only();
  END IF;
END $$;

-- Name the roles: REVOKE ... FROM PUBLIC leaves anon's grant intact.
REVOKE ALL ON FUNCTION public.enforce_message_non_sender_read_only() FROM PUBLIC, anon, authenticated;
