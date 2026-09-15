-- The job-completion race: the Helpr's Done tap against the poster confirming
-- or cancelling at the same moment. Re-derived 2026-09-14 from the LIVE
-- definitions (pg_get_functiondef, read-only), after today's
-- 20260914201350 (jobs.completed_at + zz_jobs_stamp_completed_at) and
-- 93237acdf (create-payment release is a conditional write).
--
-- THE WRITERS
--   helper_completed_at   JobTracking.updateStatus("done") — a client UPDATE
--                         as the Helpr, id predicate only; create-payment
--                         `release` as the Helpr (service role, conditional).
--   poster_completed_at   create-payment `release` as the poster (conditional).
--   status -> completed   create-payment `release`, auto-release-payment
--                         (service role), admin paths.
--   status -> cancelled   poster_cancel_job / helper_cancel_booking /
--                         block_user_and_settle (FOR UPDATE RPCs), admin.
--
-- THE HOLE. The Helpr's stamp is judged by enforce_helper_completion_gates
-- (arrival, photos, 30-minute floor) and enforce_helper_jobs_column_whitelist
-- (column list) — neither looks at the job's STATUS, and neither looks at
-- whether the stamp is already there. Measured with a prod-shaped PGlite
-- harness running the live trigger and RPC bodies, every interleaving of the
-- real network boundaries, 20 rounds each:
--
--   Done vs poster cancel         20/20  cancelled job carrying a done stamp.
--     Cancel first: the stamp queued behind poster_cancel_job's FOR UPDATE and
--     landed on the cancelled row (the Helpr is told the payout clock started
--     on a job that will never pay). Done first: poster_cancel_job saw an
--     in_progress row and cancelled finished work — escrow queued for refund,
--     a late-cancellation fee, and a strike on the poster.
--   Done again vs poster approve  20/20  helper_completed_at moved (in 6 of
--     the 20 rounds to AFTER completed_at, on a job already released, which
--     also re-fires notify_poster_on_status_change's "marked the job
--     complete — please review"). A second tap, a second device or a
--     same-frame double tap all rewrite the stamp the 24h auto-release clock,
--     the earnings export and the work record read.
--   Done vs poster confirm        14/20  both parties confirmed, job left
--     in_progress (the poster's conditional release committed first with the
--     Helpr not yet done; the Helpr's plain stamp then completed nothing). Not
--     reachable from the poster's screen (Approve renders only once
--     helper_completed_at is set), but reachable through the API. Fixed on
--     the client: JobTracking asks create-payment to finish the release when
--     its stamp comes back with poster_completed_at set — the database cannot
--     finish a release, which needs the Stripe capture check. That release
--     re-sets helper_completed_at (index.ts:775); the pin below keeps the
--     Helpr's first stamp through it.
--
-- THE FIX
--   1. trg_completion_on_live_job. For an end-user session:
--        - stamping (NULL -> value) requires OLD.status to be live
--          (accepted / in_progress / revision_requested). OLD is the row
--          version this UPDATE locked — the one a concurrent cancel, release
--          or dispute committed — so this judges the truth at lock time. Same
--          shape as trg_confirm_on_live_job (20260913014328).
--        - re-stamping (value -> different value) is a no-op for every API
--          session, service role included: the FIRST stamp is kept. A
--          duplicate Done is then idempotent (no moved clock, and
--          notify_poster_on_status_change sees no change, so no second notice).
--          A direct database session (no JWT role) may still rewrite it.
--      The service role's status is not judged: create-payment and
--      auto-release write conditionally and check status themselves.
--        - clearing (value -> NULL) is refused for every end-user session,
--          admins included (no admin screen or RPC clears it); otherwise the
--          rules here are one PATCH deep (review follow-up, lh-authz-rls).
--   2. poster_cancel_job refuses a job whose Helpr has marked it done, read
--      under its existing FOR UPDATE. Body is 20260908155425's verbatim
--      (identical to prod's pg_get_functiondef on 2026-09-14) plus that one
--      check and the column it reads.
--   3. block_user_and_settle skips (does not cancel) a job marked done.
--   4. report_helper_no_show and helper_cancel_booking refuse a job marked
--      done instead of reopening it with the stamp still on it.
--   (3 and 4 are review follow-ups from lh-money-escrow / lh-authz-rls; each
--   body is prod's pg_get_functiondef with only the stated change, grants and
--   search_path kept. PGlite: every case red on live prod, green here, and red
--   again on a copy of this file with that one rule removed.)
--
-- completed_at / the 24h messaging lockout: untouched. Neither object here
-- writes status or completed_at, so zz_jobs_stamp_completed_at still stamps it
-- once, on the transition to completed; the harness asserts
-- job_messaging_closes_at = completed_at + 24h on every completed round.
--
-- REPLAY-SAFETY: CREATE OR REPLACE / DROP TRIGGER IF EXISTS only; plpgsql
-- bodies resolve at call time, so nothing here needs a later object at DDL time.

-- ── 1. helper_completed_at lands once, and only on a live job ────────────
CREATE OR REPLACE FUNCTION public.enforce_completion_on_live_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- NO END USER UNSTAMPS DONE. A value -> NULL change from any end-user
  -- session (Helpr, poster, admin alike — no admin screen or RPC clears it)
  -- is refused. Without this the pin below and poster_cancel_job's refusal
  -- are one PATCH deep: the poster (RLS "Customers can update their own
  -- jobs") wipes the stamp and then cancels finished work, or the Helpr clears
  -- and re-stamps to move the auto-release clock. A direct database session
  -- (no uid) can still clear it.
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS NULL
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'helper_completed_at_not_clearable'
      USING ERRCODE = '42501',
            HINT = 'A job marked done stays marked done. Ask for a change or open a dispute instead.';
  END IF;

  -- A second Done keeps the FIRST stamp. A no-op rather than an error, so the
  -- duplicate is idempotent: the auto-release clock does not move and
  -- notify_poster_on_status_change sees no change, so no second notice.
  -- Applies to API sessions INCLUDING the service role: create-payment's
  -- release, finishing a job both parties already confirmed, sets
  -- helper_completed_at = now() again (index.ts:775) and would otherwise move
  -- the Helpr's stamp at the very moment it completes the job. Only a direct
  -- database session (postgres, pg_cron, a migration — no JWT role) may
  -- rewrite it, e.g. to backdate a seed fixture.
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at
     AND (auth.uid() IS NOT NULL
          OR COALESCE(auth.role(), '') IN ('anon', 'authenticated', 'service_role')) THEN
    NEW.helper_completed_at := OLD.helper_completed_at;
    RETURN NEW;
  END IF;

  -- Status is judged for real end-user sessions only, exactly as
  -- enforce_confirm_on_live_job beside it. create-payment and
  -- auto-release-payment write on the service role with a conditional UPDATE
  -- and check status themselves.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the stamping transition is judged below.
  IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- OLD is the row version this UPDATE locked — the one a concurrent cancel,
  -- release or dispute committed, if there was one.
  IF OLD.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer active (status=' || OLD.status::text || '), so it cannot be marked done.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_completion_on_live_job() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_completion_on_live_job ON public.jobs;
CREATE TRIGGER trg_completion_on_live_job
  BEFORE UPDATE OF helper_completed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_completion_on_live_job();

-- ── 2. poster_cancel_job: a job marked done is not cancellable ───────────
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
  v_committed boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent, j.helper_confirmed_at,
         j.helper_completed_at
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

  -- ADDED 2026-09-14: a job the Helpr has marked DONE is not cancellable.
  -- From here the poster's moves are approve, ask for a change, or dispute —
  -- never a cancel that refunds the escrow and pays a cancellation fee for
  -- finished work. No poster screen offers Cancel once work is underway
  -- (derivePosterStep renders no Cancel for in_progress/revision_requested),
  -- so the only way here was a stale screen racing the Helpr's Done. Read under
  -- the FOR UPDATE above: a Done that committed first is seen here, and a Done
  -- queued behind this lock is refused by trg_completion_on_live_job.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.';
  END IF;

  -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
  -- Chosen is not committed; see this migration's header.
  v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  -- CHANGED 2026-09-05: now anchored on the job's START TIME, not midnight of
  -- its day. See that migration's header for the 41-hours-reads-as-23 case.
  v_hours   := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
  v_percent := public.cancellation_fee_percent(v_committed, v_hours);
  v_fee := CASE
    WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
      THEN round(v_job.budget * v_percent) / 100.0
    ELSE 0
  END;
  -- CHANGED 2026-08-26: was `v_hours < 24 AND v_hours > 0`, which called a
  -- post-start cancellation "not late" while charging it the top 50% tier.
  v_late := public.is_late_cancellation(v_committed, v_hours);

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
  -- Still sent to a merely-offered Helpr: they were waiting on this job and
  -- deserve to know it is gone — but with copy that does not promise a fee.
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
        WHEN NOT v_committed THEN
          -- The old copy claimed "it was more than 24 hours out", which is
          -- simply false when the reason for the $0 is that this offer was
          -- never accepted.
          format('"%s" was cancelled by the poster before you accepted it, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
        ELSE
          format('"%s" was cancelled by the poster. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/my-jobs?job=' || v_job.id::text
    );
  END IF;

  -- THE LADDER, in the same transaction as the state change. Idempotent on
  -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
  -- however many times this is retried.
  -- CHANGED 2026-09-08: gated on v_committed, not on helper_id alone.
  IF v_committed THEN
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    -- Kept under its original key so existing callers keep parsing, but it now
    -- answers the question the callers were always really asking.
    'had_helper', v_committed,
    'helper_committed', v_committed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated, service_role;

-- ── 3. block_user_and_settle: a job marked done is not settled by a block ─
-- Review finding (lh-money-escrow, 2026-09-14): with no race at all, a poster
-- could let the Helpr tap Done and then block them — the loop cancelled the
-- finished job with a start-anchored fee and void-cancelled-payments refunded
-- the rest. Body is prod's pg_get_functiondef (identical to 20260905021859)
-- with ONE change: `j.helper_completed_at IS NULL` in the loop's locked
-- SELECT and in the UPDATE predicate. The block itself still lands first; the
-- done job stays live, and the poster's moves are approve, ask for a change,
-- or dispute — same as poster_cancel_job above.
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
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       -- ADDED 2026-09-14: finished work is not cancelled by a block.
       AND j.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    -- CHANGED 2026-09-05: anchored on start_time, matching poster_cancel_job.
    -- Both settle paths must price a cancellation identically or the fee a
    -- poster is quoted depends on which exit they happened to take.
    v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
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
       AND status IN ('accepted', 'in_progress', 'revision_requested')
       AND helper_completed_at IS NULL;

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
      CASE WHEN v_job.helper_id = p_blocked THEN '/my-jobs?job=' ELSE '/my-posts?job=' END || v_job.id::text
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

REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO authenticated, service_role;

-- ── 4. The two reopen paths refuse a job marked done ─────────────────────
-- Review finding (lh-money-escrow, 2026-09-14): report_helper_no_show and
-- helper_cancel_booking reopen the job (status 'open', helper_id NULL) without
-- clearing helper_completed_at. With the pin and the clear refusal above, the
-- next Helpr would inherit a stamp they cannot correct, the poster could no
-- longer cancel a job nobody had worked, and auto-release-payment (keyed on
-- helper_completed_at <= cutoff, statuses incl. accepted) could release escrow
-- to the new Helpr before any work. Clearing the stamp would undo the Helpr's
-- claim that the work is done, so both paths instead REFUSE once it is set:
-- the poster's moves on a job marked done are approve, ask for a change, or
-- dispute. Bodies are prod's pg_get_functiondef (identical to 20260831183302
-- and 20260824243000) plus the column read under their existing FOR UPDATE
-- and one check. No UI offers either action on a done job (No-Show hides once
-- the Helpr arrived; Helpr cancel is accepted-only).
CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_helper_completed_at timestamptz;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_completed_at
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_helper_completed_at
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- ADDED 2026-09-14: a Helpr who marked the job done did not no-show.
  IF v_helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_marked_done'
      USING HINT = 'Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never reach the top rung.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  -- The ladder itself is no longer written here. Same core, same policy switch
  -- as the other three wrappers: 'permanent' + p_permanent_requires_review
  -- becomes 'review' — a reversible 7-day restriction plus an admin case.
  v_result := public.apply_consequence_ladder(
    p_user                      => v_helper_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    -- No Helpr-facing copy from the core: the client already sends exactly one
    -- notification for this event (see the header). Casts are required —
    -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept verbatim from the
    -- old direct-ban path so that path stays fully specified if the policy is
    -- ever revisited.
    p_ban_reason                => 'Repeated no-show violations'
  );

  -- ATTRIBUTION. The shared core does not know about `reported_by` — it is a
  -- column only the no-show ladder uses, and it is load-bearing: GUARD 3b
  -- counts DISTINCT reporters, and count(DISTINCT reported_by) ignores NULLs,
  -- so an unstamped row would make every future no-show look like a first
  -- offence and the ladder would never escalate at all. GUARD 3a proved above
  -- that this job had NO no_show row before the core inserted one, so this
  -- matches exactly the row just written.
  UPDATE public.user_violations
     SET reported_by = auth.uid()
   WHERE job_id = p_job_id
     AND violation_type = 'no_show'
     AND reported_by IS NULL;

  -- Reopen the job so the poster can pick another applicant.
  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  -- Return shape unchanged: the core supplies {action, prior_count}, and the
  -- two fields the client reads for its own notifications are merged back on.
  RETURN v_result || jsonb_build_object(
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.report_helper_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_helper_no_show(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
BEGIN
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- ADDED 2026-09-14: reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the poster or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the poster or support.';
  END IF;

  v_result := public.apply_job_denial_consequence(
    auth.uid(), v_job.id,
    'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr cancelled',
    'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
      || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/my-posts?job=' || v_job.id::text
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;
