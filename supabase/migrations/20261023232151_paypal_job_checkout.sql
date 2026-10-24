-- PayPal Plan A, phase 3: a job is paid for through PayPal Checkout and held (design
-- ~/.lh-wt/paypal-design.md §6 row 3). Builds on 20261023223419_paypal_provider_foundation.
--
-- THE MONEY PATH
--   create-payment `escrow` (paypal_payments on for the poster) opens a PayPal order and
--   records it here as a provider_payments row ('created'), then sends the poster to PayPal.
--   The poster approves there. We capture (the money moves) from TWO places, whichever comes
--   first: the return page (create-payment `paypal_capture`) and the CHECKOUT.ORDER.APPROVED
--   webhook. Both re-read the order from PayPal and use the same PayPal-Request-Id, so they
--   get the same single capture. Only a CAPTURED row funds the job (job_is_funded).
--
-- WHY A CLAIM BEFORE THE CAPTURE
--   Approving a PayPal order moves no money; our capture call does. So the database decides,
--   before every capture, that this order may still be captured: paypal_job_capture_claim
--   locks the job and the row, and refuses (and voids the row) when the job closed, was paid
--   some other way, or its price changed since the order was made. A re-mint (a newer order
--   for the same job) can only void a row that is still 'created'; a claimed ('approved') row
--   cannot be voided under a capture in flight. The two conditional updates serialize on the
--   row, so an order is never captured after it was replaced.
--   While a row is claimed or capture-pending, the poster cannot change the price
--   (trg_paypal_capture_locks_job_price): the money PayPal takes is the money the job says.
--
-- FUNDED MEANS CAPTURED
--   public.job_is_funded(uuid) (the existing helper, which already gates applying to a job) and
--   the award gate now both require: the payment state is funded AND, for a job that went
--   through PayPal, a provider_payments row is captured. A pending capture (an eCheck that has
--   not cleared) never funds a job.
--
-- SWITCH: the RPCs below are the SERVICE ROLE's (create-payment, paypal-webhook); none is
-- callable by a member or the anon key. A new PayPal payment row is refused by
-- paypal_entry_requires_switch (phase 1) unless paypal_payments is on for the payer, and a
-- capture is refused here unless it is still on (paypal_job_capture_claim). They do not call
-- require_feature(): it reads auth.uid(), which the service role does not have.
--
-- REPLAY-SAFE: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.

-- What the order was priced from, so a capture can prove the job still has that price, and
-- so a later refund (phase 5) knows the parts. Written once, by paypal_job_order_open.
ALTER TABLE public.provider_payments ADD COLUMN IF NOT EXISTS breakdown jsonb;
-- Why a row was voided or failed (price changed, declined, ...), for support and the logs.
ALTER TABLE public.provider_payments ADD COLUMN IF NOT EXISTS status_reason text;

-- At most one order per job is open (created or claimed) at a time: opening a new one first
-- voids the old one.
CREATE UNIQUE INDEX IF NOT EXISTS provider_payments_one_open_per_subject
  ON public.provider_payments (subject_kind, subject_id)
  WHERE status IN ('created', 'approved');

