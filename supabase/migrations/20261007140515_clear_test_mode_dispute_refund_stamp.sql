-- Q1383 (lh-authz-rls review of Q1280, 2026-10-05): a decided dispute whose
-- split ran under the Stripe TEST key and got its REFUND leg out could never
-- be superseded. rpc_clear_test_mode_dispute_stamp (20261005173719) clears
-- only disputes.execution_transfer_id, but rpc_supersede_dispute_decision also
-- reads execution_refund_id and ANY payment_refunds row on the job as "money
-- moved", and execute-dispute-split stamps and ledgers its refund leg
-- (payment_refunds, source 'dispute_split', metadata.dispute_id) together with
-- the transfer leg. Unreachable on prod today (0 disputes, 0 stamps, measured
-- by that review); this is the hand path for when it is not.
--
-- rpc_clear_test_mode_dispute_refund_stamp: an admin who has checked the
-- refund in Stripe (test mode) clears it, naming the exact refund id
-- (compare-and-set), with a reason that goes in admin_audit_log. It removes
-- the stamp AND that refund's own split ledger row(s), copying them whole into
-- the audit row first (the payment_refunds audit trigger records the delete
-- too). It refuses when the job carries any OTHER refund row (another
-- refund, another dispute's split, a refund with no dispute in its metadata):
-- those are reconciled by hand, never cleared from here.
--
-- SCOPE: poster-takes-all splits only. A split that gave the Helpr a share
-- ran its transfer leg first, so it also carries a transfer stamp and a paid
-- payout_transfers row; supersede refuses that regardless, so this RPC refuses
-- it too (clear_stamp_transfer_leg_remains) rather than delete a row for
-- nothing. That both-legs test-mode case is its own follow-up.
--
-- ACCEPTED RISK (as for the transfer clearer, but stronger): this DELETES a
-- ledger row. A wrong clear of a LIVE refund loses that row; both this RPC's
-- audit row (deleted_ledger_rows) and trg_audit_payment_refunds keep a copy,
-- and money-reconciliation would flag Stripe refunding more than the ledger
-- once the job settles.
--
-- If the admin is wrong and the refund was LIVE money: execute-dispute-split's
-- resume asks Stripe's refund list for this dispute (metadata.dispute_id)
-- before refunding and heals the ledger, so the SAME decision never refunds
-- twice; and, as for the transfer clearer, the admin's Stripe check is the
-- control before supersede. Same gates and lock order as the transfer clearer
-- (jobs, then disputes; admin only; not a party; decided with a failed or
-- stale executing run; escrow still held; no settlement claim in progress).
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a new function; grants by role name.

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
  _rows jsonb;
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
  -- Only THIS dispute's own split refund, under the named id, may go. Any
  -- other refund row on the job is money the platform recorded as moved for
  -- some other reason: reconcile it by hand.
  IF EXISTS (
    SELECT 1 FROM public.payment_refunds r
     WHERE r.job_id = _d.job_id
       AND (r.stripe_refund_id IS DISTINCT FROM _d.execution_refund_id
            OR r.source IS DISTINCT FROM 'dispute_split'
            OR (r.metadata ->> 'dispute_id') IS DISTINCT FROM _d.id::text)
  ) THEN
    RAISE EXCEPTION 'clear_stamp_other_refunds'
      USING HINT = 'payment_refunds records another refund on this job; reconcile it by hand.';
  END IF;

  -- lh-money-escrow review of this RPC (must-fix): clear only when it actually
  -- frees the decision. A split that gave the Helpr a share ran its transfer
  -- leg FIRST (a transfer stamp and a paid payout_transfers row, which the
  -- transfer clearer refuses by design), and a gift restore is money moved
  -- too: supersede would still refuse, so deleting the refund row here would
  -- lose a ledger row for nothing.
  IF _d.execution_transfer_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.payout_transfers t
                 WHERE t.job_id = _d.job_id AND t.status IN ('pending', 'paid', 'reversed'))
     OR (to_regclass('public.gift_cards') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _d.job_id)) THEN
    RAISE EXCEPTION 'clear_stamp_transfer_leg_remains'
      USING HINT = 'Money also moved on the transfer side (or a gift was restored); supersede would still refuse. Reconcile it by hand.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO _rows
    FROM public.payment_refunds r
   WHERE r.job_id = _d.job_id AND r.stripe_refund_id = _d.execution_refund_id;

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
      'deleted_ledger_rows', _rows,
      'reason', btrim(_reason),
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'payment_status', _payment_status
    )
  );

  DELETE FROM public.payment_refunds r
   WHERE r.job_id = _d.job_id AND r.stripe_refund_id = _d.execution_refund_id;

  UPDATE public.disputes
     SET execution_refund_id = NULL,
         execution_error = left('test-mode refund stamp ' || _d.execution_refund_id
                                || ' cleared by an admin: ' || btrim(_reason), 1000)
   WHERE id = _d.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) TO authenticated, service_role;
