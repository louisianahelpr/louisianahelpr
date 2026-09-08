-- Application caps and the signup throttle become ADMIN-ADJUSTABLE, DEFAULT OFF.
--
-- Owner decision, 2026-09-07: "there should not be an application cap, nor a
-- sign-up cap." The mechanisms are NOT deleted — a marketplace that discovers
-- an application-spam wave at 2am needs the lever to still exist — they are
-- moved behind `platform_settings` and default to NULL, which means unlimited.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THERE WERE THREE APPLICATION CAPS, NOT ONE
-- ═══════════════════════════════════════════════════════════════════════════
-- The cap users actually hit is only one of three independent engines, and
-- turning off any two of them leaves "no application cap" false:
--
--   1. `enforce_application_limit` — BEFORE INSERT trigger on `applications`.
--      15 per rolling 24h, hard-coded. This is the one that raises
--      "You have reached the daily application limit (15)." and also writes a
--      `fraud_flags` row. It is the FIRST to bite, so it masked the others.
--   2. `apply_to_job` — the RPC every apply goes through. 10/min, 50/hr,
--      200/day, hard-coded, counted straight off `applications`.
--   3. `rpc_check_application_rate` — the client-side pre-check the apply flow
--      calls before inserting, over `application_rate_log`. Same 10/50/200
--      ladder, hard-coded, so it produced the warm "you're applying really
--      fast" copy for a limit the RPC would have enforced anyway.
--
-- All three now read the same settings. A cap that is NULL, absent, zero or
-- negative is UNLIMITED, and that is the shipped default for every one of
-- them. `platform_settings` has exactly one row in prod; if it ever has none,
-- `application_cap()` returns NULL and every cap is off — the correct
-- direction to fail for a limit the owner has asked not to exist.
--
-- WHY THE DAY RUNGS MERGED. (1) capped 15/24h and (2)/(3) capped 200/day.
-- Two settings for "how many applications may one helper send in a day" is a
-- way to have them disagree; `daily_application_cap` is the single answer and
-- all three engines read it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNUP
-- ═══════════════════════════════════════════════════════════════════════════
-- Enumerated, because "some signup rate limit" was three candidates:
--
--   · `complete-signup` edge function — `checkRateLimit` at 5 per 5 minutes
--     per subject/address (plus the shared module's wide address window at
--     10x). THIS IS THE ONE THAT FIRES for a real signup. It now reads
--     `signup_rate_limit_per_hour` and is skipped entirely when that is
--     NULL/0. Handled in the function, not here.
--   · GoTrue's own auth rate limits (sign-up, email send, token). Supabase
--     platform config, not database state — NOT adjustable from a migration,
--     and left as-is.
--   · `edge_rate_limit_log` / `rate_limit_hit` — the durable store the module
--     above uses. It is the mechanism, not a signup-specific policy; the
--     seventeen other importers keep their own budgets untouched.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The settings. Nullable on purpose: NULL is the off state and the default.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS application_cap_per_minute integer,
  ADD COLUMN IF NOT EXISTS application_cap_per_hour   integer,
  ADD COLUMN IF NOT EXISTS daily_application_cap      integer,
  ADD COLUMN IF NOT EXISTS signup_rate_limit_per_hour integer;

COMMENT ON COLUMN public.platform_settings.application_cap_per_minute IS
  'Max applications one helper may send per rolling minute. NULL/0/negative = unlimited (default). Read by apply_to_job and rpc_check_application_rate via application_cap(''minute'').';
COMMENT ON COLUMN public.platform_settings.application_cap_per_hour IS
  'Max applications one helper may send per rolling hour. NULL/0/negative = unlimited (default).';
COMMENT ON COLUMN public.platform_settings.daily_application_cap IS
  'Max applications one helper may send per rolling 24h. NULL/0/negative = unlimited (default). Read by all three engines: the enforce_application_limit trigger, apply_to_job, and rpc_check_application_rate.';
