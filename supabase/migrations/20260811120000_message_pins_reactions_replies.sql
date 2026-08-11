-- Messages: durable thread pins, tapback reactions, and reply-to threading.
--
-- Three related additions, one migration because they ship as one feature
-- pass on the Messages surface.
--
-- 1. thread_pins       — pins survive a relaunch and follow the account.
-- 2. message_reactions — iMessage-style tapbacks.
-- 3. messages.reply_to_id — inline replies.
--
-- Why pins move server-side: they lived in sessionStorage, so pinning a
-- thread and force-quitting lost it, and a pin never followed the user to
-- another device. A "thread" here is the (job_id, other_user_id) pair derived
-- from rows in public.messages — there is no conversation table — so this
-- mirrors public.thread_mutes exactly (20260609100000), including its
-- owner-only RLS shape.
--
-- Migration discipline:
--   • Replay-safe: every statement uses IF NOT EXISTS / OR REPLACE / IF
--     EXISTS, so a from-scratch rebuild in timestamp order succeeds.
--   • Forward-compatible: depends only on public.messages, public.jobs and
--     auth.users, all defined by earlier migrations.


-- ── 1. thread_pins ──────────────────────────────────────────────────
-- Row exists == pinned, for that user only. Deleting unpins. Mirrors
-- thread_mutes so the two behave identically under RLS and cascade.
CREATE TABLE IF NOT EXISTS public.thread_pins (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pinned_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id, other_user_id)
);

CREATE INDEX IF NOT EXISTS thread_pins_user_idx
  ON public.thread_pins (user_id);

ALTER TABLE public.thread_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thread_pins owner select" ON public.thread_pins;
CREATE POLICY "thread_pins owner select" ON public.thread_pins
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "thread_pins owner insert" ON public.thread_pins;
CREATE POLICY "thread_pins owner insert" ON public.thread_pins
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "thread_pins owner delete" ON public.thread_pins;
CREATE POLICY "thread_pins owner delete" ON public.thread_pins
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- ── 2. message_reactions ────────────────────────────────────────────
-- One tapback per user per message, matching iMessage: reacting again with
-- a different emoji REPLACES the previous one rather than stacking. That is
-- enforced by the primary key, so the client upserts on (message_id,user_id).
--
-- `emoji` is constrained to a fixed set rather than left free text. This is a
-- column two strangers can write to each other's screens, so an open text
-- field would be an abuse channel (and a rendering hazard). The six values
-- are iMessage's tapbacks.
--
-- `job_id` is denormalised from the parent message on purpose. Supabase
-- realtime filters are single-column, and the useful subscription here is
-- "reactions in the thread I currently have open" — which is a job, not a
-- user. Without this column the only options would be an UNFILTERED
-- subscription (every reaction platform-wide, which CLAUDE.md forbids) or
-- filtering by reactor, which would miss the other participant entirely.
-- A trigger keeps it honest so the client can never set it wrong.
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id     uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_reactions_emoji_allowed
    CHECK (emoji IN ('❤️', '👍', '👎', '😂', '‼️', '❓'))
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON public.message_reactions (message_id);
CREATE INDEX IF NOT EXISTS message_reactions_job_idx
  ON public.message_reactions (job_id);

-- Derive job_id from the parent message, ignoring whatever the client sent.
-- Also the integrity gate: reacting to a nonexistent message raises here
-- rather than inserting an orphan row with a caller-chosen job_id.
CREATE OR REPLACE FUNCTION public.message_reactions_set_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_job uuid;
BEGIN
  SELECT m.job_id INTO parent_job FROM public.messages m WHERE m.id = NEW.message_id;
  IF parent_job IS NULL THEN
    RAISE EXCEPTION 'message_reactions: no such message %', NEW.message_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.job_id := parent_job;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_reactions_set_job_trg ON public.message_reactions;
CREATE TRIGGER message_reactions_set_job_trg
  BEFORE INSERT OR UPDATE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.message_reactions_set_job();

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Visible to either participant of the parent message. Deliberately NOT
-- "owner only": the whole point is that the other person sees your tapback.
-- Mirrors the messages SELECT policy, including its flagged_hidden carve-out
-- so a reaction can't be used to surface a moderated message.
DROP POLICY IF EXISTS "message_reactions participant select" ON public.message_reactions;
CREATE POLICY "message_reactions participant select" ON public.message_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reactions.message_id
      AND (
        m.sender_id = (SELECT auth.uid())
        OR (m.receiver_id = (SELECT auth.uid()) AND COALESCE(m.flagged_hidden, false) = false)
      )
  ));

-- You may only write your OWN reaction, and only on a message you can see.
DROP POLICY IF EXISTS "message_reactions own insert" ON public.message_reactions;
CREATE POLICY "message_reactions own insert" ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND (
          m.sender_id = (SELECT auth.uid())
          OR (m.receiver_id = (SELECT auth.uid()) AND COALESCE(m.flagged_hidden, false) = false)
        )
    )
  );

DROP POLICY IF EXISTS "message_reactions own update" ON public.message_reactions;
CREATE POLICY "message_reactions own update" ON public.message_reactions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "message_reactions own delete" ON public.message_reactions;
CREATE POLICY "message_reactions own delete" ON public.message_reactions
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- ── 3. messages.reply_to_id ─────────────────────────────────────────
-- Inline replies. ON DELETE SET NULL rather than CASCADE: deleting a message
-- must not silently delete every reply to it — the reply becomes a normal
-- message and the client stops rendering the quoted stub.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON public.messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- A reply must point at a message in the SAME job. Without this, the
-- reply_to_id column would let a sender quote a message from a conversation
-- the recipient cannot see, and the client would render that stub verbatim —
-- an information leak dressed up as a quote. A CHECK constraint cannot run a
-- subquery, hence a trigger.
CREATE OR REPLACE FUNCTION public.messages_validate_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_job uuid;
BEGIN
  IF NEW.reply_to_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT m.job_id INTO parent_job FROM public.messages m WHERE m.id = NEW.reply_to_id;
  IF parent_job IS NULL OR parent_job <> NEW.job_id THEN
    RAISE EXCEPTION 'messages: reply_to_id % is not in job %', NEW.reply_to_id, NEW.job_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_validate_reply_trg ON public.messages;
CREATE TRIGGER messages_validate_reply_trg
  BEFORE INSERT OR UPDATE OF reply_to_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_validate_reply();


-- ── 4. Realtime ─────────────────────────────────────────────────────
-- public.messages is already published (20260311003245). Reactions need to
-- reach the other participant live, filtered by job_id — see the note above.
-- Guarded because ALTER PUBLICATION ... ADD TABLE errors if already present,
-- which would abort a replay.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END
$$;
