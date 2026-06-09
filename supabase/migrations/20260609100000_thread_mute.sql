-- Per-user mute toggle for message threads (handoff item #17).
--
-- A "thread" on Helpr is the (job_id, otherUserId) pair derived from rows
-- in public.messages — there is no per-user conversation table to flag
-- mute against. This migration introduces a dedicated join-style table,
-- `public.thread_mutes`, which records (user_id, job_id, other_user_id)
-- and the muted_at timestamp. A row's existence == the thread is muted
-- for that user. Deleting the row un-mutes.
--
-- Notifications: a muted thread suppresses push for the muted user only;
-- the conversation row still shows new messages (just without sound /
-- alert). The fan-out path checks `is_thread_muted` to decide whether to
-- skip the recipient. The unread badge still increments — mute is "no
-- notification", not "ignore". This matches iMessage's "Hide Alerts".
--
-- Migration discipline:
--   • Replay-safe: every DDL uses IF NOT EXISTS / OR REPLACE / IF EXISTS.
--   • Forward-compatible: no dependency on objects defined in later
--     migrations.
--   • Both RPCs ship with explicit GRANT EXECUTE TO authenticated so the
--     CI grant-guard (PR #413) stays green.

-- ── 1. The mute table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.thread_mutes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id, other_user_id)
);

CREATE INDEX IF NOT EXISTS thread_mutes_user_idx
  ON public.thread_mutes (user_id);

-- ── 2. RLS — owner-only ─────────────────────────────────────────────
ALTER TABLE public.thread_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thread_mutes owner select" ON public.thread_mutes;
CREATE POLICY "thread_mutes owner select" ON public.thread_mutes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "thread_mutes owner insert" ON public.thread_mutes;
CREATE POLICY "thread_mutes owner insert" ON public.thread_mutes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "thread_mutes owner delete" ON public.thread_mutes;
CREATE POLICY "thread_mutes owner delete" ON public.thread_mutes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. Helpers — used by RPCs and by future fan-out checks ──────────
-- Single-thread predicate. STABLE so PG can fold it into row scans.
CREATE OR REPLACE FUNCTION public.is_thread_muted(
  _user uuid,
  _job_id uuid,
  _other_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_mutes
    WHERE user_id = _user
      AND job_id = _job_id
      AND other_user_id = _other_user_id
  );
$$;

-- ── 4. Bulk mute lookup for the inbox ────────────────────────────────
-- The client passes a JSONB array of {job_id, other_user_id} pairs and
-- gets back the subset that are muted for the calling user. Single RPC,
-- single round-trip — no N+1 across the inbox. Returns rows the caller
-- can flat-merge into the conversation list.
CREATE OR REPLACE FUNCTION public.get_muted_threads(_pairs jsonb)
RETURNS TABLE(job_id uuid, other_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.job_id, tm.other_user_id
  FROM public.thread_mutes tm
  JOIN jsonb_to_recordset(_pairs)
    AS p(job_id uuid, other_user_id uuid)
    ON p.job_id = tm.job_id AND p.other_user_id = tm.other_user_id
  WHERE tm.user_id = auth.uid();
$$;

-- ── 5. Toggle RPC — atomic mute / unmute ────────────────────────────
-- Returns the new muted state (true = muted, false = unmuted) so the UI
-- can reconcile without a follow-up read.
CREATE OR REPLACE FUNCTION public.toggle_thread_mute(
  _job_id uuid,
  _other_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _deleted int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.thread_mutes
  WHERE user_id = _uid
    AND job_id = _job_id
    AND other_user_id = _other_user_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  IF _deleted > 0 THEN
    RETURN false;  -- was muted, now unmuted
  END IF;

  INSERT INTO public.thread_mutes (user_id, job_id, other_user_id)
  VALUES (_uid, _job_id, _other_user_id)
  ON CONFLICT (user_id, job_id, other_user_id) DO NOTHING;

  RETURN true;  -- now muted
END;
$$;

-- ── 6. Explicit grants — required by CI grant-guard (PR #413) ───────
REVOKE ALL ON FUNCTION public.is_thread_muted(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_thread_muted(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_muted_threads(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_muted_threads(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_thread_mute(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_thread_mute(uuid, uuid) TO authenticated;
