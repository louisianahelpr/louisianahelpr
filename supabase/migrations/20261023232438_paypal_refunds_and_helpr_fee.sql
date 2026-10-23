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
--      paypal_cancelled_job_refunds_due  cancelled PayPal-funded jobs whose refund has not started.
--    Not behind require_feature: require_feature reads auth.uid(), which a service call does not
--    have, and refunds only follow a payment that already exists (phase 1: turning the switch off
--    must never strand money already taken). The admin door (paypal-refunds admin_refund) checks
--    the switch for the admin with requireFeature.
--
-- 3. The cron: paypal-refunds every 10 minutes (cancelled fee-0 jobs, retrying a claim whose
--    PayPal answer was lost). It acts only on rows that exist, i.e. testers' while the switch is
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

CREATE OR REPLACE FUNCTION public.paypal_refund_claim(
  p_payment_id uuid,
  p_idempotency_key text,
  p_amount_cents bigint,
  p_reason text
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
  -- A replay first: an existing claim is answered as it stands, even after a payout was queued
  -- since (the guard decides only a NEW refund), so a retry can always finish the refund it began.
  SELECT * INTO v_ref FROM public.provider_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_replay := true;
  ELSE
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
REVOKE ALL ON FUNCTION public.paypal_refund_claim(uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_claim(uuid, text, bigint, text) TO service_role;

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
  -- PayPal refunded a different amount than we claimed: never paper over it.
  IF p_amount_cents IS NOT NULL AND p_amount_cents <> v_ref.amount_cents THEN
    RAISE EXCEPTION 'refund_amount_mismatch' USING ERRCODE = '23514',
      DETAIL = format('row %s claims %s cents, PayPal says %s', p_refund_id, v_ref.amount_cents, p_amount_cents);
  END IF;
  -- completed, failed and cancelled are final at PayPal; only pending moves.
  IF v_ref.status <> 'pending' AND p_status <> v_ref.status THEN
    RAISE EXCEPTION 'refund_status_final' USING ERRCODE = '23514',
      DETAIL = format('row %s is %s, PayPal now says %s', p_refund_id, v_ref.status, p_status);
  END IF;
  IF p_status <> v_ref.status OR (p_provider_refund_id IS NOT NULL AND v_ref.provider_refund_id IS NULL) THEN
    UPDATE public.provider_refunds
       SET provider_refund_id = COALESCE(provider_refund_id, p_provider_refund_id),
           status = p_status,
           updated_at = now()
     WHERE id = p_refund_id;
  END IF;
  v_sync := public.paypal_payment_sync_refund_status(v_ref.provider_payment_id);
  RETURN v_sync || jsonb_build_object('refund_id', p_refund_id, 'status', p_status, 'changed', p_status <> v_ref.status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_refund_record(uuid, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_record(uuid, text, text, bigint) TO service_role;

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
             || jsonb_build_object('outcome', 'already', 'refund_id', v_ref.id);
    END IF;
    v_rec := public.paypal_refund_record(v_ref.id, p_provider_refund_id, p_status, p_amount_cents);
    RETURN v_rec || jsonb_build_object('outcome', 'updated');
  END IF;

  -- Our own claim whose PayPal answer never came back (timeout): same payment, still pending, no
  -- PayPal id, same amount; the one PayPal names (custom_id) first, else the oldest.
  SELECT * INTO v_ref FROM public.provider_refunds
   WHERE provider_payment_id = v_pay.id AND provider_refund_id IS NULL
     AND status = 'pending' AND amount_cents = p_amount_cents
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
         || jsonb_build_object('outcome', 'recorded_outside', 'payment_id', v_pay.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_refund_reconcile(text, text, text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_refund_reconcile(text, text, text, text, bigint, uuid) TO service_role;

-- Cancelled jobs paid through PayPal whose cancel refund has not been claimed yet. The edge sweep
-- refunds the fee-0 ones; the rest (a late-cancel fee, a crew, a series) wait for their phase.
CREATE OR REPLACE FUNCTION public.paypal_cancelled_job_refunds_due(p_limit integer DEFAULT 20)
RETURNS TABLE(job_id uuid, provider_payment_id uuid, payment_amount_cents bigint, job_payment_status text,
              cancellation_fee_cents bigint, has_crew boolean, is_series boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT j.id, pp.id, pp.amount_cents, j.payment_status,
         round(COALESCE(j.cancellation_fee, 0) * 100)::bigint,
         COALESCE(j.is_group_job, false),
         (j.recurrence_days IS NOT NULL OR j.parent_job_id IS NOT NULL)
    FROM public.provider_payments pp
    JOIN public.jobs j ON j.id = pp.subject_id
   WHERE pp.subject_kind = 'job'
     AND pp.status IN ('captured', 'partially_refunded')
     AND j.status = 'cancelled'
     AND NOT EXISTS (SELECT 1 FROM public.provider_refunds r
                      WHERE r.provider_payment_id = pp.id
                        AND r.idempotency_key = 'lh:job:' || j.id::text || ':refund:cancel')
   ORDER BY pp.created_at
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
$fn$;
REVOKE ALL ON FUNCTION public.paypal_cancelled_job_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_cancelled_job_refunds_due(integer) TO service_role;

-- ── 3. The cron: paypal-refunds every 10 minutes ────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('paypal-refunds', interval '30 minutes',
            'PayPal phase 5: every 10 minutes, refunds cancelled PayPal-funded jobs that owe no cancellation fee, and re-asks PayPal about a refund whose answer was lost.',
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
