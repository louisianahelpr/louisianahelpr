-- No strike, and no fee, for cancelling an offer the Helpr never accepted.
--
-- OWNER DECISION 2026-09-08. The state-matrix sweep reproduced this against
-- prod: a poster accepted an applicant (or sent an offer), the Helpr never
-- answered, the poster cancelled -- and a `user_violations` row of type
-- `cancel_with_helper` was written, escalating their ban_status. Nobody had
-- committed to anything, so nobody was let down.
--
-- WHY IT HAPPENED. `jobs.helper_id IS NOT NULL` was being read as "a Helpr is
-- committed", and it is not. `accept_application` sets helper_id and
-- status='accepted' as the POSTER's act of choosing; the Helpr has not yet
-- answered at that point. The second half of that handshake is
-- `helper_confirmed_at`, and its absence is exactly what
-- `expire_unanswered_offers` sweeps for -- that sweep penalises the HELPER for
-- never answering, which is only coherent if the poster is not simultaneously
-- penalised for walking away from the same silence.
--
-- THE PREDICATE. `helper_id IS NOT NULL AND helper_confirmed_at IS NOT NULL`.
-- This is not a new invention: `auto_start_due_jobs` already uses exactly this
-- pair, and says why in its own comment -- "Truly BOOKED, not merely offered.
-- `accepted` covers two different moments: helpr chosen but not yet confirmed,
-- and both sides locked in."
--   * Direct offers were never affected: a pending direct offer lives in
--     `offered_to_helper_id` / `direct_offer_status='pending'` with helper_id
--     still NULL, and `respond_to_direct_offer` stamps helper_confirmed_at in
--     the same UPDATE that sets helper_id -- so accepting a direct offer is
--     committed under the new predicate on the very first transition.
--   * `helper_confirmed_at` is durable and survives the cancel, so the edge
--     recomputation in void-cancelled-payments can reach the same verdict
--     later. Job `status` deliberately is NOT part of the predicate: it reads
--     'cancelled' by the time that function runs, so any status term would
--     make the RPC and the money path disagree.
--
-- THE FEE MOVES TOO, and deliberately. `cancellation_fee_percent` exists to
-- "compensate the Helpr for their committed time" -- the dialog says so, and
-- the ladder copy says "after a Helpr had already committed". Charging it when
-- nobody committed bills the poster for a loss no one suffered, and the money
-- would be split to a Helpr who had not agreed to the job. Gating it can only
-- move a charge from >0 to 0, so the conservative direction is preserved: no
-- path here can now charge MORE than it did before this migration.
--
-- Replay-safe: CREATE OR REPLACE of an existing function, no DDL on objects a
-- later migration may redefine. The ACL below reproduces prod's
-- pg_proc.proacl verbatim ({postgres=X,authenticated=X,service_role=X} --
-- anon is named explicitly in the REVOKE because REVOKE ... FROM PUBLIC alone
-- does not drop Supabase's individual anon grant).

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
         j.status, j.helper_fee_percent, j.helper_confirmed_at
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
