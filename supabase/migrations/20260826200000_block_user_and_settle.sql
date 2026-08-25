-- Blocking someone mid-job stops being a free late-cancel.
--
-- ── What it was ────────────────────────────────────────────────────────────
-- src/lib/userBlocks.ts inserted the block and then, FROM THE BROWSER, wrote
--   jobs.status = 'cancelled', cancellation_fee = 0, cancellation_fee_status = NULL
-- on every live shared job. The "Customers can update their own jobs" policy
-- is column-unrestricted, and enforce_poster_jobs_money_lock permits the
-- poster's own cancellation columns, so the write lands.
--
-- Two things followed from that, one of which is NOT a money bug and should
-- be stated plainly so nobody "fixes" it twice:
--
--   * The MONEY was already safe. void-cancelled-payments never reads
--     jobs.cancellation_fee — since F-MONEY-32 it RECOMPUTES the fee from
--     _shared/cancellationFee.ts using budget + date_needed + cancelled_at +
--     helper_id, all of which the block path leaves intact and truthful. The
--     hourly cron therefore already charges the correct late-cancel fee and
--     already pays the helper their share. Writing 0 into the column did not
--     move a cent; it made the ROW lie to every reader of it (the fee pill
--     both parties see, admin late-cancel revenue, the helper's record).
--
--   * The STRIKE was genuinely skipped. The normal poster cancel path —
--     CancellationDialog — calls apply_cancellation_violation_consequence
--     after cancelling. The block path called nothing. So "block the helper"
--     was a one-tap way to cancel late and skip the reliability ladder
--     entirely: no warning, no final warning, no 7-day review.
--
-- ── What it is now ─────────────────────────────────────────────────────────
-- One SECURITY DEFINER RPC owns the whole gesture: the block still happens,
-- and every live shared job settles through the SAME rules the normal cancel
-- path uses — fee from the same ladder (never hardcoded 0), helper notified,
-- strike recorded through the existing ladder RPC. The client no longer
-- writes `jobs` at all in this path.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The cancellation ladder, in SQL
-- ───────────────────────────────────────────────────────────────────────────
-- A faithful port of supabase/functions/_shared/cancellationFee.ts, kept in
-- lock-step with it (that module remains the authority for the money that
-- actually MOVES; this one exists so a server-side cancel can persist the
-- same number instead of guessing).
--
--     no helper assigned        → 0%
--     24+ hours before the job  → 0%
--     less than 24 hours        → 25%
--     less than 2 hours         → 50%
--
-- date_needed is a bare calendar date, so "midnight on that day" is only
-- meaningful in ONE zone — America/Chicago, the same JOB_TIMEZONE the TS
-- module pins. Reading it in the database's zone (UTC) would shift the tier
-- boundary by 5-6 hours and quote a poster one tier while charging another.
CREATE OR REPLACE FUNCTION public.cancellation_fee_percent(
  p_has_helper boolean,
  p_hours_until numeric
) RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN NOT COALESCE(p_has_helper, false) THEN 0
    WHEN p_hours_until IS NULL THEN 0
    WHEN p_hours_until < 2 THEN 50
    WHEN p_hours_until < 24 THEN 25
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.cancellation_fee_percent(boolean, numeric) IS
  'Tiered late-cancellation percentage. Mirrors cancellationFeePercent() in supabase/functions/_shared/cancellationFee.ts — change both together.';

-- Hours between an instant and midnight on the job date, in America/Chicago.
CREATE OR REPLACE FUNCTION public.job_hours_until_start(
  p_date_needed date,
  p_at timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_date_needed IS NULL THEN NULL
    ELSE extract(epoch FROM (
      (p_date_needed::timestamp AT TIME ZONE 'America/Chicago') - COALESCE(p_at, now())
    )) / 3600.0
  END::numeric;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. block_user_and_settle
-- ───────────────────────────────────────────────────────────────────────────
-- Acts on auth.uid() as the blocker only — a modified client cannot block on
-- somebody else's behalf, and cannot choose the fee. Idempotent: calling it
-- twice re-inserts nothing, re-cancels nothing (the UPDATE is guarded on the
-- job still being live), and the ladder RPC is already job-keyed idempotent.
CREATE OR REPLACE FUNCTION public.block_user_and_settle(
  p_blocked uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_updated int;
  v_settled jsonb := '[]'::jsonb;
  v_ladder_present boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_blocked IS NULL OR p_blocked = v_user THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- The block itself first: whatever happens to the jobs below, the person
  -- asking to be left alone is left alone.
  INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
  VALUES (v_user, p_blocked, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  v_ladder_present :=
    to_regprocedure('public.apply_cancellation_violation_consequence(uuid)') IS NOT NULL;

  FOR v_job IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.customer_id, j.helper_id, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    v_hours := public.job_hours_until_start(v_job.date_needed, now());
    v_percent := public.cancellation_fee_percent(v_job.helper_id IS NOT NULL, v_hours);
    -- round(budget * percent) / 100 — the cent-accurate form the TS module
    -- and the client estimate both use.
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. Narrow, transaction-
    -- local hatch, switched off again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           late_cancellation = (v_hours IS NOT NULL AND v_hours < 24 AND v_hours > 0),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested');

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    -- Tell the HELPER what happened to their money. (When the blocker is the
    -- helper, the counterparty is the poster and this is the poster's job
    -- being cancelled out from under them — notify them either way.)
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      p_blocked,
      'Job cancelled',
      CASE
        WHEN v_fee > 0 AND v_job.helper_id = p_blocked THEN
          format('"%s" was cancelled. Because it was cancelled late, a $%s cancellation fee applies and your share is on its way — it settles within the hour.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so a $%s cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. No cancellation fee applies.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/my-jobs'
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_job.helper_id IS NOT NULL THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.title,
      'cancellation_fee', v_fee,
      'fee_percent', v_percent
    );
  END LOOP;

  RETURN jsonb_build_object('blocked', p_blocked, 'settled', v_settled);
END;
$$;

REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. verification_exceptions: an admin review queue no admin could read
-- ───────────────────────────────────────────────────────────────────────────
-- The only non-owner policy is named "Admins manage exceptions" but its qual
-- is `auth.role() = 'service_role'`. Under a real admin JWT auth.role() is
-- 'authenticated', so the policy matched nobody who ever opens the admin UI:
-- AdminExceptionQueue rendered permanently empty (indistinguishable from
-- "nothing to review") and its resolve() updated zero rows while reporting
-- success. Verified against pg_policies on the live database before writing.
--
-- The service_role policy stays (edge functions insert exceptions through it).
-- This adds the admin grant, in the same shape user_bans / user_violations /
-- fraud_flags use.
DROP POLICY IF EXISTS "Admins can manage verification exceptions" ON public.verification_exceptions;
CREATE POLICY "Admins can manage verification exceptions"
  ON public.verification_exceptions
  FOR ALL
  TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((SELECT auth.uid()), 'admin'::app_role));