COMMENT ON COLUMN public.platform_settings.signup_rate_limit_per_hour IS
  'Max complete-signup calls per hour per subject/address. NULL/0/negative = unlimited (default). Read by the complete-signup edge function, which skips checkRateLimit entirely when it is off.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. One reader, so the three engines cannot drift apart.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.application_cap(p_kind text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- greatest(...,0) folds a negative into zero; nullif(...,0) folds zero into
  -- NULL. So NULL, 0 and -1 all mean the same thing — unlimited — and no
  -- caller has to spell that out three ways.
  SELECT nullif(greatest(coalesce(
           CASE p_kind
             WHEN 'minute' THEN s.application_cap_per_minute
             WHEN 'hour'   THEN s.application_cap_per_hour
             WHEN 'day'    THEN s.daily_application_cap
           END, 0), 0), 0)
    FROM public.platform_settings s
   ORDER BY s.updated_at DESC NULLS LAST
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.application_cap(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.application_cap(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.application_cap(text) IS
  'The configured application cap for one window (''minute''|''hour''|''day''), or NULL when uncapped. NULL is the default and the answer when platform_settings has no row.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Engine 1 — the trigger. Same fraud_flags behaviour, same message shape,
--    but only when a cap is actually configured.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_application_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  daily_count integer;
  v_cap       integer := public.application_cap('day');
BEGIN
  -- Uncapped is the default. Return before counting: the count was a
  -- sequential scan of this helper's last 24h on every single insert, and
  -- there is no reason to pay for it when nothing can act on the answer.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO daily_count
  FROM public.applications
  WHERE helper_id = NEW.helper_id
    AND created_at > now() - interval '24 hours';

  IF daily_count >= v_cap THEN
    -- NOTE, carried forward unchanged and deliberately NOT fixed here: this
    -- INSERT never persists. It runs in the same statement as the RAISE two
    -- lines below, so it is rolled back with it — `fraud_flags` is empty in
    -- prod, zero rows of any flag_type, which is what a write that has never
    -- landed looks like. Reproduced in PGlite against the PRE-migration
    -- definition, so it is pre-existing and not introduced by this change.
    -- Fixing it means an out-of-transaction write and belongs with whoever
    -- owns fraud flagging, not with a change to where the cap is configured.
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (NEW.helper_id, 'application_spam',
            format('Helper exceeded %s applications in 24h.', v_cap));
    -- The client maps this message to warm copy by EXACT STRING (see the
    -- comment in src/pages/dashboard/useApplyFlow.ts). The cap is interpolated
    -- now, so that lookup can no longer match — the client side of this change
    -- switches to matching the stable prefix instead.
    RAISE EXCEPTION 'You have reached the daily application limit (%). Please try again tomorrow.', v_cap;
  END IF;
  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Engine 2 — apply_to_job. Everything below the rate ladder is unchanged
--    (advisory lock, FOR SHARE, the 2026-09-06 funding gate, dedupe).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_payment_status text;
  v_count int;
  v_cap_minute int := public.application_cap('minute');
  v_cap_hour   int := public.application_cap('hour');
  v_cap_day    int := public.application_cap('day');
BEGIN
  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  --
  -- Taken unconditionally, INCLUDING when every cap is off. It is not only the
  -- rate ladder's lock: it is also what stops two simultaneous applies from
  -- both passing the "already applied" check below and inserting a duplicate.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  IF v_cap_minute IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
    IF v_count >= v_cap_minute THEN
      RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
    END IF;
  END IF;

  IF v_cap_hour IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
    IF v_count >= v_cap_hour THEN
      RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
    END IF;
  END IF;

  IF v_cap_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
    IF v_count >= v_cap_day THEN
      RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
    END IF;
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT status, payment_status INTO v_status, v_payment_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;

  -- ADDED 2026-09-06 -- the funding gate. Read under the same FOR SHARE lock
  -- as the status, so it cannot be raced by a refund landing mid-apply.
  -- Deliberately worded for the helper, not the poster: the job's funding
  -- state is not the helper's business beyond "you cannot take this yet".
  IF NOT public.job_payment_is_funded(v_payment_status) THEN
    RAISE EXCEPTION 'This job is not accepting applications yet'
      USING HINT = 'The poster has not completed checkout, so there is no payment held for this job.';
  END IF;

  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Engine 3 — the client pre-check.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_check_application_rate(_applicant_id uuid)
RETURNS TABLE(allowed boolean, reason text, retry_after_seconds integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _minute_count int;
  _hour_count int;
  _day_count int;
  _oldest_in_window timestamptz;
  _cap_minute int := public.application_cap('minute');
  _cap_hour   int := public.application_cap('hour');
  _cap_day    int := public.application_cap('day');
BEGIN
  IF _applicant_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> _applicant_id THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  -- Every cap off is the default, and it is worth short-circuiting rather than
  -- falling through three counts that cannot refuse anything: this runs on the
  -- apply button's hot path, before the insert.
  IF _cap_minute IS NULL AND _cap_hour IS NULL AND _cap_day IS NULL THEN
    RETURN QUERY SELECT true, NULL::text, 0;
    RETURN;
  END IF;

  SELECT count(*) INTO _day_count
  FROM public.application_rate_log
  WHERE applicant_id = _applicant_id
    AND created_at >= _now - interval '1 day';

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

  IF _cap_minute IS NOT NULL AND _minute_count >= _cap_minute THEN
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

  IF _cap_hour IS NOT NULL AND _hour_count >= _cap_hour THEN
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

  IF _cap_day IS NOT NULL AND _day_count >= _cap_day THEN
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
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Expose the signup knob to the edge function's service-role read.
--    `platform_settings` is admin-only under RLS; the service role bypasses
--    it, so nothing further is needed for complete-signup. No grant is added
--    for anon or authenticated — the caps are operator state, not public.
-- ───────────────────────────────────────────────────────────────────────────
