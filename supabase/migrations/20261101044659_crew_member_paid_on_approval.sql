-- JOBS-3, per-member crew pay (owner 2026-10-31 ~9:35 PM, pop-up): "crew
-- members are paid individually once the poster confirms they worked; a
-- no-show member gets nothing + a strike; others are never held up."
--
-- WHAT WAS WRONG (measured 2026-10-31 on wip/b54-1031, b58 handoff): a crew
-- was paid only as a whole. process-scheduled-payouts pays a crew's members
-- one by one, but only once the JOB is completed and approved
-- (status completed, payment_status payout_pending, payout_scheduled_at due),
-- so one member who finished on Monday waited for the slowest member and for
-- the poster's approval of the whole crew. The no-show part is done
-- (20261101031804). This migration is the "paid individually once the poster
-- confirms" part.
--
-- WHAT THIS INSTALLS (no new column):
--   1. crew_member_payout_delay(): the 3 days between the poster's approval
--      and the transfer, the SQL twin of STANDARD_PAYOUT_DAYS_AFTER_APPROVAL
--      (supabase/functions/_shared/escrowTiming.ts; parity test
--      src/test/crewMemberPaidOnApproval.test.ts).
--   2. rpc_poster_approve_member(_job_id, _member_id): the job's POSTER
--      confirms ONE member's work. Stamps group_job_helpers.
--      poster_confirmed_completion_at (a column that has existed and been
--      server-owned since 20260919192559, trigger
--      zza_group_member_lifecycle_server_owned, and that nothing wrote until
--      now). Refused unless: the caller is the poster; the job is a crew,
--      in_progress or revision_requested, with its money captured and held
--      (payment_status 'escrow'); no dispute is open or decided-unexecuted
--      on it; the member is on the roster, marked their part done, has a
--      share frozen at hire, and was not approved before (already_approved).
--      The member is told the DAY they are paid (type financial_alerts, job
--      as the subject so the seed boundary drops a test job's notice).
--   3. crew_members_due_early_payout(): service_role only. The (job, member)
--      pairs the payout cron pays EARLY, before the whole crew is done: a
--      crew job not disputed (status not disputed, no open dispute, no
--      decided-unexecuted dispute, no payment_refunds row), money held
--      (escrow, or payout_pending whose job-wide payout is not due yet), the
--      member approved at least crew_member_payout_delay() ago, frozen share,
--      and NO live payout_transfers row for that member (pending, paid or
--      reversed), except an orphaned claim (pending, no transfer id, older
--      than the 2-minute in-flight window), which stays listed so the cron
--      resumes it on the same idempotency key. The cron's early pass pays these and NEVER refunds, closes
--      or releases the job; the normal pass later pays the rest once and
--      settles once (Step 4's ledger guard skips the already-paid member).
--   4. rpc_decide_crew_dispute, restated from its NEWEST definition
--      (20260927012240, the only one), with two changes:
--        a. a member the poster approved, or with a live transfer, can NEVER
--           be named in THIS function's per-member refund set
--           (crew_dispute_member_already_paid): their pay may already be out.
--           This is not a promise that nothing refunds them: an admin's
--           dispute "Full refund" (a separate action, not this function) can
--           still refund the whole job, including a confirmed member whose pay
--           has NOT gone out yet. That is the admin's call and is kept (lead,
--           11-01).
--        b. "money moved" no longer refuses a crew whose ONLY moved money is
--           early transfers to approved members (otherwise one early payout
--           would leave the rest of the crew's dispute undecidable). Any
--           other live transfer, or any refund, still refuses as before.
--      Those members are recorded 'pay' and count in pay_cents, so the
--      fan-out's single refund (budget minus every paid share) never returns
--      an already-paid member's share to the poster.
--
-- REPLAY-SAFE: CREATE OR REPLACE throughout; grants restated each run.
-- Proof: src/test/pglite/crewMemberPaidOnApproval.pglite.mjs (--before red).

-- ── 1. The payout delay, SQL twin ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crew_member_payout_delay()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$ SELECT interval '3 days' $function$;

REVOKE ALL ON FUNCTION public.crew_member_payout_delay() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_member_payout_delay() TO authenticated, service_role;

-- ── 2. The poster confirms one member's work ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_poster_approve_member(_job_id uuid, _member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_slot record;
  v_now timestamptz := now();
  v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock order jobs -> roster slot, as the no-show report and the dispute RPCs.
  SELECT j.id, j.customer_id, j.title, j.payment_status, j.is_group_job, j.status::text AS status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = _job_id
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_job.is_group_job IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_crew_job'
      USING HINT = 'This job has one Helpr: approve the job itself.';
  END IF;
  IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active'
      USING HINT = 'You can confirm a crew member''s work while the job is under way.';
  END IF;
  IF v_job.payment_status IS DISTINCT FROM 'escrow' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'The payment for this job is not being held, so nobody can be paid from it.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND (d.status = 'open'
            OR (d.status = 'decided' AND d.execution_status IS DISTINCT FROM 'executed'))
  ) THEN
    RAISE EXCEPTION 'job_disputed'
      USING HINT = 'This job has a dispute, so an admin decides who is paid.';
  END IF;

  SELECT g.* INTO v_slot
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id AND g.helper_id = _member_id
   FOR UPDATE;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;
  IF v_slot.helper_completed_at IS NULL THEN
    RAISE EXCEPTION 'helper_not_done'
      USING HINT = 'This crew member has not marked their part done yet.';
  END IF;
  IF v_slot.poster_confirmed_completion_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_approved'
      USING HINT = 'You already confirmed this crew member''s work.';
  END IF;
  IF v_slot.share_cents IS NULL OR v_slot.slot_no IS NULL THEN
    RAISE EXCEPTION 'crew_share_not_frozen'
      USING HINT = 'This crew member is paid when you approve the whole job.';
  END IF;

  UPDATE public.group_job_helpers
     SET poster_confirmed_completion_at = v_now
   WHERE id = v_slot.id;

  v_due := v_now + public.crew_member_payout_delay();

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (_member_id,
          'Your work was confirmed',
          'The person who posted "' || COALESCE(v_job.title, 'the job') || '" confirmed your work. You''ll be paid on '
            || to_char(v_due AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD') || '.',
          'financial_alerts',
          '/jobs?job=' || _job_id::text,
          _job_id);

  RETURN jsonb_build_object('helper_id', _member_id, 'approved_at', v_now, 'payout_due_at', v_due);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_poster_approve_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_poster_approve_member(uuid, uuid) TO authenticated, service_role;

-- ── 3. Who the payout cron pays early ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crew_members_due_early_payout()
RETURNS TABLE(job_id uuid, helper_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.job_id, g.helper_id
    FROM public.group_job_helpers g
    JOIN public.jobs j ON j.id = g.job_id
   WHERE j.is_group_job IS TRUE
     AND g.helper_id IS NOT NULL
     AND g.helper_completed_at IS NOT NULL
     AND g.poster_confirmed_completion_at IS NOT NULL
     AND g.poster_confirmed_completion_at + public.crew_member_payout_delay() <= now()
     AND g.share_cents IS NOT NULL AND g.slot_no IS NOT NULL
     AND j.status::text <> 'disputed'
     AND (
       (j.status::text IN ('in_progress', 'revision_requested') AND j.payment_status = 'escrow')
       -- Approved as a whole, its payout not due yet: the member approved
       -- earlier is still paid on their own day.
       OR (j.status::text = 'completed' AND j.payment_status = 'payout_pending'
           AND j.disputed_at IS NULL
           AND (j.payout_scheduled_at IS NULL OR j.payout_scheduled_at > now()))
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.disputes d
        WHERE d.job_id = g.job_id
          AND (d.status = 'open'
               OR (d.status = 'decided' AND d.execution_status IS DISTINCT FROM 'executed')))
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = g.job_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.payout_transfers t
        WHERE t.job_id = g.job_id AND t.helper_id = g.helper_id
          AND t.status IN ('pending', 'paid', 'reversed')
          -- An ORPHANED claim (pending, no transfer id, past the 2-minute
          -- in-flight window: OPEN_CLAIM_INFLIGHT_MS in
          -- supabase/functions/_shared/payoutClaim.ts) does not hide the
          -- member: a crashed or failed run leaves one, and the cron's claim
          -- code resumes it with the SAME idempotency key (never a second
          -- transfer). Without this the approved member waited for the whole
          -- crew (lh-money-escrow review, 11-01).
          AND NOT (t.status = 'pending' AND t.stripe_transfer_id IS NULL
                   AND t.created_at < now() - interval '2 minutes'))
$function$;

REVOKE ALL ON FUNCTION public.crew_members_due_early_payout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crew_members_due_early_payout() TO service_role;

-- ── 4. rpc_decide_crew_dispute: never refunds a confirmed or paid member ───
-- Restated from 20260927012240 (its only definition). Changes are marked
-- "JOBS-3".
CREATE OR REPLACE FUNCTION public.rpc_decide_crew_dispute(
  _dispute_id uuid, _decision_text text, _refund_helper_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _job_id uuid;
  _job record;
  _existing_status text;
  -- Deduplicated: a member named twice is still one member (the poster's
  -- notice counts them).
  _refund uuid[] := COALESCE((SELECT array_agg(DISTINCT r) FROM unnest(_refund_helper_ids) AS r), '{}'::uuid[]);
  _members integer;
  _pay_cents bigint;
  _refund_cents bigint;
  _budget_cents bigint;
  _m record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF _decision_text IS NULL OR length(btrim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  SELECT job_id INTO _job_id FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  -- Lock order jobs -> disputes, as every dispute RPC.
  SELECT id, customer_id, title, is_group_job, status::text AS status, payment_status, budget
    INTO _job
    FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT status INTO _existing_status FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  IF _existing_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'dispute already %', COALESCE(_existing_status, 'gone');
  END IF;

  IF _job.is_group_job IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_crew_job'
      USING HINT = 'Decide a single-Helpr dispute with rpc_decide_dispute.';
  END IF;

  -- An admin who is the poster or on the crew does not rule on it.
  IF _uid IS NOT DISTINCT FROM _job.customer_id OR EXISTS (
       SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid) THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to decide its dispute.';
  END IF;

  -- Not while a settlement holds (or a dead holder stamped) the escrow.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This dispute''s payment is being settled right now, so it can''t be decided. Refresh in a few minutes.';
  END IF;

  IF _job.status IS DISTINCT FROM 'disputed' THEN
    RAISE EXCEPTION 'dispute_job_not_disputed';
  END IF;
  -- The escrow must still be held.
  IF COALESCE(_job.payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'crew_dispute_escrow_not_held'
      USING HINT = 'This job''s escrow is no longer held, so there is nothing to decide.';
  END IF;

  -- JOBS-3 (a): a member the poster approved, or one whose pay has left
  -- (a live transfer), cannot be named in this per-member refund set. (An
  -- admin's separate Full refund can still refund a confirmed member who is
  -- not paid yet; that is the admin's call.) Checked before anything else
  -- about the refund set, so the admin hears why.
  IF EXISTS (
    SELECT 1 FROM unnest(_refund) AS r(id)
      JOIN public.group_job_helpers g ON g.job_id = _job_id AND g.helper_id = r.id
     WHERE g.poster_confirmed_completion_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM unnest(_refund) AS r(id)
      JOIN public.payout_transfers t ON t.job_id = _job_id AND t.helper_id = r.id
     WHERE t.status IN ('pending', 'paid', 'reversed')
  ) THEN
    RAISE EXCEPTION 'crew_dispute_member_already_paid'
      USING HINT = 'A Helpr whose work was already confirmed is paid (or being paid); their share cannot be refunded.';
  END IF;

  -- JOBS-3 (b): money that moved refuses the decision, EXCEPT an early
  -- transfer to a member the poster approved who is still on the roster
  -- (crew_members_due_early_payout). Any refund still refuses.
  IF EXISTS (SELECT 1 FROM public.payout_transfers t
              WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid', 'reversed')
                AND NOT EXISTS (
                  SELECT 1 FROM public.group_job_helpers g
                   WHERE g.job_id = _job_id AND g.helper_id = t.helper_id
                     AND g.poster_confirmed_completion_at IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job_id) THEN
    RAISE EXCEPTION 'crew_dispute_money_moved'
      USING HINT = 'Money has already moved on this job; reconcile it by hand.';
  END IF;

  SELECT count(*) INTO _members
    FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL;
  IF _members = 0 THEN
    RAISE EXCEPTION 'crew_dispute_no_members'
      USING HINT = 'Nobody is on this crew: use Full refund.';
  END IF;
  -- Every outcome is priced on the member's share FROZEN at hire (Q407). A
  -- member hired before the shares existed has none, and nothing here may
  -- re-derive one.
  IF EXISTS (SELECT 1 FROM public.group_job_helpers g
              WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL
                AND (g.share_cents IS NULL OR g.slot_no IS NULL)) THEN
    RAISE EXCEPTION 'crew_share_not_frozen'
      USING HINT = 'A member of this crew has no frozen share: use Full refund, or settle it by hand.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_refund) AS r(id)
              WHERE r.id IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = r.id)) THEN
    RAISE EXCEPTION 'crew_dispute_unknown_member'
      USING HINT = 'Every member named for a refund must be on this crew.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_job_helpers g
                  WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL
                    AND NOT (g.helper_id = ANY (_refund))) THEN
    RAISE EXCEPTION 'crew_dispute_all_refunded'
      USING HINT = 'Refunding every member is a full refund: use the Full refund action.';
  END IF;

  INSERT INTO public.crew_dispute_member_outcomes
    (dispute_id, job_id, helper_id, slot_no, share_cents, member_outcome, decided_by)
  SELECT _dispute_id, _job_id, g.helper_id, g.slot_no, g.share_cents,
         CASE WHEN g.helper_id = ANY (_refund) THEN 'refund' ELSE 'pay' END, _uid
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL;

  SELECT COALESCE(sum(share_cents) FILTER (WHERE member_outcome = 'pay'), 0),
         COALESCE(sum(share_cents) FILTER (WHERE member_outcome = 'refund'), 0)
    INTO _pay_cents, _refund_cents
    FROM public.crew_dispute_member_outcomes WHERE dispute_id = _dispute_id;
  _budget_cents := GREATEST(round(COALESCE(_job.budget, 0) * 100)::bigint, 1);

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         -- Fractions of the budget, for every reader of payout_split; the
         -- per-member truth is crew_dispute_member_outcomes.
         payout_split = jsonb_build_object(
           'poster', round((_budget_cents - _pay_cents)::numeric / _budget_cents, 6),
           'helper', round(_pay_cents::numeric / _budget_cents, 6),
           'crew', true,
           'pay_cents', _pay_cents,
           'refund_share_cents', _refund_cents),
         -- Settled by process-scheduled-payouts' crew fan-out, which pays each
         -- 'pay' member their frozen share, refunds the rest to the poster and
         -- only then stamps 'executed' (mark_crew_dispute_executed).
         execution_status = 'crew_fanout'
   WHERE id = _dispute_id;

  -- Completed and queued for the fan-out after the same 24h hold the dispute
  -- sweep uses (a chargeback buffer, and the window in which an admin may
  -- still supersede this decision).
  UPDATE public.jobs
     SET status = 'completed'::public.job_status,
         payment_status = 'payout_pending',
         payout_scheduled_at = now() + interval '24 hours',
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;

  IF _job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, job_id)
    VALUES (
      _job.customer_id, 'info', 'Dispute decided',
      'A decision has been made on "' || COALESCE(_job.title, 'your job') || '": ' || _decision_text ||
        CASE WHEN _refund_cents > 0
             THEN ' The share of ' || cardinality(_refund)::text ||
                  CASE WHEN cardinality(_refund) = 1 THEN ' Helpr' ELSE ' Helprs' END ||
                  ' will be returned to you.'
             ELSE '' END ||
        ' The payment is still being processed; the job shows as settled once it has moved.',
      '/posts?job=' || _job_id::text, _job_id);
  END IF;
  FOR _m IN SELECT helper_id, member_outcome FROM public.crew_dispute_member_outcomes WHERE dispute_id = _dispute_id LOOP
    INSERT INTO public.notifications (user_id, type, title, message, link, job_id)
    VALUES (
      _m.helper_id, 'info', 'Dispute decided',
      'A decision has been made on "' || COALESCE(_job.title, 'a job you worked') || '": ' || _decision_text ||
        CASE WHEN _m.member_outcome = 'pay'
             THEN ' Your share will be paid out.'
             ELSE ' Your share goes back to the person who posted the job.' END ||
        ' The payment is still being processed; the job shows as settled once it has moved.',
      '/jobs?job=' || _job_id::text, _job_id);
  END LOOP;

  -- The decision is not wrapped: a crew money decision with no audit row is
  -- worse than a refused one.
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (_uid, 'decide_crew_dispute', _dispute_id, 'dispute',
    jsonb_build_object('job_id', _job_id, 'pay_cents', _pay_cents, 'refund_share_cents', _refund_cents,
                       'refund_helper_ids', to_jsonb(_refund), 'decision_preview', left(_decision_text, 200)));

  RETURN jsonb_build_object('pay_cents', _pay_cents, 'refund_share_cents', _refund_cents);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_decide_crew_dispute(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_crew_dispute(uuid, text, uuid[]) TO authenticated, service_role;
