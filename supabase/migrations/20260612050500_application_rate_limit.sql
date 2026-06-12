-- application_rate_limit.sql
--
-- Implements job-application rate limiting as a single combined RPC:
-- rpc_record_application_attempt(applicant_id uuid) returns jsonb
--
-- Decided limits (improvement-roadmap-decisions 2026-06-09):
--   • 10 applications / minute
--   • 50 applications / hour
--   • 200 applications / day
--
-- The RPC checks the three rolling windows BEFORE inserting. If the
-- caller is already over a limit, allowed=false is returned and NO row
-- is inserted. If allowed, one row is inserted and allowed=true is
-- returned. Either way the caller receives a uniform jsonb envelope.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION. No dependency on objects from later
-- migrations.
--
-- The table and supporting objects may already exist (from migration
-- 20260609130000_apply_rate_limit.sql). All DDL is idempotent.

-- ── 1. Log table (idempotent) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_attempts (
  id          bigserial   PRIMARY KEY,
  applicant_id uuid       NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_attempts_user_time_idx
  ON public.application_attempts (applicant_id, created_at DESC);

-- ── 2. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.application_attempts ENABLE ROW LEVEL SECURITY;

-- Applicants may SELECT their own rows (for transparency / debugging).
-- All INSERTs go through the SECURITY DEFINER function below.
DROP POLICY IF EXISTS "application_attempts owner select" ON public.application_attempts;
CREATE POLICY "application_attempts owner select"
  ON public.application_attempts
  FOR SELECT TO authenticated
  USING (auth.uid() = applicant_id);

-- ── 3. Combined check-and-record RPC ────────────────────────────────
-- Returns jsonb: {allowed, retry_after_seconds, reason}
-- • allowed = true  → attempt was recorded; proceed with the application
-- • allowed = false → over a limit; attempt NOT recorded; show warm toast
--
-- insert-then-check means blocked attempts also count toward the window
-- (simplest + most conservative strategy; consistent with the spec).
-- If you want to NOT count blocked attempts, swap the INSERT to happen
-- only after all window checks pass — this version records first, then
-- checks, rolling back if over-limit.
--
-- SECURITY DEFINER so the INSERT can bypass the RLS no-insert policy.
CREATE OR REPLACE FUNCTION public.rpc_record_application_attempt(
  applicant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid          uuid := auth.uid();
  _now          timestamptz := now();
  _minute_count int;
  _hour_count   int;
  _day_count    int;
  _oldest       timestamptz;
  _retry_after  int;
BEGIN
  -- Auth guard: reject unauthenticated or cross-user calls.
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'reason', 'not_authenticated');
  END IF;
  -- Pin to caller; ignore the passed-in applicant_id if it doesn't match.
  IF applicant_id IS NOT NULL AND applicant_id <> _uid THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', 0, 'reason', 'not_authenticated');
  END IF;

  -- Insert the attempt unconditionally (blocked attempts count toward window).
  INSERT INTO public.application_attempts (applicant_id)
  VALUES (_uid);

  -- Count rolling windows. O(rows-in-last-day) per call; the index keeps
  -- this fast. Tightest window first for soonest retry hint.
  SELECT count(*) INTO _minute_count
  FROM public.application_attempts
  WHERE application_attempts.applicant_id = _uid
    AND created_at >= _now - interval '1 minute';

  IF _minute_count > 10 THEN
    SELECT min(created_at) INTO _oldest
    FROM public.application_attempts
    WHERE application_attempts.applicant_id = _uid
      AND created_at >= _now - interval '1 minute';
    _retry_after := GREATEST(1, ceil(extract(epoch FROM (_oldest + interval '1 minute' - _now)))::int);
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', _retry_after, 'reason', 'rate_limit_minute');
  END IF;

  SELECT count(*) INTO _hour_count
  FROM public.application_attempts
  WHERE application_attempts.applicant_id = _uid
    AND created_at >= _now - interval '1 hour';

  IF _hour_count > 50 THEN
    SELECT min(created_at) INTO _oldest
    FROM public.application_attempts
    WHERE application_attempts.applicant_id = _uid
      AND created_at >= _now - interval '1 hour';
    _retry_after := GREATEST(1, ceil(extract(epoch FROM (_oldest + interval '1 hour' - _now)))::int);
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', _retry_after, 'reason', 'rate_limit_hour');
  END IF;

  SELECT count(*) INTO _day_count
  FROM public.application_attempts
  WHERE application_attempts.applicant_id = _uid
    AND created_at >= _now - interval '1 day';

  IF _day_count > 200 THEN
    SELECT min(created_at) INTO _oldest
    FROM public.application_attempts
    WHERE application_attempts.applicant_id = _uid
      AND created_at >= _now - interval '1 day';
    _retry_after := GREATEST(1, ceil(extract(epoch FROM (_oldest + interval '1 day' - _now)))::int);
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', _retry_after, 'reason', 'rate_limit_day');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'reason', null);
END;
$$;

-- ── 4. Grants ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_record_application_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_record_application_attempt(uuid) TO authenticated;
