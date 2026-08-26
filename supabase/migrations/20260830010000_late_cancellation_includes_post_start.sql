-- late_cancellation must agree with the fee ladder at NEGATIVE hours.
--
-- THE DEFECT (found in a test-mode lifecycle run, 2026-08-26)
-- ----------------------------------------------------------
-- Both cancellation writers stamped the flag as:
--
--     late_cancellation = (v_hours IS NOT NULL AND v_hours < 24 AND v_hours > 0)
--
-- The `> 0` guard exempts a job cancelled AFTER its start time. But the fee
-- ladder does not exempt it — `cancellation_fee_percent` reads
--
--     WHEN p_hours_until < 2 THEN 50
--
-- and negative hours are less than 2, so a post-start cancellation is charged
-- the MAXIMUM 50% tier. The flag therefore said "not late" on precisely the
-- worst case, while the money said "worst possible late". Measured on job
-- 6c7f58e6-4c7a-4ebf-bec3-ea1748003663: -2.95h until start, cancellation_fee
-- $60.00 on a $120 budget (= 50%), late_cancellation = false. The 08:20
-- money-reconciliation cron independently flagged the same row.
--
-- The money is right; the flag was wrong. NO CHARGE CHANGES HERE — this
-- migration touches only the boolean, never `v_fee` / `v_percent`.
--
-- The bound now matches `money-reconciliation`'s `late_cancellation_flag_wrong`
-- check (`hrs < 24`, evaluated only when a helper was assigned), and is pinned
-- by `src/lib/cancellationFee.parity.test.ts` so the two cannot drift again.

-- One expression, one place. Both writers call this instead of re-typing the
-- bound; a future ladder change edits exactly one function.
CREATE OR REPLACE FUNCTION public.is_late_cancellation(
  p_has_helper boolean,
  p_hours_until numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- No helper committed => the ladder charges 0% and "late" has no meaning.
  -- Otherwise: anything inside 24h, INCLUDING negative (already started), is
  -- late — exactly the range in which cancellation_fee_percent() charges.
  SELECT COALESCE(p_has_helper, false)
     AND p_hours_until IS NOT NULL
     AND p_hours_until < 24;
$function$;

GRANT EXECUTE ON FUNCTION public.is_late_cancellation(boolean, numeric)
  TO anon, authenticated, service_role;

-- ── Writer 1: poster_cancel_job ──────────────────────────────────────────────
-- Reproduced verbatim from the live definition (pg_get_functiondef, 2026-08-26)
-- with ONLY the v_late assignment changed.
CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_late boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The server owns the decision. A helper (or any third party) hitting this
  -- gets not_authorized rather than a partial write.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately NOT 'pending_approval': enforce_job_status_transition has no
  -- pending_approval -> cancelled edge for a non-admin, so offering it here
  -- would promise an exit the very next trigger rejects. That draft is
  -- withdrawn through reject_pending_job, which is the business-approval path.
  -- 'disputed' is excluded too: escrow must not move while a human is deciding.
  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'This job is already finished, cancelled, or under dispute.';
  END IF;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  v_hours   := public.job_hours_until_start(v_job.date_needed, now());
  v_percent := public.cancellation_fee_percent(v_job.helper_id IS NOT NULL, v_hours);
  v_fee := CASE
    WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
      THEN round(v_job.budget * v_percent) / 100.0
    ELSE 0
  END;
  -- CHANGED 2026-08-26: was `v_hours < 24 AND v_hours > 0`, which called a
  -- post-start cancellation "not late" while charging it the top 50% tier.
  v_late := public.is_late_cancellation(v_job.helper_id IS NOT NULL, v_hours);

  PERFORM set_config('app.sanctioned_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         late_cancellation = v_late,
         cancellation_fee = v_fee,
         cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
   WHERE id = v_job.id;

  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  -- Tell the Helpr what happened to their money. This used to be a separate
  -- client-side createNotification() that a cancelling client could skip.
  IF v_job.helper_id IS NOT NULL THEN
    v_commission := COALESCE(v_job.helper_fee_percent, 10);
    v_helper_cut := GREATEST(0, round((v_fee - round(v_fee * v_commission) / 100.0) * 100) / 100.0);

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the poster. You''ll receive approximately $%s as a cancellation fee (%s%% of the budget minus platform fee), processed within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        ELSE
          format('"%s" was cancelled by the poster. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/my-jobs'
    );

    -- THE LADDER, in the same transaction as the state change. Idempotent on
    -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
    -- however many times this is retried.
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    'had_helper', v_job.helper_id IS NOT NULL
  );
END;
$function$;

-- ── Writer 2: block_user_and_settle ─────────────────────────────────────────
-- Same one-line change; body otherwise verbatim from the live definition.
CREATE OR REPLACE FUNCTION public.block_user_and_settle(p_blocked uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. `app.sanctioned_cancel`
    -- additionally satisfies trg_cancellation_requires_rpc: this IS one of the
    -- sanctioned exits. Both hatches are transaction-local and switched off
    -- again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           -- CHANGED 2026-08-26: see is_late_cancellation() above.
           late_cancellation = public.is_late_cancellation(v_job.helper_id IS NOT NULL, v_hours),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested');

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);
    PERFORM set_config('app.sanctioned_cancel', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

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
$function$;
