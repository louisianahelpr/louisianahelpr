-- Q1383 (lh-authz-rls review of Q1280, 2026-10-05): a decided dispute stuck on
-- a Stripe TEST-mode REFUND stamp still could not be superseded.
-- rpc_clear_test_mode_dispute_stamp (Q1280, 20261005173719) clears only
-- disputes.execution_transfer_id, while rpc_supersede_dispute_decision also
-- reads execution_refund_id as money moved, and execute-dispute-split's
-- markFailed stamps both legs together. A test-mode run that got its refund
-- leg stamped stayed stuck. Unreachable today (0 disputes on prod carry
-- either stamp, measured by the review); this is the hand path for when it is
-- not.
--
-- rpc_clear_test_mode_dispute_refund_stamp(dispute, refund_id, reason) is the
-- refund-side twin of the transfer clear, with the same gates in the same
-- order: admin only, not a party, a reason of 10+ characters, only a decided
-- dispute whose split failed or died executing, compare-and-set on the exact
-- refund id the admin checked, escrow still held, no live or stamped
-- settlement claim, and REFUSED while payment_refunds holds ANY row for the
-- job (supersede refuses on any such row too, so clearing would unblock
-- nothing; a ledger leg is reconciled by hand, never cleared from here). The
-- audit row is written before the stamp is cleared.
--
-- REACH (lh-money-escrow review of 7ca6b15fa, finding 2): the edge function
-- writes execution_refund_id only after its payment_refunds upsert, so this
-- unblocks only a run whose refund ledger write ALSO failed. A test-mode
-- refund the ledger recorded still needs hand SQL (docs/OPEN.md, filed with
-- this item's follow-up).
--
-- Why this cannot refund twice if the admin is wrong and the id was LIVE
-- money (same review, finding 1, which also corrects 20261005173719's
-- comment): after supersede the new decision is a NEW dispute row, so its
-- split is a first attempt, not a resume. A live refund left behind by the
-- old id carries a different metadata.dispute_id, and execute-dispute-split's
-- step 6c foreign-money check (amount_refunded above this dispute's own
-- refunds, attributed with refunds.list) refuses and pages critical;
-- admin_release_dispute refuses any amount_refunded > 0. A retry WITHOUT
-- supersede is a resume and recovers the refund by metadata.
--
-- Lock order mirrors rpc_supersede_dispute_decision (jobs, then disputes).
-- Replay-safe: CREATE OR REPLACE; REVOKE FROM PUBLIC, anon; EXECUTE for
-- authenticated (the body checks has_role admin) and service_role.
-- Proof: src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs.
-- Guard: src/test/testModeDisputeStampHasAWayOut.test.ts.

CREATE OR REPLACE FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(
  _dispute_id uuid,
  _refund_id text,
  _reason text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id_lookup uuid;
  _payment_status text;
  _customer uuid;
  _helper uuid;
  _d record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'clear_stamp_needs_reason'
      USING HINT = 'Say how you checked that this refund is a Stripe test-mode object; it goes in the audit log.';
  END IF;
  IF length(btrim(COALESCE(_refund_id, ''))) = 0 THEN
    RAISE EXCEPTION 'clear_stamp_needs_refund_id';
  END IF;

  SELECT job_id INTO _job_id_lookup FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT payment_status, customer_id, helper_id
    INTO _payment_status, _customer, _helper
    FROM public.jobs
   WHERE id = _job_id_lookup
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, job_id, status, execution_status, execution_started_at, execution_error,
         execution_transfer_id, execution_refund_id
    INTO _d
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  -- Only a run that started (failed or died executing) can carry a stamp.
  IF _d.status IS DISTINCT FROM 'decided'
     OR _d.execution_status IS NULL
     OR _d.execution_status NOT IN ('failed', 'executing') THEN
    RAISE EXCEPTION 'clear_stamp_not_decided'
      USING HINT = 'Only a decided dispute whose split has not executed carries a stamp to clear.';
  END IF;
  IF _uid = _customer OR _uid = _helper THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to do this.';
  END IF;
  -- Compare-and-set: the admin names the exact stamp they checked.
  IF _d.execution_refund_id IS DISTINCT FROM btrim(_refund_id) THEN
    RAISE EXCEPTION 'clear_stamp_mismatch'
      USING HINT = 'The dispute does not carry that refund id (it may have changed); re-read it.';
  END IF;
  IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'clear_stamp_escrow_not_held';
  END IF;
  IF _d.execution_status = 'executing'
     AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _d.job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;
  -- A ledger row is a refund the platform recorded as moved: that is
  -- reconciled by hand against Stripe, never cleared from here. ANY row on the
  -- job, not only this id: supersede refuses on any of them, so clearing the
  -- stamp would unblock nothing (review of 7ca6b15fa, note B).
  IF EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _d.job_id) THEN
    RAISE EXCEPTION 'clear_stamp_ledger_has_refund'
      USING HINT = 'payment_refunds records this refund; reconcile it by hand.';
  END IF;

  -- The trail first, not wrapped.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _uid,
    'clear_test_mode_dispute_refund_stamp',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'cleared_refund_id', _d.execution_refund_id,
      'reason', btrim(_reason),
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'payment_status', _payment_status
    )
  );

  UPDATE public.disputes
     SET execution_refund_id = NULL,
         execution_error = left('test-mode refund stamp ' || _d.execution_refund_id
                                || ' cleared by an admin: ' || btrim(_reason), 1000)
   WHERE id = _d.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) TO authenticated, service_role;
