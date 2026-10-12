-- Q1383: the REFUND-side twin of rpc_clear_test_mode_dispute_stamp (Q1280,
-- 20261005173719, which clears only the TRANSFER stamp).
--
-- The stuck state: a decided dispute whose split ran under the Stripe TEST key
-- and got its refund leg out carries a test-mode refund id in
-- disputes.execution_refund_id, and the split wrote that refund to
-- payment_refunds (source 'dispute_split', metadata.dispute_id = the dispute).
-- Every later run of the split is refused at its escrow check (the job's
-- PaymentIntent is itself a test-mode object), and
-- rpc_supersede_dispute_decision reads BOTH the stamp and any payment_refunds
-- row on the job as "money moved" and refuses. Nothing can close the dispute.
-- Unreachable today (0 disputes on prod, measured 2026-10-12), filed by the
-- lh-authz-rls review of Q1280.
--
-- Scope (lh-money-escrow review): the split pays its transfer leg (and writes
-- its payout_transfers row) BEFORE its refund leg, so a split that gave the
-- Helpr anything and got its refund out also has a 'paid' transfer row, which
-- the transfer path and supersede both refuse. This unsticks a refund-only
-- split (poster 100%), or one whose transfer ledger write failed.
--
-- The hand path: an admin who has checked the refund in Stripe (test mode)
-- names the exact refund id (compare-and-set) with a reason. The stamp is
-- cleared and the split's OWN ledger row for that refund is retired: its full
-- contents go into admin_audit_log first (and audit_money_table_change records
-- the delete as well). A test-mode refund moved no money, so that row was never
-- a true record of a refund; leaving it would also keep showing the poster a
-- refund that never happened.
--
-- Why this cannot pay twice if the admin is wrong:
--   * A Stripe refund always has the mode of the charge it refunds, so a
--     test-mode refund id means the job's escrow PaymentIntent is a test-mode
--     object, and execute-dispute-split refuses any new split on that job at
--     its escrow check ("this escrow was paid in Stripe test mode"), so the
--     new decision is never paid. (It cannot be closed either yet:
--     rpc_settle_dispute_without_payment refuses a job with a PaymentIntent
--     on file. That close-out path is its own queue item.)
--   * If the admin is WRONG and the refund was live (so the PaymentIntent is
--     live and the escrow check passes), the new decision's split still
--     refuses: under its claim it compares Stripe's amount_refunded with its
--     own refunds and lists the charge's refunds, and the cleared one carries
--     the SUPERSEDED dispute's metadata.dispute_id, so it is counted as a
--     foreign leg (execute-dispute-split, "Read every leg any path moved").
--   * Only the split's own row for THIS refund id is retired. Any other refund
--     row on the job (a Quick Refund, a cancellation refund, another dispute's
--     split) refuses the whole call: that is reconciled by hand, not cleared.
--   * Same gates as the transfer path: admin only, not a party, decided and
--     not executed (failed/executing only), escrow still held, no live or
--     money-stamped settlement claim.
--
-- Lock order mirrors rpc_supersede_dispute_decision (jobs, then disputes).

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
  _rid text := btrim(COALESCE(_refund_id, ''));
  _ledger jsonb;
  _deleted integer;
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
  IF length(_rid) = 0 THEN
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
  IF _d.execution_refund_id IS DISTINCT FROM _rid THEN
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
  -- Any refund row on this job that is not this split's own row for this
  -- refund id is a refund some other path recorded: reconciled by hand.
  IF EXISTS (
    SELECT 1 FROM public.payment_refunds r
     WHERE r.job_id = _d.job_id
       -- IS NOT TRUE, not NOT: a NULL source or dispute_id is not this row.
       AND (r.stripe_refund_id = _rid
            AND r.source = 'dispute_split'
            AND r.metadata->>'dispute_id' = _d.id::text) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'clear_stamp_other_refunds'
      USING HINT = 'This job has another refund on record; reconcile it by hand.';
  END IF;
  -- The refund id must belong to this job if it is on the ledger at all.
  IF EXISTS (
    SELECT 1 FROM public.payment_refunds r
     WHERE r.stripe_refund_id = _rid
       AND r.job_id IS DISTINCT FROM _d.job_id
  ) THEN
    RAISE EXCEPTION 'clear_stamp_other_refunds'
      USING HINT = 'That refund is recorded against another job; reconcile it by hand.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO _ledger
    FROM public.payment_refunds r
   WHERE r.job_id = _d.job_id AND r.stripe_refund_id = _rid;

  -- The trail first, not wrapped, with the full ledger row being retired.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _uid,
    'clear_test_mode_dispute_refund_stamp',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'cleared_refund_id', _d.execution_refund_id,
      'retired_ledger_rows', _ledger,
      'reason', btrim(_reason),
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'payment_status', _payment_status
    )
  );

  DELETE FROM public.payment_refunds r
   WHERE r.job_id = _d.job_id
     AND r.stripe_refund_id = _rid
     AND r.source = 'dispute_split'
     AND r.metadata->>'dispute_id' = _d.id::text;
  -- Every row the audit row says was retired really was (lh-money-escrow
  -- review): otherwise the trail and the ledger disagree, so refuse.
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  IF _deleted <> jsonb_array_length(_ledger) THEN
    RAISE EXCEPTION 'clear_stamp_ledger_mismatch'
      USING HINT = 'The refund ledger did not match what was read; nothing was changed. Re-read it.';
  END IF;

  UPDATE public.disputes
     SET execution_refund_id = NULL,
         execution_error = left('test-mode refund stamp ' || _d.execution_refund_id
                                || ' cleared by an admin: ' || btrim(_reason), 1000)
   WHERE id = _d.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) TO authenticated, service_role;