-- The price facts an order was made for match the job as it is now.
CREATE OR REPLACE FUNCTION public.paypal_job_price_matches(p_job public.jobs, p_breakdown jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_breakdown IS NOT NULL AND p_job.id IS NOT NULL AND (p_breakdown->>'budget') IS NOT NULL
     AND p_job.budget IS NOT DISTINCT FROM (p_breakdown->>'budget')::numeric
     AND COALESCE(p_job.urgent_fee, 0) = COALESCE((p_breakdown->>'urgent_fee')::numeric, 0)
     AND COALESCE(p_job.is_urgent, false) = COALESCE((p_breakdown->>'is_urgent')::boolean, false)
     -- jobs.category is the job_category enum: compared as its text label.
     AND p_job.category::text IS NOT DISTINCT FROM (p_breakdown->>'category')
     AND p_job.helpers_needed IS NOT DISTINCT FROM (p_breakdown->>'helpers_needed')::int
     -- recurrence_days is an int[]: compared as JSON (a one-off job is JSON null on both sides).
     AND COALESCE(to_jsonb(p_job.recurrence_days), 'null'::jsonb) = COALESCE(p_breakdown->'recurrence_days', 'null'::jsonb);
$fn$;
REVOKE ALL ON FUNCTION public.paypal_job_price_matches(public.jobs, jsonb) FROM PUBLIC, anon, authenticated;

-- THE funded test, part 2: a job that went through PayPal (any row claimed or beyond) holds
-- money only when a row is CAPTURED (a pending capture, an eCheck that has not cleared, is not
-- money held). Legacy (Stripe-era) jobs have no such row and keep the payment-state rule.
CREATE OR REPLACE FUNCTION public.job_provider_payment_held(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_job_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.provider_payments p
             WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id
               AND p.status IN ('captured', 'partially_refunded'))
    OR NOT EXISTS (SELECT 1 FROM public.provider_payments p
                    WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id
                      AND p.status NOT IN ('created', 'voided', 'failed')));
$fn$;
REVOKE ALL ON FUNCTION public.job_provider_payment_held(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_provider_payment_held(uuid) TO service_role;

-- job_is_funded (20260923123701: never true on a NULL id) now also requires the PayPal money to
-- be captured. It already gates applying to a job (the job_applications WITH CHECK) and is the
-- one helper "funded" readers use (design §5.3). Grants unchanged (authenticated, service_role).
CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT public.job_payment_is_funded(j.payment_status) AND public.job_provider_payment_held(j.id)
      FROM public.jobs j
     WHERE j.id = p_job_id
  ), false);
$fn$;
REVOKE ALL ON FUNCTION public.job_is_funded(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_is_funded(uuid) TO authenticated, service_role;

-- The award gate (20260907060556, newest body from prod pg_get_functiondef 2026-10-23), now
-- judged by job_is_funded: a PayPal job is awarded only once its money is captured.
CREATE OR REPLACE FUNCTION public.enforce_job_funded_before_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- does. The stripe webhook, the payout crons, str-ical-sync and
  -- charge-recurring-visits all run as service role with a NULL auth.uid() and
  -- must keep being able to write these columns. They are a server context;
  -- an anon request (NULL uid, role anon) is not, and is judged.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs" -- same definition
  -- as enforce_helper_award_gate, deliberately. A re-save that leaves both
  -- columns as they were is not an award: an already-hired helper on a job
  -- whose escrow has since been refunded must still be able to have that job
  -- completed, cancelled or disputed.
  v_awarding :=
    (NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id))
    OR (NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL));

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  -- Judge the funding state the row is LANDING in, not the one it left. The
  -- webhook sets payment_status and helper_id in separate statements, but a
  -- service-role session is already exempt above, so NEW is the honest read
  -- for every session this gate actually judges.
  -- PayPal phase 3: the same two parts as job_is_funded, judged on the row as it
  -- lands: a funded payment state AND, for a job paid through PayPal, a captured
  -- provider_payments row (a pending capture is not money held).
  IF NOT (public.job_payment_is_funded(NEW.payment_status) AND public.job_provider_payment_held(NEW.id)) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released (and a PayPal payment captured) before jobs.helper_id / helper_confirmed_at may be set. See enforce_job_funded_before_award().';
  END IF;

  RETURN NEW;
END;
$function$;

-- Whether PayPal money in one of these states is tied to the job: paid FOR it (subject_kind 'job')
-- or funding it from another payment (a repeat-series visit's provider_payments.funds_job_id,
-- phase 6; read through to_jsonb so this works before that column exists).
CREATE OR REPLACE FUNCTION public.paypal_job_money_rows_exist(p_job_id uuid, p_statuses text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.provider_payments p
     WHERE p.status = ANY (p_statuses)
       AND ((p.subject_kind = 'job' AND p.subject_id = p_job_id)
            OR (to_jsonb(p)->>'funds_job_id') = p_job_id::text));
