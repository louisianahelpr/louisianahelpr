-- Server-side rate limit for job applications (handoff item #44).
--
-- Decided limits (improvement-roadmap-decisions 2026-06-09):
--   • 10 applications / minute
--   • 50 applications / hour
--   • 200 applications / day
--
-- Why server-side: the client can be tampered with. We need a token-bucket
-- style hard cap to stop bots and spammers without crippling power users
-- (e.g. a helper who's deliberately spraying a category at busy hours).
--
-- Mechanism: a rolling-window log table `public.application_rate_log`
-- with one row per attempt. The check RPC counts rows in the last 60s,
-- 3600s, and 86400s and returns the first window the user has exceeded
-- (plus an approximate retry_after_seconds). The record RPC inserts one
-- row. The client calls check BEFORE inserting the application and
-- record AFTER the insert succeeds.
--
-- We chose a separate log + RPC pair (not a trigger on `applications`)
-- so failed inserts (RLS denials, validation failures) don't get
-- counted, and so the rate limiter can be queried without writing.
--
-- Migration discipline:
--   • Replay-safe: every DDL uses IF NOT EXISTS / OR REPLACE / IF EXISTS.
--   • Forward-compatible: no dependency on objects defined in later
--     migrations.
--   • Both RPCs ship with explicit GRANT EXECUTE TO authenticated so the
--     CI grant-guard (PR #413) stays green.

-- ── 1. The log table ────────────────────────────────────────────────
-- One row per apply attempt. We don't link to `applications.id` because
-- we want to count attempts that may fail downstream (RLS, dup-key, etc).
-- The composite index covers the three time-window scans below.
CREATE TABLE IF NOT EXISTS public.application_rate_log (
  id bigserial PRIMARY KEY,
  applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_rate_log_applicant_recent_idx
  ON public.application_rate_log (applicant_id, created_at DESC);

-- ── 2. RLS — applicants see their own log, INSERT only via SECURITY DEFINER ──
ALTER TABLE public.application_rate_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_log owner select" ON public.application_rate_log;
CREATE POLICY "rate_log owner select" ON public.application_rate_log
  FOR SELECT TO authenticated
  USING (auth.uid() = applicant_id);

-- No INSERT policy on purpose — direct INSERTs are blocked. The
-- SECURITY DEFINER RPC `rpc_record_application_attempt` is the only path.

-- ── 3. Check RPC — returns first exceeded window (or allowed = true) ─
-- We intentionally return only minimal counts (the first failing window
-- + retry_after_seconds) so callers can render a friendly message
-- without re-running the windowed counts on the client. retry_after_seconds
-- is approximate: it's the seconds until the oldest counted attempt in
-- the offending window falls out of the rolling window.
CREATE OR REPLACE FUNCTION public.rpc_check_application_rate(
  _applicant_id uuid
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  retry_after_seconds int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _minute_count int;
  _hour_count int;
  _day_count int;
  _oldest_in_window timestamptz;
BEGIN
  -- A NULL applicant means "not authenticated" — fail closed.
  IF _applicant_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  -- A user can only check their own rate. Block cross-user probing.
  IF auth.uid() IS NULL OR auth.uid() <> _applicant_id THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  -- Counts per window. The index covers all three via the descending
  -- created_at scan. We stop at the day boundary so the worst case is
  -- O(rows-in-last-day) per call.
  SELECT count(*) INTO _day_count
  FROM public.application_rate_log
  WHERE applicant_id = _applicant_id
    AND created_at >= _now - interval '1 day';

  -- Short-circuit if the user has no recent attempts at all.
  IF _day_count = 0 THEN
    RETURN QUERY SELECT true, NULL::text, 0;
    RETURN;
  END IF;

  SELECT count(*) INTO _hour_count
  FROM public.application_rate_log
  WHERE applicant_id = _applicant_id
    AND created_at >= _now - interval '1 hour';

  SELECT count(*) INTO _minute_count
  FROM public.application_rate_log
  WHERE applicant_id = _applicant_id
    AND created_at >= _now - interval '1 minute';

  -- Check tightest window first so the caller gets the soonest retry.
  IF _minute_count >= 10 THEN
    SELECT min(created_at) INTO _oldest_in_window
    FROM public.application_rate_log
    WHERE applicant_id = _applicant_id
      AND created_at >= _now - interval '1 minute';
    RETURN QUERY SELECT
      false,
      'rate_limit_minute'::text,
      GREATEST(1, ceil(extract(epoch FROM (_oldest_in_window + interval '1 minute' - _now)))::int);
    RETURN;
  END IF;

  IF _hour_count >= 50 THEN
    SELECT min(created_at) INTO _oldest_in_window
    FROM public.application_rate_log
    WHERE applicant_id = _applicant_id
      AND created_at >= _now - interval '1 hour';
    RETURN QUERY SELECT
      false,
      'rate_limit_hour'::text,
      GREATEST(1, ceil(extract(epoch FROM (_oldest_in_window + interval '1 hour' - _now)))::int);
    RETURN;
  END IF;

  IF _day_count >= 200 THEN
    SELECT min(created_at) INTO _oldest_in_window
    FROM public.application_rate_log
    WHERE applicant_id = _applicant_id
      AND created_at >= _now - interval '1 day';
    RETURN QUERY SELECT
      false,
      'rate_limit_day'::text,
      GREATEST(1, ceil(extract(epoch FROM (_oldest_in_window + interval '1 day' - _now)))::int);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, 0;
END;
$$;

-- ── 4. Record RPC — insert one attempt row for the calling user ─────
-- SECURITY DEFINER so we can bypass the RLS INSERT denial. We still
-- pin the row to auth.uid() so a malicious caller can't impersonate
-- another user's bucket.
CREATE OR REPLACE FUNCTION public.rpc_record_application_attempt(
  _applicant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Pin the inserted row to the caller, regardless of what was passed
  -- in. The _applicant_id arg exists for clarity / future audit logs;
  -- the actual write uses auth.uid() as the source of truth.
  IF _applicant_id IS NOT NULL AND _applicant_id <> _uid THEN
    RAISE EXCEPTION 'applicant mismatch';
  END IF;

  INSERT INTO public.application_rate_log (applicant_id)
  VALUES (_uid);
END;
$$;

-- ── 5. Explicit grants — required by CI grant-guard (PR #413) ───────
REVOKE ALL ON FUNCTION public.rpc_check_application_rate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_application_rate(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_record_application_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_record_application_attempt(uuid) TO authenticated;
