-- Add message editing (sender-only, 15-minute window).
--
-- WHAT WAS MISSING: senders had no way to fix a typo in a sent message —
-- only a hard DELETE existed (which already removes the message for both
-- parties, i.e. "delete for everyone" already worked; this migration is
-- purely additive for editing). UPDATE on public.messages was locked down to
-- the `read` column only (see 20260824180000's R11 fix — a recipient could
-- otherwise rewrite the sender's content, which is a real dispute-evidence
-- risk), and there was no sender-facing UPDATE policy at all, so simply
-- widening the grant would not have been enough on its own.
--
-- DECISIONS:
--   * `edited_at` is a new nullable column, set automatically by a
--     BEFORE UPDATE trigger whenever `content` actually changes (never
--     client-settable — it isn't in the client GRANT below).
--   * A 15-minute edit window (`created_at > now() - interval '15 minutes'`)
--     mirrors common chat-app UX and limits how long a message already read
--     or already relied on as dispute evidence can be altered.
--   * System messages (`is_system`) are excluded — they are not sender-
--     authored content in the same sense.
--   * The existing INSERT-time content scan (`scan_message_content` —
--     phone-number/off-platform-contact/crypto detection, violation ladder,
--     account-suspension escalation) is re-run on edits too via a second
--     trigger. Without this, editing a clean message into a violation would
--     bypass moderation entirely — the exact "edited content is never
--     re-scanned" gap 20260824180000's R11 comment already flagged for the
--     old (now-removed) unrestricted UPDATE grant.
--   * Column-level GRANTs are additive in Postgres, so this does not touch
--     the existing `GRANT UPDATE (read) ...` from 20260824180000.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'edited_at'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN edited_at timestamptz;
  END IF;
END $$;

-- Sender-only UPDATE policy, time-boxed, additive to the existing
-- receiver-only "mark as read" policy (RLS policies OR together).
DROP POLICY IF EXISTS "Users can edit their own sent messages" ON public.messages;
CREATE POLICY "Users can edit their own sent messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = sender_id
    AND is_system = false
    AND created_at > now() - interval '15 minutes'
  )
  WITH CHECK (
    auth.uid() = sender_id
    AND is_system = false
  );

-- Additive: the existing `GRANT UPDATE (read) ...` for the read-receipt
-- policy is untouched. This just widens which columns an authenticated
-- user may write at all — the two UPDATE policies above still gate WHICH
-- rows and, together with is_system/window checks, when.
GRANT UPDATE (content, edited_at) ON public.messages TO authenticated;

-- Auto-stamp edited_at server-side whenever content actually changes.
-- Never client-settable directly (edited_at is grantable, but this trigger
-- overwrites whatever the client sent so a client can't backdate/omit it).
CREATE OR REPLACE FUNCTION public.stamp_message_edited_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.edited_at := now();
  ELSE
    NEW.edited_at := OLD.edited_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_message_edited_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_message_edited_at ON public.messages;
CREATE TRIGGER trg_stamp_message_edited_at
  BEFORE UPDATE OF content ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.stamp_message_edited_at();

-- Re-run the same moderation scan an edited message would have gotten on
-- INSERT. scan_message_content() operates purely on NEW.* (no TG_OP checks),
-- so it is safe to reuse verbatim for UPDATE.
DROP TRIGGER IF EXISTS scan_message_on_edit ON public.messages;
CREATE TRIGGER scan_message_on_edit
  AFTER UPDATE OF content ON public.messages
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content)
  EXECUTE FUNCTION public.scan_message_content();
