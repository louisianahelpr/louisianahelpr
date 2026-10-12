-- Q1732 (OWNER DECISION 2026-10-12, pop-up): an ADMIN BUTTON to un-stick a
-- decided dispute whose Stripe TEST-mode refund or transfer is already
-- RECORDED in our books (payment_refunds / payout_transfers). Admin-only,
-- audited, idempotent; no hand SQL.
--
-- Why it was stuck: execute-dispute-split writes execution_refund_id only
-- after its payment_refunds upsert (and the transfer stamp after
-- payout_transfers), so the usual test-mode failure leaves a LEDGER row, which
-- rpc_supersede_dispute_decision reads as money moved. The two stamp clears
-- (Q1280 20261005173719, Q1383 20261012194318) refuse on a ledger row by
-- design: from SQL alone nobody can tell a test object from live money.
--
-- The button (src/components/admin/adminDisputes/DisputeCard.tsx) calls
-- execute-dispute-split with action 'clear_test_mode_records'. That edge
-- branch (supabase/functions/execute-dispute-split/clearTestModeRecords.ts)
-- asks STRIPE about every refund and transfer id the job's books and the
-- dispute's stamps hold; only when Stripe answers "a similar object exists in
-- test mode" for EVERY one does it call this function with exactly those ids,
-- then supersedes the decision as the admin (rpc_supersede_dispute_decision,
-- auth.uid() = the admin) so it can be decided again.
--
-- public.clear_test_mode_dispute_ledger(admin, dispute, refund_ids,
-- transfer_ids, reason): service_role ONLY (the Stripe check lives in the edge
-- function; an admin calling this directly could skip it). Gates, under the
-- jobs-then-disputes lock order supersede uses:
--   - the named admin has the admin role and is not a party to the job;
--   - a reason of 10+ characters (it goes in the audit log);
--   - a dispute already SUPERSEDED answers already_superseded (idempotent:
--     the button pressed twice does nothing twice);
--   - only a decided dispute whose split failed or died executing, escrow
--     still held, no live or stamped settlement claim (the stamp clears'
--     gates);
--   - COMPARE-AND-SET on the whole set: the refund ids and transfer ids the
--     edge function checked must equal, exactly, every payment_refunds id on
--     the job plus execution_refund_id, and every pending/paid/reversed
--     payout_transfers id on the job plus execution_transfer_id. Anything
--     added since the check refuses (clear_ledger_changed); a money-moving
--     transfer row with no Stripe id cannot be checked and refuses
--     (clear_ledger_unverifiable); a restored gift card (supersede reads it
--     as money moved too) refuses (clear_ledger_gift_restored);
--   - nothing left to clear answers nothing_to_clear and writes nothing.
-- Then the audit row FIRST (every removed ledger row in full, as jsonb), the
-- ledger rows removed (trg_audit_payment_refunds / trg_audit_payout_transfers
-- log each DELETE too), both stamps cleared.
--
-- Replay-safe: CREATE OR REPLACE only. REVOKE FROM PUBLIC, anon,
-- authenticated; EXECUTE for service_role.
-- Proof: src/test/pglite/testModeDisputeLedgerClears.pglite.mjs.
-- Guard: src/test/testModeDisputeStampHasAWayOut.test.ts (Q1732 block) and
-- src/test/edge/clearTestModeDisputeRecords.test.ts.

