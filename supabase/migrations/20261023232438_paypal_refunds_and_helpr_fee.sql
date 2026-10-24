-- PayPal Plan A, phase 5: refunds; and the owner's fee ruling of 2026-10-23.
-- Design: ~/.lh-wt/paypal-design.md §5-§6 (row 5). Builds on 20261023223419 (phase 1).
--
-- 1. THE FEE (owner ruling 2026-10-23): ONE fee, 8% + $0.70, taken from the Helpr's pay; the
--    poster pays the job price only. NEW jobs on the PayPal path only, so only while
--    paypal_payments is on for the poster. Stamped AT POST: enforce_jobs_fee_model_lock's INSERT
--    branch, after clearing what a member sent, stamps helper_fee_percent = 8 and
--    helper_fee_flat_cents = 70 (_shared/helprFlatFee.ts PAYPAL_HELPR_FEE_*). Every payout path
--    already prices a stamped job by its stamp (helprFlatFeeCents / SQL helpr_flat_fee_cents), so
--    an 8/70 job is paid out at 8% + 70c and every job stamped before keeps its own 5% + 70c.
--    Switch off (prod today for every member): the INSERT branch is byte for byte the live body
--    (pg_get_functiondef on prod 2026-10-23 ~23:20Z, md5(prosrc) 50661b03d0c33cd6c97fe69a900b8aa5,
--    = 20261017230824's text) plus the one IF, which is false.
--
-- 2. REFUNDS, server only (service_role; members never call these). The edge side
--    (_shared/payments/providerRefunds.ts) claims a provider_refunds row FIRST, then asks PayPal
--    with PayPal-Request-Id = the row's idempotency key, then records PayPal's answer:
--      paypal_refund_claim     insert-or-replay the claim row; phase 1's provider_refunds_guard
--                              refuses it once a payout of the payment is queued, held or sent,
--                              and never lets refunds exceed the payment.
--      paypal_refund_record    PayPal's answer onto the row (id, status), then the payment's status.
--      paypal_refund_reconcile PAYMENT.CAPTURE.REFUNDED (re-read from PayPal by the webhook): finds
--                              our row, or attaches a claim whose answer was lost, or records a
--                              refund made outside the app; one made outside while a payout is
--                              queued cannot be recorded (the guard), so the queued payouts are
--                              put on hold and the caller pages ops.
--      paypal_job_mark_refunded  a refund door settles its job, under phase 3's money flag.
--      paypal_poster_cancel_job  a poster cancels a PayPal-paid job: cancel ONLY; phase 6's
--                              cancellation sweep refunds it through the engine (lead 2026-10-23).
--    Not behind require_feature: require_feature reads auth.uid(), which a service call does not
--    have, and refunds only follow a payment that already exists (phase 1: turning the switch off
--    must never strand money already taken). The admin door (paypal-refunds admin_refund) checks
--    the switch for the admin with requireFeature.
--
-- 2b. ORPHAN CAPTURES (contract from phase 3, lead 2026-10-23): a capture that cannot fund its job
--    (a second tab's second capture, a price that changed, a job closed or gone) is a provider_payments
--    row 'voided' with its capture id and status_reason 'orphan:<why>'. The money is not ours: it is
--    refunded IN FULL, automatically (paypal-refunds), card fee included (owner 2026-10-14: a refund
--    caused by our own mistake goes back in full). provider_refunds_guard is restated with that one
--    carve-out (full refund only, no payout can exist), and a fully refunded orphan reads 'refunded',
--    which clears phase 3's orphan alert. status_reason is phase 3's column, read through to_jsonb so
--    this migration does not depend on the order the two land in.
--
-- 3. The cron: paypal-refunds every 10 minutes (orphan captures refunded in full; a claim whose
--    PayPal answer was lost asked again; one pending at PayPal re-read). It acts only on rows that exist, i.e. testers' while the switch is
--    testers-only.
--
-- REPLAY-SAFETY: CREATE OR REPLACE / DROP TRIGGER IF EXISTS / ON CONFLICT; every block is guarded
-- on the objects it reads (to_regclass / to_regprocedure).

-- ── 1. The fee stamp at post ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_jobs_fee_model_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.helper_fee_flat_cents := NULL;
    NEW.poster_fee_flat_cents := NULL;
    -- PayPal path (owner ruling 2026-10-23): 8% + 70c from the Helpr, stamped at post, only
    -- while paypal_payments is on for the poster. The poster-fee stamp stays NULL (the poster
    -- pays the price only), which jobs_poster_fee_model_consistent accepts with a 70c stamp.
    IF public.feature_enabled_for_user('paypal_payments', NEW.customer_id) THEN
      NEW.helper_fee_flat_cents := 70;
      NEW.helper_fee_percent := 8;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.helper_fee_flat_cents IS DISTINCT FROM OLD.helper_fee_flat_cents THEN
    RAISE EXCEPTION 'Only the server may set jobs.helper_fee_flat_cents'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.poster_fee_flat_cents IS DISTINCT FROM OLD.poster_fee_flat_cents THEN
    RAISE EXCEPTION 'Only the server may set jobs.poster_fee_flat_cents'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_jobs_fee_model_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS jobs_fee_model_lock ON public.jobs;
CREATE TRIGGER jobs_fee_model_lock
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_fee_model_lock();

-- ── 2. Refunds ──────────────────────────────────────────────────────────────

-- The payment's status from its live refunds (pending counts: that money is spoken for).
-- Internal: called by the two functions below, never granted.
CREATE OR REPLACE FUNCTION public.paypal_payment_sync_refund_status(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pay public.provider_payments%ROWTYPE;
  v_live bigint;
  v_new text;
BEGIN
  SELECT * INTO v_pay FROM public.provider_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_payment_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(r.amount_cents), 0) INTO v_live
    FROM public.provider_refunds r
   WHERE r.provider_payment_id = p_payment_id
     AND r.status IN ('pending', 'completed');
  v_new := v_pay.status;
  -- An orphan capture (phase 3: voided with its capture, status_reason 'orphan:%') refunded in full
  -- reads 'refunded', which clears its alert; until then it stays voided (never funded).
  IF v_pay.status = 'voided' AND v_pay.provider_capture_id IS NOT NULL
     AND COALESCE(to_jsonb(v_pay) ->> 'status_reason', '') LIKE 'orphan:%'
     AND v_live >= v_pay.amount_cents THEN
    UPDATE public.provider_payments SET status = 'refunded', updated_at = now() WHERE id = p_payment_id;
    v_new := 'refunded';
  END IF;
  -- Only money states that refunds move between; a disputed/reversed payment keeps its status
  -- (phase 7 owns those).
  IF v_pay.status IN ('captured', 'partially_refunded', 'refunded') THEN
    v_new := CASE WHEN v_live >= v_pay.amount_cents THEN 'refunded'
                  WHEN v_live > 0 THEN 'partially_refunded'
                  ELSE 'captured' END;
    IF v_new IS DISTINCT FROM v_pay.status THEN
      UPDATE public.provider_payments SET status = v_new, updated_at = now() WHERE id = p_payment_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('payment_status', v_new, 'refunded_cents', v_live, 'amount_cents', v_pay.amount_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_payment_sync_refund_status(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- An earlier WIP of this file had a 4-argument claim; never two overloads.
DROP FUNCTION IF EXISTS public.paypal_refund_claim(uuid, text, bigint, text);
CREATE OR REPLACE FUNCTION public.paypal_refund_claim(
  p_payment_id uuid,
  p_idempotency_key text,
  p_amount_cents bigint,
  p_reason text,
  -- The provider's environment: a payment of the other one is refused BEFORE a row is written.
  p_env text DEFAULT NULL,
  -- The most all live refunds of this payment may total (what was paid less what is kept: PayPal's
  -- fee, the setup fee, the tax on them), checked under the payment lock so two refunds racing on
  -- different keys cannot both fit (lh-money-escrow review 2026-10-23, #6). NULL = the payment.
  p_max_total_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pay public.provider_payments%ROWTYPE;
  v_ref public.provider_refunds%ROWTYPE;
  v_replay boolean := false;
BEGIN
  -- Deterministic, ours, and short enough for PayPal-Request-Id (108 characters at most).
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) > 108
     OR p_idempotency_key !~ '^lh:[a-z_]+:[0-9a-f-]{36}:refund(:[a-z0-9_-]+)*$' THEN
    RAISE EXCEPTION 'refund_key_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pay FROM public.provider_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_payment_not_found' USING ERRCODE = '22023';
  END IF;
  IF p_env IS NOT NULL AND v_pay.env IS DISTINCT FROM p_env THEN
    RAISE EXCEPTION 'refund_env_mismatch' USING ERRCODE = '23514',
      DETAIL = format('payment %s is %s, the refund was asked on %s', p_payment_id, v_pay.env, p_env);
  END IF;
  -- A replay first: an existing claim is answered as it stands, even after a payout was queued
  -- since (the guard decides only a NEW refund), so a retry can always finish the refund it began.
  SELECT * INTO v_ref FROM public.provider_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_replay := true;
  ELSE
    IF p_max_total_cents IS NOT NULL THEN
      -- Payment lock first (the order every money write here uses), then the live total.
      PERFORM 1 FROM public.provider_payments WHERE id = p_payment_id FOR UPDATE;
      IF (SELECT COALESCE(sum(r.amount_cents), 0) FROM public.provider_refunds r
           WHERE r.provider_payment_id = p_payment_id AND r.status IN ('pending', 'completed'))
         + p_amount_cents > p_max_total_cents THEN
        RAISE EXCEPTION 'refund_exceeds_refundable' USING ERRCODE = '23514',
          DETAIL = format('refunds of payment %s would pass %s cents (PayPal keeps its fee)', p_payment_id, p_max_total_cents);
      END IF;
    END IF;
    BEGIN
      INSERT INTO public.provider_refunds (provider_payment_id, idempotency_key, amount_cents, status, reason)
      VALUES (p_payment_id, p_idempotency_key, p_amount_cents, 'pending', left(p_reason, 500))
      RETURNING * INTO v_ref;
    EXCEPTION WHEN unique_violation THEN
      -- A racing claim with the same key won: answer with its row.
      SELECT * INTO v_ref FROM public.provider_refunds WHERE idempotency_key = p_idempotency_key;
      IF NOT FOUND THEN
        RAISE;
      END IF;
      v_replay := true;
    END;
  END IF;
  -- One key, one refund: the same key for another payment or amount is a caller bug.
  IF v_ref.provider_payment_id IS DISTINCT FROM p_payment_id OR v_ref.amount_cents IS DISTINCT FROM p_amount_cents THEN
    RAISE EXCEPTION 'refund_key_reused' USING ERRCODE = '23505',
      DETAIL = format('key %s already claims %s cents of payment %s', p_idempotency_key, v_ref.amount_cents, v_ref.provider_payment_id);
  END IF;
  IF NOT v_replay THEN
    PERFORM public.paypal_payment_sync_refund_status(p_payment_id);
  END IF;
  RETURN jsonb_build_object(
    'refund_id', v_ref.id,
    'status', v_ref.status,
    'provider_refund_id', v_ref.provider_refund_id,
    'amount_cents', v_ref.amount_cents,
    'capture_id', v_pay.provider_capture_id,
    'env', v_pay.env,
    'replay', v_replay);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_refund_claim(uuid, text, bigint, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_claim(uuid, text, bigint, text, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.paypal_refund_record(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_status text,
  p_amount_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ref public.provider_refunds%ROWTYPE;
  v_sync jsonb;
  v_mismatch boolean := false;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'refund_status_invalid' USING ERRCODE = '22023';
  END IF;
  -- Lock order payment -> refund, as every other money write on these tables (the refund and
  -- payout guards lock the payment first): no deadlock with a racing claim or payout.
  PERFORM 1 FROM public.provider_payments p
   WHERE p.id = (SELECT r.provider_payment_id FROM public.provider_refunds r WHERE r.id = p_refund_id)
     FOR UPDATE;
  SELECT * INTO v_ref FROM public.provider_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = '22023';
  END IF;
  IF p_provider_refund_id IS NOT NULL AND v_ref.provider_refund_id IS NOT NULL
     AND v_ref.provider_refund_id <> p_provider_refund_id THEN
    RAISE EXCEPTION 'refund_id_mismatch' USING ERRCODE = '23514',
      DETAIL = format('row %s is PayPal refund %s, not %s', p_refund_id, v_ref.provider_refund_id, p_provider_refund_id);
  END IF;
  -- PayPal refunded a different amount than we claimed. Measured by phase 6 in the sandbox
  -- (2026-10-23): asking for the whole capture after a partial refund is NOT refused; PayPal refunds
  -- what is left and answers with the smaller amount. On PayPal's FIRST answer for this row a smaller
  -- amount is recorded as the real one and flagged (amount_mismatch: the caller pages); anything
  -- else (more than claimed, or a change after the row was answered) is refused, never papered over.
  IF p_amount_cents IS NOT NULL AND p_amount_cents <> v_ref.amount_cents THEN
    IF p_amount_cents > v_ref.amount_cents OR p_amount_cents <= 0 OR v_ref.provider_refund_id IS NOT NULL THEN
      RAISE EXCEPTION 'refund_amount_mismatch' USING ERRCODE = '23514',
        DETAIL = format('row %s claims %s cents, PayPal says %s', p_refund_id, v_ref.amount_cents, p_amount_cents);
    END IF;
    v_mismatch := true;
  END IF;
  -- completed, failed and cancelled are final at PayPal; only pending moves.
  IF v_ref.status <> 'pending' AND p_status <> v_ref.status THEN
    RAISE EXCEPTION 'refund_status_final' USING ERRCODE = '23514',
      DETAIL = format('row %s is %s, PayPal now says %s', p_refund_id, v_ref.status, p_status);
  END IF;
  IF p_status <> v_ref.status OR (p_provider_refund_id IS NOT NULL AND v_ref.provider_refund_id IS NULL) OR v_mismatch THEN
    UPDATE public.provider_refunds
       SET provider_refund_id = COALESCE(provider_refund_id, p_provider_refund_id),
           status = p_status,
           amount_cents = CASE WHEN v_mismatch THEN p_amount_cents ELSE amount_cents END,
           updated_at = now()
     WHERE id = p_refund_id;
  END IF;
  v_sync := public.paypal_payment_sync_refund_status(v_ref.provider_payment_id);
  RETURN v_sync || jsonb_build_object('refund_id', p_refund_id, 'status', p_status, 'changed', p_status <> v_ref.status,
                                      'previous_status', v_ref.status, 'idempotency_key', v_ref.idempotency_key,
                                      'amount_mismatch', v_mismatch, 'asked_cents', v_ref.amount_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_refund_record(uuid, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_record(uuid, text, text, bigint) TO service_role;

DROP FUNCTION IF EXISTS public.paypal_refund_reconcile(text, text, text, text, bigint);
CREATE OR REPLACE FUNCTION public.paypal_refund_reconcile(
  p_env text,
  p_capture_id text,
  p_provider_refund_id text,
  p_status text,
  p_amount_cents bigint,
  -- custom_id on the refund (our provider_refunds row id, set by the refund request), when PayPal
  -- echoes it: matches a lost answer to its exact claim instead of the oldest one of that amount.
  p_refund_row_hint uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pay public.provider_payments%ROWTYPE;
  v_ref public.provider_refunds%ROWTYPE;
  v_rec jsonb;
  v_held integer := 0;
  v_err text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'completed', 'failed', 'cancelled')
     OR p_provider_refund_id IS NULL OR p_capture_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'reconcile_input_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pay FROM public.provider_payments
   WHERE provider = 'paypal_checkout' AND provider_capture_id = p_capture_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'unknown_capture');
  END IF;
  IF v_pay.env IS DISTINCT FROM p_env THEN
    RAISE EXCEPTION 'reconcile_env_mismatch' USING ERRCODE = '23514',
      DETAIL = format('payment %s is %s, the event came in on %s', v_pay.id, v_pay.env, p_env);
  END IF;

  SELECT * INTO v_ref FROM public.provider_refunds WHERE provider_refund_id = p_provider_refund_id FOR UPDATE;
  IF FOUND THEN
    IF v_ref.provider_payment_id <> v_pay.id THEN
      RAISE EXCEPTION 'reconcile_payment_mismatch' USING ERRCODE = '23514';
    END IF;
    IF v_ref.status = p_status THEN
      RETURN public.paypal_payment_sync_refund_status(v_pay.id)
             || jsonb_build_object('outcome', 'already', 'refund_id', v_ref.id, 'status', p_status,
                                   'idempotency_key', v_ref.idempotency_key);
    END IF;
    v_rec := public.paypal_refund_record(v_ref.id, p_provider_refund_id, p_status, p_amount_cents);
    RETURN v_rec || jsonb_build_object('outcome', 'updated');
  END IF;

  -- Our own claim whose PayPal answer never came back (timeout): same payment, still pending, no
  -- PayPal id, same amount; the one PayPal names (custom_id) first, else the oldest.
  SELECT * INTO v_ref FROM public.provider_refunds
   WHERE provider_payment_id = v_pay.id AND provider_refund_id IS NULL
     AND status = 'pending'
     -- The claim PayPal names (custom_id), whatever amount PayPal really refunded; else one of the
     -- same amount.
     AND (id IS NOT DISTINCT FROM p_refund_row_hint OR amount_cents = p_amount_cents)
   ORDER BY (id IS NOT DISTINCT FROM p_refund_row_hint) DESC, created_at
   LIMIT 1
     FOR UPDATE;
  IF FOUND THEN
    v_rec := public.paypal_refund_record(v_ref.id, p_provider_refund_id, p_status, p_amount_cents);
    RETURN v_rec || jsonb_build_object('outcome', 'attached');
  END IF;

  IF p_status IN ('failed', 'cancelled') THEN
    -- A dead refund we never claimed moved no money.
    RETURN jsonb_build_object('outcome', 'ignored_dead');
  END IF;

  -- Made outside the app (the PayPal dashboard): the ledger must still say so.
  BEGIN
    INSERT INTO public.provider_refunds (provider_payment_id, idempotency_key, provider_refund_id, amount_cents, status, reason)
    VALUES (v_pay.id, 'paypal:refund:' || p_provider_refund_id, p_provider_refund_id, p_amount_cents, p_status,
            'made outside the app (PayPal)');
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23514' THEN
    -- The guard refused it: a payout of this payment is queued, held or sent, or the refunds
    -- would exceed the payment. The money already went back to the payer, so a queued payout must
    -- not be paid on top: put the queued ones on hold for an admin, and let the caller page ops.
    v_err := SQLERRM;
    UPDATE public.provider_payouts
       SET status = 'held', updated_at = now()
     WHERE provider_payment_id = v_pay.id AND status = 'pending';
    GET DIAGNOSTICS v_held = ROW_COUNT;
    RETURN jsonb_build_object('outcome', 'outside_refund_refused', 'reason', v_err, 'payouts_held', v_held,
                              'payment_id', v_pay.id);
  END;
  RETURN public.paypal_payment_sync_refund_status(v_pay.id)
         || jsonb_build_object('outcome', 'recorded_outside', 'payment_id', v_pay.id, 'status', p_status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_refund_reconcile(text, text, text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_reconcile(text, text, text, text, bigint, uuid) TO service_role;

-- A refund door settles its job (an admin full refund cancels it; an agreed "refund all" marks it
-- refunded). Phase 3's paypal_job_money_state_guard refuses any payment_status change on a
-- PayPal-funded job unless the transaction says app.paypal_money_write = '1', so the change goes
-- through this one service-only function: it checks the refund is a LIVE refund of THIS job's
-- payment, compares-and-swaps the status it was read in, and sets the flag only around its own
-- UPDATE (lh-money-escrow review round 2, #1a).
CREATE OR REPLACE FUNCTION public.paypal_job_mark_refunded(
  p_job_id uuid,
  p_refund_id uuid,
  p_cancel boolean,
  p_expect_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.provider_refunds r
                   JOIN public.provider_payments pp ON pp.id = r.provider_payment_id
                  WHERE r.id = p_refund_id AND r.status IN ('pending', 'completed')
                    AND pp.subject_kind = 'job' AND pp.subject_id = p_job_id) THEN
    RAISE EXCEPTION 'refund_not_for_job' USING ERRCODE = '22023',
      DETAIL = format('refund %s is not a live refund of job %s', p_refund_id, p_job_id);
  END IF;
  PERFORM set_config('app.paypal_money_write', '1', true);
  UPDATE public.jobs
     SET payment_status = 'refunded',
         status = CASE WHEN p_cancel THEN 'cancelled' ELSE status::text END::public.job_status
   WHERE id = p_job_id
     AND status::text = p_expect_status
     AND status::text <> 'disputed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.paypal_money_write', '', true);
  RETURN jsonb_build_object('updated', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_job_mark_refunded(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_job_mark_refunded(uuid, uuid, boolean, text) TO service_role;

-- A poster cancels a job paid through PayPal (lead decision 2026-10-23: ONE money path). Phase 3's
-- paypal_capture_locks_job_price refuses a member's cancel while the PayPal money is held, because
-- the Stripe-era cancel refunds nothing. This is the sanctioned door: it ONLY cancels, through the
-- existing poster_cancel_job (who may cancel, the fee tier, the notices: unchanged), and moves no
-- money. payment_status stays 'escrow'; phase 6's cancellation sweep then settles the money through
-- the refund engine under the key lh:job:<job>:refund:cancel (one key: one refund, however often it
-- runs). The transaction-local flag app.paypal_sanctioned_cancel tells phase 3's lock this cancel came
-- through here (the flag name is the contract with phase 3). Members cannot set it themselves:
-- set_config is not reachable through the API.
-- Not behind require_feature: it serves only jobs that already hold PayPal money, and switching
-- the feature off must never leave a poster unable to cancel a paid job.
CREATE OR REPLACE FUNCTION public.paypal_poster_cancel_job(
  p_job_id uuid,
  p_reason text DEFAULT NULL,
  p_expected_fee_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_payments p
                  WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id
                    AND p.status IN ('captured', 'partially_refunded')) THEN
    RAISE EXCEPTION 'not_a_paypal_job' USING ERRCODE = '22023',
      HINT = 'This job is not paid through PayPal: cancel it the usual way.';
  END IF;
  PERFORM set_config('app.paypal_sanctioned_cancel', '1', true);
  v_out := public.poster_cancel_job(p_job_id, p_reason, p_expected_fee_cents);
  PERFORM set_config('app.paypal_sanctioned_cancel', '', true);
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_poster_cancel_job(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paypal_poster_cancel_job(uuid, text, bigint) TO authenticated, service_role;

-- Orphan captures not refunded yet (no live refund): refunded in full by the sweep.
CREATE OR REPLACE FUNCTION public.paypal_orphan_refunds_due(p_limit integer DEFAULT 20)
RETURNS TABLE(provider_payment_id uuid, subject_kind text, subject_id uuid, payer_id uuid,
              amount_cents bigint, env text, orphan_reason text, failed_attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT pp.id, pp.subject_kind, pp.subject_id, pp.payer_id, pp.amount_cents, pp.env,
         to_jsonb(pp) ->> 'status_reason',
         (SELECT count(*)::integer FROM public.provider_refunds r
           WHERE r.provider_payment_id = pp.id AND r.status IN ('failed', 'cancelled'))
    FROM public.provider_payments pp
   WHERE pp.status = 'voided'
     AND pp.provider_capture_id IS NOT NULL
     AND COALESCE(to_jsonb(pp) ->> 'status_reason', '') LIKE 'orphan:%'
     AND NOT EXISTS (SELECT 1 FROM public.provider_refunds r
                      WHERE r.provider_payment_id = pp.id AND r.status IN ('pending', 'completed'))
   ORDER BY pp.updated_at
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
$fn$;
REVOKE ALL ON FUNCTION public.paypal_orphan_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_orphan_refunds_due(integer) TO service_role;

-- A watcher, not a refund (reviews round 3: lh-silent-failure #1, lh-money-escrow #1/#3): cancelled
-- jobs whose PayPal money is still held and whose job is not settled ('refunded') an hour after the
-- cancel, whether no cancel refund is under way or one finished outside phase 6's sweep (the lost-
-- answer retry, the webhook). Phase 6's sweep settles them; until it does (or if it stalls)
-- paypal-refunds pages each one once a day, so a cancelled poster's money is never held in silence.
CREATE OR REPLACE FUNCTION public.paypal_cancelled_jobs_waiting(p_limit integer DEFAULT 20)
RETURNS TABLE(job_id uuid, provider_payment_id uuid, amount_cents bigint, cancel_refund_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT j.id, pp.id, pp.amount_cents,
         (SELECT r.status FROM public.provider_refunds r
           WHERE r.provider_payment_id = pp.id
             AND r.idempotency_key LIKE 'lh:job:' || j.id::text || ':refund:cancel%'
             AND r.status IN ('pending', 'completed')
           ORDER BY r.created_at DESC LIMIT 1)
    FROM public.provider_payments pp
    JOIN public.jobs j ON j.id = pp.subject_id
   WHERE pp.subject_kind = 'job'
     AND pp.status IN ('captured', 'partially_refunded')
     AND j.status::text = 'cancelled'
     AND j.payment_status IS DISTINCT FROM 'refunded'
     AND COALESCE((to_jsonb(j) ->> 'cancelled_at')::timestamptz, pp.updated_at) < now() - interval '1 hour'
   ORDER BY COALESCE((to_jsonb(j) ->> 'cancelled_at')::timestamptz, pp.updated_at)
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
$fn$;
REVOKE ALL ON FUNCTION public.paypal_cancelled_jobs_waiting(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_cancelled_jobs_waiting(integer) TO service_role;

-- Phase 1's refund rule, restated from 20261023223419 with ONE carve-out: an orphan capture (above)
-- may be refunded, in full only. Everything else is phase 1's text: no refund while a payout of the
-- same money is queued, held or sent; never more than the payment.
CREATE OR REPLACE FUNCTION public.provider_refunds_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_refunded bigint;
  v_pay jsonb;
  v_orphan boolean;
BEGIN
  IF NEW.status IN ('failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  -- Serialize money movements on one payment (refund vs payout vs refund).
  PERFORM 1 FROM public.provider_payments WHERE id = NEW.provider_payment_id FOR UPDATE;
  SELECT to_jsonb(p) INTO v_pay FROM public.provider_payments p WHERE p.id = NEW.provider_payment_id;
  v_orphan := v_pay IS NOT NULL
              AND v_pay ->> 'status' = 'voided'
              AND v_pay ->> 'provider_capture_id' IS NOT NULL
              AND COALESCE(v_pay ->> 'status_reason', '') LIKE 'orphan:%';
  -- A NEW refund (or a dead one brought back) is the decision point. A live refund's later status
  -- update (pending -> completed) must always be recordable, whatever was queued since.
  IF TG_OP = 'INSERT' OR OLD.status IN ('failed', 'cancelled') OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN
    IF NOT v_orphan AND NOT EXISTS (SELECT 1 FROM public.provider_payments
                    WHERE id = NEW.provider_payment_id AND status IN ('captured', 'partially_refunded', 'disputed')) THEN
      RAISE EXCEPTION 'refund_needs_captured_payment' USING ERRCODE = '42501';
    END IF;
    IF v_orphan AND NEW.amount_cents IS DISTINCT FROM (v_pay ->> 'amount_cents')::bigint THEN
      RAISE EXCEPTION 'orphan_refund_must_be_full' USING ERRCODE = '23514',
        DETAIL = 'a capture that funded nothing goes back in full';
    END IF;
    IF EXISTS (SELECT 1 FROM public.provider_payouts p
                WHERE p.provider_payment_id = NEW.provider_payment_id
                  AND p.status NOT IN ('failed', 'returned', 'canceled')) THEN
      RAISE EXCEPTION 'refund_after_payout_queued' USING ERRCODE = '42501',
        DETAIL = 'a payout of this payment is queued or sent; cancel it first';
    END IF;
  END IF;
  SELECT COALESCE(sum(r.amount_cents), 0) INTO v_refunded
    FROM public.provider_refunds r
   WHERE r.provider_payment_id = NEW.provider_payment_id
     AND r.id <> NEW.id
     AND r.status NOT IN ('failed', 'cancelled');
  IF v_refunded + NEW.amount_cents > (SELECT amount_cents FROM public.provider_payments WHERE id = NEW.provider_payment_id) THEN
    RAISE EXCEPTION 'refund_exceeds_payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_refunds_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_refunds_guard ON public.provider_refunds;
CREATE TRIGGER trg_provider_refunds_guard
  BEFORE INSERT OR UPDATE ON public.provider_refunds
  FOR EACH ROW EXECUTE FUNCTION public.provider_refunds_guard();

-- ── 3. The cron: paypal-refunds every 10 minutes ────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('paypal-refunds', interval '30 minutes',
            'PayPal phase 5: every 10 minutes, refunds orphan PayPal captures in full, re-asks PayPal about a refund whose answer was lost, and re-reads refunds still pending at PayPal.',
            'exempt',
            'While paypal_payments is off or testers-only, a run that finds nothing to do is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('paypal-refunds', '3,13,23,33,43,53 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'paypal-refunds')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 120000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/paypal-refunds',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{"action":"sweep"}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
