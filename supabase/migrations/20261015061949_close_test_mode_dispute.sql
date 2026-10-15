-- Q1769 (owner decision 2026-10-15): a decided dispute on a Stripe TEST-mode
-- payment between TEST ACCOUNTS is closed as "test, no money moved".
--
-- Before this, a decided dispute on such a job could only be SPLIT:
-- rpc_settle_dispute_without_payment closes only a job with NO payment on
-- file. Since Stripe test mode for test accounts (_shared/stripeMode.ts,
-- jobMoneyMode), execute-dispute-split runs a cs_test_ job whose every party
-- is a test account on the TEST key, so Retry settlement can settle it in
-- test mode; this close is the owner's other way out: record it as a test and
-- move nothing, not even test money. (A cs_test_ job with a REAL party still
-- runs on the live key and is refused there; it is refused here too.)
-- Measured on prod 2026-10-15 06:20Z: 79 jobs carry a cs_test_ session, 6 of
-- them in escrow; one dispute (open, not decided) sits on such a job, both of
-- its parties test accounts; 0 decided disputes are unsettled.
--
-- rpc_close_test_mode_dispute is the sibling of
-- rpc_settle_dispute_without_payment (20260924013122) for that case.
-- It closes the decided dispute with both amounts $0 and says why, and NOTHING
-- else: real disputes are untouched. Every condition is re-checked here under
-- the job and dispute row locks, in the order every dispute RPC takes them
-- (jobs, then disputes):
--   - admin only, and not a party to the job (poster, Helpr or crew member);
--   - the dispute is decided and not settled, no live split run or claim, and
--     not a crew fan-out ('crew_fanout' is settled only by the payout run,
--     trg_crew_fanout_dispute_lock);
--   - TEST-MODE MONEY: jobs.stripe_session_id starts with cs_test_, the prefix
--     Stripe gives a test-mode Checkout Session;
--   - TEST ACCOUNTS ONLY: the poster exists, and the poster, the Helpr and
--     every crew member are test accounts (a public.test_accounts row AND
--     profiles.is_seed, the definition _shared/stripeMode.ts uses). A real
--     person on the job refuses, so a sandbox payment between real people
--     (before prod went live on 2026-09-27) stays for hand review;
--   - NO LIVE GIFT MONEY: gift cards run on the LIVE key (Q1750), so a gift
--     redeemed, reserved or restored on this job refuses;
--   - NOTHING ALREADY MOVED: no payout_transfers or payment_refunds row, no
--     transfer or refund id on the dispute, no paid crew block fee. Test-mode
--     records are cleared first by Clear test-mode records (Q1732), which
--     checks each one at Stripe;
--   - payment_status is one that holds money or never did (NULL, unpaid,
--     abandoned, failed, cancelled, escrow, payout_pending). released,
--     refunded, chargeback and cancelling say a settlement already ran or is
--     running.
--
-- "No money moved" holds after the close, not only at it: marking the dispute
-- executed lifts checkUnsettledDispute, and the ordinary settle paths would
-- then move a completed+escrow or cancelled+escrow job's (test) money. So the
-- job's payment_status goes to 'cancelled' in the same transaction, the state
-- every reader already treats as settled with no money (auto-release-payment
-- and void-cancelled-payments select 'escrow', process-scheduled-payouts
-- 'payout_pending'; create-payment and redeem_gift_card refuse to fund it),
-- and every crew block fee still owed on the job is voided, because
-- void-cancelled-payments Part F pays owed fees on a 'cancelled' job.
--
-- Replay-safe: CREATE OR REPLACE; the tables read only on some deploys are
-- guarded with to_regclass at call time, and a missing test_accounts table
-- refuses (no test account can be proven).