CREATE OR REPLACE FUNCTION public.clear_test_mode_dispute_ledger(
  _admin uuid,
  _dispute_id uuid,
  _refund_ids text[],
  _transfer_ids text[],
  _reason text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job_id_lookup uuid;
  _payment_status text;
  _customer uuid;
  _helper uuid;
  _d record;
  _refunds_now text[];
  _transfers_now text[];
  _refunds_checked text[];
  _transfers_checked text[];
  _removed_refunds jsonb;
  _removed_transfers jsonb;
  _n_refunds int := 0;
  _n_transfers int := 0;
BEGIN
  IF _admin IS NULL OR NOT public.has_role(_admin, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'clear_ledger_needs_reason'
      USING HINT = 'Say why these records are Stripe test-mode objects; it goes in the audit log.';
  END IF;

  -- Lock order jobs -> disputes, as rpc_supersede_dispute_decision.
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

  IF _admin = _customer OR _admin = _helper THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to do this.';
  END IF;

  -- Idempotent: the button already went all the way through.
  IF _d.status = 'superseded' THEN
    RETURN jsonb_build_object('action', 'already_superseded');
  END IF;

  IF _d.status IS DISTINCT FROM 'decided'
     OR _d.execution_status IS NULL
     OR _d.execution_status NOT IN ('failed', 'executing') THEN
    RAISE EXCEPTION 'clear_ledger_not_decided'
      USING HINT = 'Only a decided dispute whose split has not executed can be un-stuck.';
  END IF;
  IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'clear_ledger_escrow_not_held';
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
  IF to_regclass('public.gift_cards') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _d.job_id) THEN
    RAISE EXCEPTION 'clear_ledger_gift_restored'
      USING HINT = 'A gift card was restored from this job; reconcile it by hand.';
  END IF;
  -- A money-moving transfer row with no Stripe id cannot be checked at Stripe.
  IF EXISTS (SELECT 1 FROM public.payout_transfers t
              WHERE t.job_id = _d.job_id
                AND t.status IN ('pending', 'paid', 'reversed')
                AND t.stripe_transfer_id IS NULL) THEN
    RAISE EXCEPTION 'clear_ledger_unverifiable'
      USING HINT = 'A transfer row has no Stripe id, so it cannot be checked; reconcile it by hand.';
  END IF;

  -- What the books hold NOW: exactly what supersede reads as money moved.
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::text[]) INTO _refunds_now
    FROM (SELECT r.stripe_refund_id AS x FROM public.payment_refunds r WHERE r.job_id = _d.job_id
          UNION ALL
          SELECT _d.execution_refund_id WHERE _d.execution_refund_id IS NOT NULL) s;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::text[]) INTO _transfers_now
    FROM (SELECT t.stripe_transfer_id AS x FROM public.payout_transfers t
           WHERE t.job_id = _d.job_id AND t.status IN ('pending', 'paid', 'reversed')
          UNION ALL
          SELECT _d.execution_transfer_id WHERE _d.execution_transfer_id IS NOT NULL) s;
  -- What the edge function checked at Stripe.
  SELECT COALESCE(array_agg(DISTINCT btrim(x) ORDER BY btrim(x)), '{}'::text[]) INTO _refunds_checked
    FROM unnest(COALESCE(_refund_ids, '{}'::text[])) AS x;
  SELECT COALESCE(array_agg(DISTINCT btrim(x) ORDER BY btrim(x)), '{}'::text[]) INTO _transfers_checked
    FROM unnest(COALESCE(_transfer_ids, '{}'::text[])) AS x;

  -- Compare-and-set on the WHOLE set.
  IF _refunds_now IS DISTINCT FROM _refunds_checked
     OR _transfers_now IS DISTINCT FROM _transfers_checked THEN
    RAISE EXCEPTION 'clear_ledger_changed'
      USING HINT = 'The records on this job changed since they were checked at Stripe; press the button again.';
  END IF;

  IF cardinality(_refunds_now) = 0 AND cardinality(_transfers_now) = 0 THEN
    RETURN jsonb_build_object('action', 'nothing_to_clear');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO _removed_refunds
    FROM public.payment_refunds r WHERE r.job_id = _d.job_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO _removed_transfers
    FROM public.payout_transfers t
   WHERE t.job_id = _d.job_id AND t.status IN ('pending', 'paid', 'reversed');

  -- The trail first, not wrapped.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _admin,
    'clear_test_mode_dispute_ledger',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'reason', btrim(_reason),
      'checked_at_stripe_as_test_mode', jsonb_build_object('refunds', to_jsonb(_refunds_now), 'transfers', to_jsonb(_transfers_now)),
      'removed_payment_refunds', _removed_refunds,
      'removed_payout_transfers', _removed_transfers,
      'cleared_refund_stamp', _d.execution_refund_id,
      'cleared_transfer_stamp', _d.execution_transfer_id,
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'payment_status', _payment_status
    )
  );

  DELETE FROM public.payment_refunds r
   WHERE r.job_id = _d.job_id AND r.stripe_refund_id = ANY (_refunds_now);
  GET DIAGNOSTICS _n_refunds = ROW_COUNT;
  DELETE FROM public.payout_transfers t
   WHERE t.job_id = _d.job_id
     AND t.status IN ('pending', 'paid', 'reversed')
     AND t.stripe_transfer_id = ANY (_transfers_now);
  GET DIAGNOSTICS _n_transfers = ROW_COUNT;

  UPDATE public.disputes
     SET execution_refund_id = NULL,
         execution_transfer_id = NULL,
         execution_error = left('test-mode records cleared by an admin (checked at Stripe): ' || btrim(_reason), 1000)
   WHERE id = _d.id;

  RETURN jsonb_build_object(
    'action', 'cleared',
    'refunds_removed', _n_refunds,
    'transfers_removed', _n_transfers,
    'refund_ids', to_jsonb(_refunds_now),
    'transfer_ids', to_jsonb(_transfers_now)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_test_mode_dispute_ledger(uuid, uuid, text[], text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_test_mode_dispute_ledger(uuid, uuid, text[], text[], text) TO service_role;
