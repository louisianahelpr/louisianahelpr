-- Bans that actually ban (2026-08-24 warnings-system review).
--
-- FOUND: ban_status was enforced by ProtectedRoute alone — a client-side
-- redirect. None of apply_to_job / respond_to_direct_offer /
-- accept_application / messaging checked it, so a suspended or permanently
-- banned account holding a valid JWT could keep applying, accepting jobs,
-- posting, and messaging straight through PostgREST. The 7-day suspension
-- the ladder now hands out (20260824243000) would have suspended nothing.
--
-- FIX: one STABLE predicate + four BEFORE triggers at the DATA layer, so no
-- present or future RPC/client path can skip it:
--   applications INSERT  — a banned helper cannot apply
--   jobs INSERT          — a banned poster cannot post
--   jobs UPDATE          — a banned party cannot act on a job (accept,
--                          confirm, track, approve…)
--   messages INSERT      — a banned account cannot message
-- Service-role writers (crons, edge functions, admin tooling) have
-- auth.uid() NULL and pass through untouched; reads are deliberately left
-- open so a banned user can still SEE their account state and history.

CREATE OR REPLACE FUNCTION public.is_caller_banned()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid()
       AND ban_status IN ('banned', 'temp_banned', 'permanently_banned')
       -- A lapsed suspension the sweeper hasn't lifted yet does not block:
       -- the sweep runs on a timer, rights come back on the clock.
       AND (ban_status <> 'temp_banned'
            OR auto_suspended_until IS NULL
            OR auto_suspended_until > now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caller_banned() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_ban_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted'
      USING ERRCODE = '42501',
            HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ban_gate_applications ON public.applications;
CREATE TRIGGER trg_ban_gate_applications
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();

DROP TRIGGER IF EXISTS trg_ban_gate_jobs_insert ON public.jobs;
CREATE TRIGGER trg_ban_gate_jobs_insert
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();

DROP TRIGGER IF EXISTS trg_ban_gate_jobs_update ON public.jobs;
CREATE TRIGGER trg_ban_gate_jobs_update
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();

DROP TRIGGER IF EXISTS trg_ban_gate_messages ON public.messages;
CREATE TRIGGER trg_ban_gate_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