CREATE OR REPLACE FUNCTION public.rpc_close_test_mode_dispute(_dispute_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _note_clean text := left(NULLIF(btrim(COALESCE(_note, '')), ''), 500);
  _job_id uuid;
  _job record;
  _dispute record;
  _job_found boolean;
  _written int;
  _moved boolean;
  _parties uuid[];
  _real int;
  _voided int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _note_clean IS NULL THEN
    RAISE EXCEPTION 'settle_note_required'
      USING HINT = 'Say how you know this was a test. It is the only record of this close.';
  END IF;

  SELECT job_id INTO _job_id FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT id, customer_id, helper_id, stripe_session_id, payment_status
    INTO _job
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;
  _job_found := FOUND;
  IF NOT _job_found THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, status, execution_status, execution_started_at, execution_transfer_id, execution_refund_id
    INTO _dispute
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _dispute.status IS DISTINCT FROM 'decided' THEN
    RAISE EXCEPTION 'dispute_not_decided'
      USING HINT = 'Only a decided dispute can have its settlement closed.';
  END IF;

  IF _dispute.execution_status = 'executed' THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  IF _dispute.execution_status = 'crew_fanout' THEN
    RAISE EXCEPTION 'dispute_crew_fanout'
      USING HINT = 'A crew decision is settled by the payout run, not closed here.';
  END IF;

  -- Every party: the poster, the Helpr, every crew member.
  _parties := array_remove(ARRAY[_job.customer_id, _job.helper_id], NULL);
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    _parties := _parties || COALESCE(
      (SELECT array_agg(g.helper_id) FROM public.group_job_helpers g
        WHERE g.job_id = _job.id AND g.helper_id IS NOT NULL),
      ARRAY[]::uuid[]);
  END IF;

  IF _uid = ANY (_parties) THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to close its settlement.';
  END IF;

  -- A live split run (inside the TTL) or a live settlement claim: wait for it.
  IF (_dispute.execution_status = 'executing'
      AND COALESCE(_dispute.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl())
     OR (to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.dispute_settlement_claims c
           WHERE c.job_id = _job.id
             AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
                  OR c.money_step_at IS NOT NULL)))
  THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;

  -- Test-mode money: Stripe names a test-mode Checkout Session cs_test_...
  IF _job.stripe_session_id IS NULL OR left(_job.stripe_session_id, 8) <> 'cs_test_' THEN
    RAISE EXCEPTION 'dispute_not_test_mode'
      USING HINT = 'This job was not paid in Stripe test mode, so it is a real dispute. Use Retry settlement.';
  END IF;

  -- Test accounts only. No poster, or any party who is not a test account,
  -- refuses; so does a deploy without the enrolment table.
  IF _job.customer_id IS NULL OR to_regclass('public.test_accounts') IS NULL THEN
    RAISE EXCEPTION 'dispute_not_test_accounts'
      USING HINT = 'Only a job between test accounts can be closed as a test.';
  END IF;
  SELECT count(*) INTO _real
    FROM unnest(_parties) AS p(user_id)
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.test_accounts t
             JOIN public.profiles pr ON pr.user_id = t.user_id
            WHERE t.user_id = p.user_id
              AND pr.is_seed IS TRUE);
  IF _real > 0 THEN
    RAISE EXCEPTION 'dispute_not_test_accounts'
      USING HINT = 'A real account is on this job, so it is a real dispute. Only a job between test accounts can be closed as a test.';
  END IF;

  -- Gift cards run on the live key: a gift on this job is real money.
  IF to_regclass('public.gift_cards') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.gift_cards g
        WHERE (g.job_id = _job.id AND g.status IN ('redeemed', 'reserved'))
           OR g.restored_from_job_id = _job.id)
  THEN
    RAISE EXCEPTION 'dispute_has_live_gift'
      USING HINT = 'A gift card paid toward this job, and gift cards are real money. Settle it with Retry settlement.';
  END IF;

  -- released, refunded, chargeback and cancelling: a settlement already ran
  -- or is running.
  IF _job.payment_status IS NOT NULL
     AND _job.payment_status NOT IN ('unpaid', 'abandoned', 'failed', 'cancelled', 'escrow', 'payout_pending')
  THEN
    RAISE EXCEPTION 'dispute_payment_settled'
      USING HINT = 'This job''s payment record says it was already settled, so there is nothing to close.';
  END IF;

  _moved := _dispute.execution_transfer_id IS NOT NULL
         OR _dispute.execution_refund_id IS NOT NULL
         OR (to_regclass('public.payout_transfers') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = _job.id))
         OR (to_regclass('public.payment_refunds') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job.id));
  IF NOT _moved AND to_regclass('public.crew_block_fees') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.crew_block_fees f WHERE f.job_id = _job.id AND f.status = 'paid');
  END IF;
  IF _moved THEN
    RAISE EXCEPTION 'dispute_money_moved'
      USING HINT = 'Test-mode refund or transfer records exist for this job. Press Clear test-mode records and re-open first.';
  END IF;

  UPDATE public.disputes
     SET execution_status       = 'executed',
         executed_at            = now(),
         execution_transfer_id  = NULL,
         execution_refund_id    = NULL,
         execution_helper_cents = 0,
         execution_refund_cents = 0,
         execution_error        = 'closed by an admin, Stripe test mode between test accounts, no real money moved: ' || _note_clean
   WHERE id = _dispute_id
     AND status = 'decided'
     AND execution_status IS DISTINCT FROM 'executed'
     AND execution_status IS DISTINCT FROM 'crew_fanout';
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> 1 THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  -- Nothing may move this job's (test) money after the close.
  IF _job.payment_status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.jobs
       SET payment_status = 'cancelled'
     WHERE id = _job.id
       AND payment_status IS NOT DISTINCT FROM _job.payment_status;
    GET DIAGNOSTICS _written = ROW_COUNT;
    IF _written <> 1 THEN
      RAISE EXCEPTION 'dispute_payment_settled';
    END IF;
  END IF;

  IF to_regclass('public.crew_block_fees') IS NOT NULL THEN
    UPDATE public.crew_block_fees
       SET status = 'void',
           failure_reason = 'test-mode dispute closed by an admin, no real money moved'
     WHERE job_id = _job.id
       AND status IN ('owed', 'failed');
    GET DIAGNOSTICS _voided = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    _uid,
    'close_test_mode_dispute',
    _dispute_id,
    'dispute',
    jsonb_build_object(
      'job_id', _job.id,
      'stripe_session_id', _job.stripe_session_id,
      'previous_execution_status', _dispute.execution_status,
      'payment_status', _job.payment_status,
      'new_payment_status', 'cancelled',
      'crew_block_fees_voided', _voided,
      'parties', to_jsonb(_parties),
      'note', _note_clean
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_close_test_mode_dispute(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_close_test_mode_dispute(uuid, text) TO authenticated;