$fn$;
REVOKE ALL ON FUNCTION public.paypal_job_money_rows_exist(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- While PayPal is capturing (claimed) or the capture has not cleared, a member cannot change
-- what the job costs, close it, or delete it: the money PayPal takes must land on the job, at
-- the price it carries. (The existing money lock covers the price once payment_status leaves
-- 'unpaid'; a PayPal job stays 'unpaid' until its capture is recorded.) Server writers pass.
CREATE OR REPLACE FUNCTION public.paypal_capture_locks_job_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- A job whose PayPal money is held (captured) is not cancelled or deleted by a member until the
  -- PayPal refund path exists (phase 5): the Stripe-era cancel would refund nothing.
  -- Phase 5's sanctioned PayPal cancel (which refunds) announces itself with
  -- app.paypal_sanctioned_cancel = '1' for its one update.
  IF (TG_OP = 'DELETE' OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'cancelled'))
     AND current_setting('app.paypal_sanctioned_cancel', true) IS DISTINCT FROM '1'
     AND public.paypal_job_money_rows_exist(OLD.id, ARRAY['captured', 'partially_refunded', 'disputed']) THEN
    RAISE EXCEPTION 'paypal_payment_held' USING ERRCODE = '42501',
      HINT = 'This job was paid through PayPal; cancelling it is not available yet. Contact support.';
  END IF;
  IF (TG_OP = 'DELETE'
      OR NEW.budget IS DISTINCT FROM OLD.budget
      OR NEW.urgent_fee IS DISTINCT FROM OLD.urgent_fee
      OR NEW.is_urgent IS DISTINCT FROM OLD.is_urgent
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.helpers_needed IS DISTINCT FROM OLD.helpers_needed
      OR NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('cancelled', 'completed')))
     AND public.paypal_job_money_rows_exist(OLD.id, ARRAY['approved', 'capture_pending']) THEN
    RAISE EXCEPTION 'paypal_payment_in_progress' USING ERRCODE = '42501',
      HINT = 'A PayPal payment for this job is being taken; it cannot be re-priced, closed or deleted now.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_capture_locks_job_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_paypal_capture_locks_job_price ON public.jobs;
CREATE TRIGGER trg_paypal_capture_locks_job_price
  BEFORE UPDATE OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.paypal_capture_locks_job_price();

-- A PayPal-funded job's payment state moves only through the PayPal RPCs, which announce
-- themselves with the transaction-local flag app.paypal_money_write. Every Stripe-era writer
-- (void-cancelled-payments, release-payout, auto-release, dispute splits, admin actions, any
-- server cron) is refused, loudly, instead of marking PayPal money cancelled, refunded or paid
-- out without moving it. Later phases (payouts, refunds) set the same flag in their own RPCs.
CREATE OR REPLACE FUNCTION public.paypal_job_money_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND current_setting('app.paypal_money_write', true) IS DISTINCT FROM '1'
     AND public.paypal_job_money_rows_exist(OLD.id, ARRAY['approved', 'capture_pending', 'captured', 'partially_refunded', 'disputed']) THEN
    RAISE EXCEPTION 'paypal_job_money_outside_paypal' USING ERRCODE = '42501',
      DETAIL = format('job %s is paid through PayPal; payment_status %s -> %s is only written by the PayPal RPCs', OLD.id, OLD.payment_status, NEW.payment_status);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_job_money_state_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_paypal_job_money_state_guard ON public.jobs;
CREATE TRIGGER trg_paypal_job_money_state_guard
  BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.paypal_job_money_state_guard();

