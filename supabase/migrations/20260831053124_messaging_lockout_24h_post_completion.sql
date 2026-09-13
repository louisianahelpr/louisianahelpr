-- 24-hour post-completion messaging lockout.
--
-- Trust/safety rule (backlog #95): once a job is marked completed, the
-- two participants get a 24-hour window to keep chatting — wrap-up
-- questions, tip-related chat, "thanks!" — and after that the thread
-- closes to new human messages. Left open indefinitely, a completed
-- job's chat becomes a free off-platform coordination channel for a
-- transactional relationship that's already over, which is exactly the
-- kind of persistent-contact surface this class of app should not leave
-- unbounded.
--
-- Completion timestamp: `jobs` has no single `completed_at` — completion
-- is recorded per-party as `poster_completed_at` / `helper_completed_at`
-- (20260311010422). The rest of the codebase already treats
-- `COALESCE(poster_completed_at, helper_completed_at, updated_at)` as
-- "when this job finished" (see e.g. the payout-aging view in
-- 20260418082439) — reused verbatim here so the lockout clock agrees
-- with every other place completion time is read.
--
-- Scope: this only gates human INSERTs through the `can_message_in_job`
-- RLS check. `insert_job_status_system_message()` (20260720130000) is
-- SECURITY DEFINER and never goes through RLS, so the "✓ Job completed"
-- system pill and any later system rows still post after the lockout —
-- only two-way human chat closes. Reads, edits, and reactions on
-- messages sent before the lockout are untouched; only NEW inserts are
-- blocked.
--
-- Replay-safety: CREATE OR REPLACE FUNCTION is always safe; DROP POLICY
-- IF EXISTS + CREATE is idempotent on rebuild. `public.jobs` and
-- `public.messages` both exist by this timestamp (created 2026-03-11),
-- and `poster_completed_at`/`helper_completed_at` exist since 20260311010422.

CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- 0. Lockout gate: once a job has been completed for more than 24h,
    --    no human insert is allowed regardless of who the sender is.
    --    Evaluated first so it short-circuits (via the outer AND) the
    --    membership checks below rather than duplicating the NOT
    --    condition into each branch.
    NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND j.status = 'completed'
        AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)
              < now() - interval '24 hours'
    )
    AND (
      -- 1. The poster of the job.
      EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id AND j.customer_id = _sender
      )
      -- 2. The helper this job is offered to, or already assigned to.
      --    NULL-safe: `= _sender` is never true when the column is NULL, so an
      --    un-offered, un-assigned job matches nobody here.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id
          AND (j.offered_to_helper_id = _sender OR j.helper_id = _sender)
      )
      -- 3. The poster messaged THIS sender first.
      OR EXISTS (
        SELECT 1
        FROM public.messages m
        JOIN public.jobs j ON j.id = m.job_id
        WHERE m.job_id = _job_id
          AND m.sender_id = j.customer_id
          AND m.receiver_id = _sender
      )
    );
$function$;

-- The INSERT policy already calls this function ("Users can send
-- messages" WITH CHECK, 20260608000000 / 20260820063000) — replacing the
-- function body is sufficient, no policy change needed. Restated here
-- only so a from-scratch replay is self-evident without cross-referencing
-- an earlier migration.
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;

CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.can_message_in_job(job_id, auth.uid())
  );

-- Keep the hardening from 20260819060000: anon must never hold EXECUTE.
DO $$
BEGIN
  IF to_regprocedure('public.can_message_in_job(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) FROM anon';
  END IF;
END $$;
