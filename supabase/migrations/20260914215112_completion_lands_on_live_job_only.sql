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
--   2. poster_cancel_job refuses a job whose Helpr has marked it done, read
--      under its existing FOR UPDATE. Body is 20260908155425's verbatim
--      (identical to prod's pg_get_functiondef on 2026-09-14) plus that one
--      check and the column it reads.
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
