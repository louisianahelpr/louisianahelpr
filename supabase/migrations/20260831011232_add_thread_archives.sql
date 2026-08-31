-- Messages: durable thread archives (the "Hide conversation" / swipe-to-
-- archive action, and its "Recently Deleted" un-hide view).
--
-- Why archives move server-side: they lived in safeStorage only, so hiding
-- a thread on one device never followed the account to another — "Recently
-- Deleted" on a different device (or after a reinstall) simply couldn't see
-- what was archived elsewhere. A "thread" here is the (job_id, other_user_id)
-- pair derived from rows in public.messages — there is no conversation
-- table — so this mirrors public.thread_pins (20260811120000) exactly,
-- including its owner-only RLS shape and the client's local-mirror pattern.
--
-- Row exists == archived (hidden from the inbox), for that user only.
-- Deleting the row restores it. The client still applies its own
-- "auto-resurface if a newer message than archived_at arrives" rule on top
-- of this — that logic doesn't need to move server-side, it just needs
-- archived_at to compare against, same as the local-only version had.
--
-- Migration discipline:
--   • Replay-safe: every statement uses IF NOT EXISTS / IF EXISTS, so a
--     from-scratch rebuild in timestamp order succeeds.
--   • Forward-compatible: depends only on public.jobs and auth.users, both
--     defined by earlier migrations.

CREATE TABLE IF NOT EXISTS public.thread_archives (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  archived_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id, other_user_id)
);

CREATE INDEX IF NOT EXISTS thread_archives_user_idx
  ON public.thread_archives (user_id);

ALTER TABLE public.thread_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thread_archives owner select" ON public.thread_archives;
CREATE POLICY "thread_archives owner select" ON public.thread_archives
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "thread_archives owner insert" ON public.thread_archives;
CREATE POLICY "thread_archives owner insert" ON public.thread_archives
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "thread_archives owner update" ON public.thread_archives;
CREATE POLICY "thread_archives owner update" ON public.thread_archives
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "thread_archives owner delete" ON public.thread_archives;
CREATE POLICY "thread_archives owner delete" ON public.thread_archives
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
