-- Poster-first messaging rule.
--
-- Product rule: only the job poster may open a job conversation. An
-- applicant cannot send the first message and cannot send anything until
-- the poster has messaged them. This stops posters from being flooded by
-- applicants begging to be chosen. The frontend already locks the
-- applicant's composer (src/components/messages/ChatView.tsx); this
-- migration enforces the same rule server-side so a disabled control
-- can't be bypassed.
--
-- No client RPC is added — the helper below is referenced only inside the
-- INSERT policy, never called from the app — so there is no PGRST202
-- ("function not found") surface to fall back on. Between merge and the
-- manual `supabase db push`, the frontend lock is the only enforcement;
-- that degrades safely (the rule simply isn't enforced server-side yet,
-- no feature breaks).
--
-- Recursion-safety: the policy reads `jobs` and `messages` from inside a
-- `messages` policy. Evaluating those reads under RLS would risk the same
-- jobs<->applications recursion fixed in 20260529111503. So the cross-
-- table lookup is wrapped in a SECURITY DEFINER helper that bypasses RLS
-- during evaluation — the same pattern used by has_role(),
-- user_has_pending_application(), etc.
--
-- Replay-safety: CREATE OR REPLACE FUNCTION is always safe; DROP POLICY
-- IF EXISTS + CREATE is idempotent on rebuild; the GRANT is guarded with
-- to_regprocedure. `public.jobs` and `public.messages` both exist by this
-- timestamp (created 2026-03-11).

-- ── 1. SECURITY DEFINER helper ─────────────────────────────────────
-- Returns true when `_sender` is allowed to insert a message on `_job_id`:
--   • the sender is the job's poster (may always message), OR
--   • the poster has already sent at least one message in this thread
--     (the applicant may now reply).
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id AND j.customer_id = _sender
    )
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.jobs j ON j.id = m.job_id
      WHERE m.job_id = _job_id
        AND m.sender_id = j.customer_id
    );
$$;

-- ── 2. Replace the INSERT policy with the poster-first CHECK ────────
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;

CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.can_message_in_job(job_id, auth.uid())
  );

-- ── 3. Idempotent grant ────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.can_message_in_job(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO authenticated;
  END IF;
END $$;