-- The job's PayPal state: how many orders it has had (the next order's attempt number) and
-- the newest one that is not dead (open or funded).
CREATE OR REPLACE FUNCTION public.paypal_job_payment_state(p_job_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'attempts', (SELECT count(*) FROM public.provider_payments
                  WHERE subject_kind = 'job' AND subject_id = p_job_id),
    'current', (SELECT to_jsonb(p) FROM public.provider_payments p
                 WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id
                   AND p.status NOT IN ('voided', 'failed')
                 ORDER BY p.created_at DESC, p.id DESC LIMIT 1),
    -- Any capture ever recorded on the job (an orphan included): PayPal holds or held its money.
    'captured_any', EXISTS (SELECT 1 FROM public.provider_payments p
                             WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id
                               AND p.provider_capture_id IS NOT NULL));
$fn$;

-- The row a PayPal order id belongs to (webhooks), or null when it is not one of our job orders.
CREATE OR REPLACE FUNCTION public.paypal_job_payment_by_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT to_jsonb(p) FROM public.provider_payments p
   WHERE p.provider = 'paypal_checkout' AND p.provider_order_id = p_order_id AND p.subject_kind = 'job';
$fn$;

-- Which kind of payment a PayPal order id belongs to ('job', 'tip', ...), or null when it is not
-- ours. The webhook routes by it: a tip order is the tips handler's, never captured as a job.
CREATE OR REPLACE FUNCTION public.paypal_payment_subject_by_order(p_order_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.subject_kind FROM public.provider_payments p
   WHERE p.provider = 'paypal_checkout' AND p.provider_order_id = p_order_id;
$fn$;

-- Record a newly created PayPal order for a job. Re-checks, under the job's lock, everything
-- create-payment decided from its read: the payer is the poster, the job is open for payment,
-- the price is the one the order was made for. A double-tap (same idempotency key) gets the
-- same row back; a second, different open order is refused (one open order per job).
CREATE OR REPLACE FUNCTION public.paypal_job_order_open(
  p_job_id uuid,
  p_payer_id uuid,
  p_idempotency_key text,
  p_order_id text,
  p_amount_cents bigint,
  p_env text,
  p_breakdown jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job public.jobs;
  v_row public.provider_payments;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.customer_id IS DISTINCT FROM p_payer_id THEN
    RAISE EXCEPTION 'not_the_poster' USING ERRCODE = '42501';
  END IF;
  IF v_job.status::text IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'job_closed' USING ERRCODE = '55000';
  END IF;
  IF COALESCE(v_job.payment_status, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN
    RAISE EXCEPTION 'job_already_paid' USING ERRCODE = '55000';
  END IF;
  IF NOT public.paypal_job_price_matches(v_job, p_breakdown) THEN
    RAISE EXCEPTION 'price_changed' USING ERRCODE = '55000';
  END IF;
  IF p_amount_cents IS DISTINCT FROM COALESCE((p_breakdown->>'item_cents')::bigint, -1) + COALESCE((p_breakdown->>'tax_cents')::bigint, -1) THEN
    RAISE EXCEPTION 'amount_not_item_plus_tax' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.provider_payments
    (subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, breakdown)
  VALUES ('job', p_job_id, p_payer_id, 'paypal_checkout', p_env, p_idempotency_key, p_order_id, p_amount_cents, 'created', p_breakdown)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_row FROM public.provider_payments WHERE idempotency_key = p_idempotency_key;
  -- PayPal answers a reused key with the ORIGINAL order, so the same key must name the same order.
  IF v_row.provider_order_id IS DISTINCT FROM p_order_id OR v_row.subject_id IS DISTINCT FROM p_job_id
     OR v_row.amount_cents IS DISTINCT FROM p_amount_cents THEN
    RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '55000';
  END IF;
  RETURN to_jsonb(v_row);
END;
$fn$;

-- Retire an order nobody has approved yet (a re-mint, an expired order). Only a 'created' row:
-- a claimed one may have a capture in flight.
CREATE OR REPLACE FUNCTION public.paypal_job_order_void(p_payment_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n int;
BEGIN
  UPDATE public.provider_payments
     SET status = 'voided', status_reason = left(p_reason, 200), updated_at = now()
   WHERE id = p_payment_id AND subject_kind = 'job' AND status = 'created';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$fn$;

-- The decision to capture. ok=true means: capture this order now (or retry the capture).
-- Every refusal that can never become ok voids the row, so it cannot be captured later.
CREATE OR REPLACE FUNCTION public.paypal_job_capture_claim(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.provider_payments;
  v_job public.jobs;
  v_reason text;
  v_fee_paid boolean;
BEGIN
  SELECT * INTO v_row FROM public.provider_payments WHERE id = p_payment_id AND subject_kind = 'job' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.status NOT IN ('created', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_row.status);
  END IF;
  -- New money: the switch must still be on for the payer. Not voided: nothing moved, and the
  -- order simply waits (or expires) if an admin turned PayPal off.
  IF v_row.status = 'created' AND NOT public.feature_enabled_for_user('paypal_payments', v_row.payer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  -- Every claim, a re-claim (a capture retry) included, re-checks the job under its lock.
  SELECT * INTO v_job FROM public.jobs WHERE id = v_row.subject_id FOR UPDATE;
  IF NOT FOUND THEN
    v_reason := 'job_gone';
  ELSIF v_job.status::text IN ('completed', 'cancelled') THEN
    v_reason := 'job_closed';
  ELSIF COALESCE(v_job.payment_status, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed')
     OR EXISTS (SELECT 1 FROM public.provider_payments p
                 WHERE p.subject_kind = 'job' AND p.subject_id = v_row.subject_id AND p.id <> v_row.id
                   AND p.status IN ('capture_pending', 'captured', 'partially_refunded', 'disputed')) THEN
    v_reason := 'job_already_paid';
  ELSIF v_job.customer_id IS DISTINCT FROM v_row.payer_id THEN
    v_reason := 'payer_not_poster';
  ELSIF NOT public.paypal_job_price_matches(v_job, v_row.breakdown) THEN
    v_reason := 'price_changed';
  ELSIF COALESCE((v_row.breakdown->>'onboarding_fee_cents')::bigint, 0) > 0 AND v_row.payer_id IS NOT NULL THEN
    -- The one-time setup fee is never taken twice: the poster paid it since this order was made, or
    -- another of their orders carrying it is being captured. The poster re-pays without it.
    SELECT onboarding_fee_paid INTO v_fee_paid FROM public.profiles WHERE user_id = v_row.payer_id FOR UPDATE;
    IF v_fee_paid IS TRUE
       OR EXISTS (SELECT 1 FROM public.provider_payments p
                   WHERE p.payer_id = v_row.payer_id AND p.id <> v_row.id AND p.subject_kind = 'job'
                     AND p.status IN ('approved', 'capture_pending')
                     AND COALESCE((p.breakdown->>'onboarding_fee_cents')::bigint, 0) > 0) THEN
      v_reason := 'setup_fee_already_paid';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    -- A created order is voided (never captured later). A claimed one may have a capture in flight:
    -- it is failed, so a capture that still lands is recorded as an orphan and reported.
    UPDATE public.provider_payments
       SET status = CASE WHEN v_row.status = 'created' THEN 'voided' ELSE 'failed' END,
           status_reason = v_reason, updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  IF v_row.status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_claimed');
  END IF;
  UPDATE public.provider_payments SET status = 'approved', updated_at = now() WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'reason', 'claimed');
END;
$fn$;

-- Record what PayPal captured. Settled money funds the job (payment_status 'escrow', once);
-- a pending capture is recorded but funds nothing. A capture that cannot fund the job (its order
-- was retired or never claimed, the job closed, was re-priced or was paid another way under it)
-- is an ORPHAN: the row is voided with the capture id kept and status_reason 'orphan:<why>', so
-- it never reads as the job's money, every later read reports it (settleJobPayment returns
-- money_at_risk), and a refund (phase 5) can find it. The job and the row change together or
-- not at all.
CREATE OR REPLACE FUNCTION public.paypal_job_capture_record(
  p_payment_id uuid,
  p_capture_id text,
  p_amount_cents bigint,
  p_settled boolean,
  -- PayPal's own fee on the capture (seller_receivable_breakdown.paypal_fee), NULL while unknown.
  -- Kept in the breakdown: a cancel or refund keeps it (PayPal does not return its fee).
  p_fee_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.provider_payments;
  v_job public.jobs;
  v_why text;
  v_job_rows int;
  v_fee_rows int;
  v_tax_cents bigint;
  v_onboarding bigint;
BEGIN
  IF p_capture_id IS NULL OR p_capture_id !~ '^[A-Z0-9]+$' THEN
    RAISE EXCEPTION 'capture_id_invalid' USING ERRCODE = '22023';
  END IF;
  -- NULL is not "settled": never fund on an unknown settlement.
  IF p_settled IS NULL OR p_amount_cents IS NULL THEN
    RAISE EXCEPTION 'capture_settled_unknown' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.provider_payments WHERE id = p_payment_id AND subject_kind = 'job' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.provider_capture_id IS NOT NULL AND v_row.provider_capture_id <> p_capture_id THEN
    RETURN jsonb_build_object('outcome', 'capture_id_mismatch', 'job_id', v_row.subject_id);
  END IF;
  IF p_amount_cents IS DISTINCT FROM v_row.amount_cents THEN
    RETURN jsonb_build_object('outcome', 'amount_mismatch', 'job_id', v_row.subject_id);
  END IF;
  IF v_row.status IN ('captured', 'partially_refunded', 'refunded', 'disputed', 'reversed') THEN
    RETURN jsonb_build_object('outcome', 'already_funded', 'job_id', v_row.subject_id);
  END IF;
  IF v_row.status_reason LIKE 'orphan:%' THEN
    RETURN jsonb_build_object('outcome', 'orphan', 'job_id', v_row.subject_id, 'status', v_row.status_reason);
  END IF;

  IF v_row.status IN ('voided', 'failed', 'created') THEN
    -- Captured on an order we had retired, or one never claimed (its job's price was never
    -- re-checked).
    v_why := 'orphan:' || CASE v_row.status WHEN 'created' THEN 'unclaimed' ELSE v_row.status END;
  ELSE
    -- Under the job's lock (settled or pending alike): the job must still take this money, as the
    -- claim found it.
    SELECT * INTO v_job FROM public.jobs WHERE id = v_row.subject_id FOR UPDATE;
    IF NOT FOUND THEN
      v_why := 'orphan:job_gone';
    ELSIF v_job.status::text IN ('completed', 'cancelled') THEN
      v_why := 'orphan:job_closed';
    ELSIF COALESCE(v_job.payment_status, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed')
       OR EXISTS (SELECT 1 FROM public.provider_payments p
                   WHERE p.subject_kind = 'job' AND p.subject_id = v_row.subject_id AND p.id <> v_row.id
                     AND p.status IN ('capture_pending', 'captured', 'partially_refunded', 'disputed')) THEN
      v_why := 'orphan:second_capture';
    ELSIF NOT public.paypal_job_price_matches(v_job, v_row.breakdown) THEN
      v_why := 'orphan:price_changed';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    UPDATE public.provider_payments
       SET status = 'voided', provider_capture_id = p_capture_id, status_reason = v_why, updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object('outcome', 'orphan', 'job_id', v_row.subject_id, 'status', v_why);
  END IF;

  IF NOT p_settled THEN
    UPDATE public.provider_payments
       SET status = 'capture_pending', provider_capture_id = p_capture_id, updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object('outcome', 'pending', 'job_id', v_row.subject_id);
  END IF;

  -- The one write that may move a PayPal job's payment state (paypal_job_money_state_guard).
  PERFORM set_config('app.paypal_money_write', '1', true);
  UPDATE public.provider_payments
     SET status = 'captured', provider_capture_id = p_capture_id, updated_at = now(),
         breakdown = CASE WHEN p_fee_cents IS NULL THEN breakdown
                          ELSE COALESCE(breakdown, '{}'::jsonb) || jsonb_build_object('paypal_fee_cents', p_fee_cents) END
   WHERE id = v_row.id;
  v_tax_cents := COALESCE((v_row.breakdown->>'tax_cents')::bigint, 0);
  -- The one-time setup fee this order carried is collected once: claimed on the profile first, and
  -- recorded on the job (setupFeeKeptCents reads it: a cancel keeps it) only when THIS payment won
  -- the claim, as settleOnboardingFee.ts does on the Stripe path. A duplicate is reported instead.
  v_onboarding := COALESCE((v_row.breakdown->>'onboarding_fee_cents')::bigint, 0);
  v_fee_rows := 0;
  IF v_onboarding > 0 AND v_row.payer_id IS NOT NULL THEN
    UPDATE public.profiles SET onboarding_fee_paid = true
     WHERE user_id = v_row.payer_id AND onboarding_fee_paid IS NOT TRUE;
    GET DIAGNOSTICS v_fee_rows = ROW_COUNT;
  END IF;
  UPDATE public.jobs
     SET payment_status = 'escrow',
         onboarding_fee_amount = CASE WHEN v_fee_rows = 1 THEN v_onboarding / 100.0 ELSE onboarding_fee_amount END,
         sales_tax_amount = v_tax_cents / 100.0,
         sales_tax_rate = CASE WHEN v_tax_cents > 0 AND COALESCE((v_row.breakdown->>'taxable_base_cents')::bigint, 0) > 0
                               THEN least(1, round(v_tax_cents::numeric / (v_row.breakdown->>'taxable_base_cents')::numeric, 6))
                               ELSE 0 END
   WHERE id = v_row.subject_id
     AND COALESCE(payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
     AND status::text NOT IN ('completed', 'cancelled');
  GET DIAGNOSTICS v_job_rows = ROW_COUNT;
  PERFORM set_config('app.paypal_money_write', '', true);
  IF v_job_rows <> 1 THEN
    -- Impossible under the job's lock (checked above); never commit a captured row the job does not hold.
    RAISE EXCEPTION 'paypal_job_not_funded' USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('outcome', 'funded', 'job_id', v_row.subject_id,
    'onboarding_fee_duplicate', v_onboarding > 0 AND v_fee_rows = 0);
END;
$fn$;

-- PayPal refused the capture (declined, denied): the row can never fund the job; the poster
-- may try again ('failed' is a payment state "Finish paying" offers).
CREATE OR REPLACE FUNCTION public.paypal_job_capture_failed(p_payment_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.provider_payments;
BEGIN
  SELECT * INTO v_row FROM public.provider_payments WHERE id = p_payment_id AND subject_kind = 'job' FOR UPDATE;
  IF NOT FOUND OR v_row.status NOT IN ('created', 'approved', 'capture_pending') THEN
    RETURN false;
  END IF;
  UPDATE public.provider_payments SET status = 'failed', status_reason = left(p_reason, 200), updated_at = now() WHERE id = v_row.id;
  PERFORM set_config('app.paypal_money_write', '1', true);
  UPDATE public.jobs SET payment_status = 'failed'
   WHERE id = v_row.subject_id AND COALESCE(payment_status, 'unpaid') = 'unpaid';
  PERFORM set_config('app.paypal_money_write', '', true);
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.paypal_job_payment_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_payment_by_order(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_payment_subject_by_order(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_order_open(uuid, uuid, text, text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_order_void(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_capture_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_capture_record(uuid, text, bigint, boolean, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paypal_job_capture_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_job_payment_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_payment_by_order(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_payment_subject_by_order(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_order_open(uuid, uuid, text, text, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_order_void(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_capture_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_capture_record(uuid, text, bigint, boolean, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.paypal_job_capture_failed(uuid, text) TO service_role;
