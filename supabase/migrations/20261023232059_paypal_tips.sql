-- PayPal Plan A: tips through PayPal (owner 2026-10-23: tips live on day one of PayPal; auto-tip
-- later). Design ~/.lh-wt/paypal-design.md §2 (Tips row), §5, §6a. Phase 1's migration
-- 20261023223419 is never edited; this file adds what tips need.
--
-- THE TIP RULE IS TODAY'S RULE (create-payment action "tip", _shared/tipFees.ts, owner
-- 2026-09-25): the Helpr receives 100% of the tip. The poster pays the processing cost on top,
-- so the payment is tip + fee and the Helpr's payout is exactly the tip. No Helpr fee on tips.
--
-- HOW A PAYPAL TIP MOVES
--   1. paypal-tip "create": a PayPal order for tip + fee, then paypal_open_tip() writes the
--      pending tips row and its provider_payments row (subject_kind 'tip', subject_id = tips.id)
--      in one transaction, keyed by the order's idempotency key (a retry finds the same rows).
--   2. The poster approves on PayPal. The capture happens on return (paypal-tip "capture") and
--      again from the webhook processor; both call paypal_record_tip_capture(), which is
--      idempotent: the same capture twice is one capture, one 'paid' flip, one payout row.
--   3. A captured tip queues ONE manual payout to the Helpr (provider_payouts, manual_paypal,
--      pending, tip_id = the tip): it sits in the admin "Pay this Helpr" queue beside the job's own
--      payout, so the owner pays job + tip with one PayPal Send Money (phase 4 groups by payee +
--      destination and marks a list of payouts with one transaction id).
--
-- WHY A TIP PAYOUT HAS NO payout_transfers CLAIM ROW
-- Phase 1 made provider_payouts.payout_transfer_id NOT NULL: the claim row is the
-- one-live-payout-per-job+Helpr lock. A tip cannot use it: prod's unique index
-- payout_transfers_one_live_per_job_helper (job_id, helper_id), live statuses, excluding only
-- metadata source 'chargeback-repay' (measured 2026-10-23, pg_indexes) would collide with the
-- job's own claim, and payout_transfers rows are read as JOB payouts by earnings and
-- reconciliation. So a tip payout names its tip instead: tip_id UNIQUE is the tip's
-- one-live-payout lock, and exactly one of payout_transfer_id / tip_id is set (lead approved
-- 2026-10-23). Phase 1's guards still apply per payment: a tip payout is never more than the tip's
-- own payment, and the tip is never refunded once its payout is queued.
--
-- SERVER ONLY. Both functions are for the service role (the paypal-tip edge function and the
-- webhook processor), which has no auth.uid(), so require_feature() cannot be their gate. The
-- switch is enforced where money enters: paypal-tip calls requireFeature() for the verified
-- caller, and phase 1's paypal_entry_requires_switch trigger refuses the provider_payments insert
-- for a payer the switch is off for, whoever writes it. The capture is NOT switch-gated: turning
-- the switch off must never strand money a poster already paid.
--
-- REPLAY-SAFETY: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.

ALTER TABLE public.provider_payouts
  ADD COLUMN IF NOT EXISTS tip_id uuid REFERENCES public.tips(id) ON DELETE RESTRICT;
ALTER TABLE public.provider_payouts ALTER COLUMN payout_transfer_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provider_payouts_one_per_tip
  ON public.provider_payouts (tip_id) WHERE tip_id IS NOT NULL;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'provider_payouts_claim_or_tip'
                    AND conrelid = 'public.provider_payouts'::regclass) THEN
    -- Exactly one: a job payout keeps its claim row; a tip payout names its tip.
    ALTER TABLE public.provider_payouts
      ADD CONSTRAINT provider_payouts_claim_or_tip
      CHECK ((payout_transfer_id IS NULL) <> (tip_id IS NULL));
  END IF;
END
$do$;

-- A payout's link must agree with the money it pays out of: a tip payout pays out of THAT tip's
-- payment, to THAT tip's Helpr; a job payout never pays out of a tip's payment.
CREATE OR REPLACE FUNCTION public.provider_payouts_tip_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_subject uuid;
  v_helper uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tip_id IS NOT DISTINCT FROM OLD.tip_id
     AND NEW.provider_payment_id IS NOT DISTINCT FROM OLD.provider_payment_id
     AND NEW.payout_transfer_id IS NOT DISTINCT FROM OLD.payout_transfer_id
     AND NEW.payee_user_id IS NOT DISTINCT FROM OLD.payee_user_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tip_id IS DISTINCT FROM OLD.tip_id
                           OR NEW.payout_transfer_id IS DISTINCT FROM OLD.payout_transfer_id) THEN
    RAISE EXCEPTION 'payout_link_is_frozen' USING ERRCODE = '42501',
      DETAIL = 'cancel this payout and queue a new one';
  END IF;
  SELECT subject_kind, subject_id INTO v_kind, v_subject
    FROM public.provider_payments WHERE id = NEW.provider_payment_id;
  IF NEW.tip_id IS NOT NULL THEN
    IF v_kind IS DISTINCT FROM 'tip' OR v_subject IS DISTINCT FROM NEW.tip_id THEN
      RAISE EXCEPTION 'tip_payout_wrong_payment' USING ERRCODE = '42501',
        DETAIL = 'a tip payout pays out of that tip''s own payment';
    END IF;
    SELECT helper_id INTO v_helper FROM public.tips WHERE id = NEW.tip_id;
    -- payee_user_id may later become NULL (account deletion, ON DELETE SET NULL); never another member.
    IF NEW.payee_user_id IS NOT NULL AND NEW.payee_user_id IS DISTINCT FROM v_helper THEN
      RAISE EXCEPTION 'tip_payout_wrong_payee' USING ERRCODE = '42501',
        DETAIL = 'a tip is paid to the Helpr it was given to';
    END IF;
  ELSIF v_kind = 'tip' THEN
    RAISE EXCEPTION 'tip_payment_needs_tip_payout' USING ERRCODE = '42501',
      DETAIL = 'a tip''s payment is paid out only by its tip payout';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_payouts_tip_link_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_payouts_tip_link_guard ON public.provider_payouts;
CREATE TRIGGER trg_provider_payouts_tip_link_guard
  BEFORE INSERT OR UPDATE ON public.provider_payouts
  FOR EACH ROW EXECUTE FUNCTION public.provider_payouts_tip_link_guard();

-- Step 1: the pending tip and its PayPal payment, in one transaction. Called by paypal-tip after
-- PayPal answered the order (the order key is deterministic, so a retry of the same attempt gets
-- the same order id from PayPal and the same rows here). The edge function has already checked
-- the job (completed, caller is its poster, the Helpr worked it, bans, payout hold, a payable
-- PayPal destination); this re-checks only what money depends on.
CREATE OR REPLACE FUNCTION public.paypal_open_tip(
  p_job_id uuid,
  p_tipper_id uuid,
  p_helper_id uuid,
  p_tip_cents bigint,
  p_charge_cents bigint,
  p_env text,
  p_idempotency_key text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pay public.provider_payments%ROWTYPE;
  v_tip_id uuid;
BEGIN
  IF p_tip_cents IS NULL OR p_tip_cents < 300 OR p_tip_cents > 100000 THEN
    RAISE EXCEPTION 'tip_amount_out_of_range' USING ERRCODE = '22023';
  END IF;
  -- The poster pays the processing cost on top; the Helpr's share is the tip itself.
  IF p_charge_cents IS NULL OR p_charge_cents <= p_tip_cents THEN
    RAISE EXCEPTION 'tip_charge_must_exceed_tip' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR position(':amt' || p_charge_cents::text || ':' IN p_idempotency_key || ':') = 0 THEN
    RAISE EXCEPTION 'tip_key_must_name_amount' USING ERRCODE = '22023';
  END IF;

  -- Serialize retries of one attempt.
  PERFORM pg_advisory_xact_lock(hashtextextended('paypal_open_tip:' || p_idempotency_key, 0));

  SELECT * INTO v_pay FROM public.provider_payments WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_pay.subject_kind <> 'tip' OR v_pay.provider_order_id <> p_order_id OR v_pay.amount_cents <> p_charge_cents
       OR v_pay.payer_id IS DISTINCT FROM p_tipper_id OR v_pay.env <> p_env THEN
      RAISE EXCEPTION 'tip_key_reused' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('tip_id', v_pay.subject_id, 'provider_payment_id', v_pay.id, 'status', v_pay.status, 'replay', true);
  END IF;

  INSERT INTO public.tips (job_id, tipper_id, helper_id, amount, payment_status, source)
  VALUES (p_job_id, p_tipper_id, p_helper_id, p_tip_cents / 100.0, 'pending', 'manual')
  RETURNING id INTO v_tip_id;

  -- paypal_entry_requires_switch refuses this for a payer the switch is off for.
  INSERT INTO public.provider_payments
    (subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status)
  VALUES ('tip', v_tip_id, p_tipper_id, 'paypal_checkout', p_env, p_idempotency_key, p_order_id, p_charge_cents, 'created')
  RETURNING * INTO v_pay;

  RETURN jsonb_build_object('tip_id', v_tip_id, 'provider_payment_id', v_pay.id, 'status', v_pay.status, 'replay', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_open_tip(uuid, uuid, uuid, bigint, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_open_tip(uuid, uuid, uuid, bigint, bigint, text, text, text) TO service_role;

-- Step 2: record what PayPal says about the tip's capture, and queue the tip's payout.
-- Idempotent: the return page and the webhook may both call it, any number of times, in any order.
--   p_outcome 'completed' : settled money. Payment captured, tip paid (notifies the Helpr once,
--                           notify_helper_on_tip), payout queued once.
--   p_outcome 'pending'   : PayPal captured but the money has not settled (e.g. an eCheck). Not
--                           funded: the tip stays pending and nothing is queued.
--   p_outcome 'failed'    : declined. Payment failed, tip failed (only while nothing settled).
-- Returns { tip_id, payment_status, tip_status, payout_id, payout_status, payout_reason }.
CREATE OR REPLACE FUNCTION public.paypal_record_tip_capture(
  p_provider_payment_id uuid,
  p_order_id text,
  p_outcome text,
  p_capture_id text,
  p_amount_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pay public.provider_payments%ROWTYPE;
  v_tip public.tips%ROWTYPE;
  v_dest text;
  v_payout_id uuid;
  v_payout_status text;
  v_reason text;
  v_held boolean;
BEGIN
  IF p_outcome NOT IN ('completed', 'pending', 'failed') THEN
    RAISE EXCEPTION 'tip_capture_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pay FROM public.provider_payments WHERE id = p_provider_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.subject_kind <> 'tip' THEN
    RAISE EXCEPTION 'tip_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.provider_order_id <> p_order_id THEN
    RAISE EXCEPTION 'tip_order_mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tip FROM public.tips WHERE id = v_pay.subject_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tip_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_outcome = 'failed' THEN
    -- A decline never undoes settled money (a stale "declined" after a later successful capture).
    IF v_pay.status IN ('created', 'approved') THEN
      UPDATE public.provider_payments SET status = 'failed', updated_at = now() WHERE id = v_pay.id;
      UPDATE public.tips SET payment_status = 'failed', failure_reason = 'paypal_capture_declined'
       WHERE id = v_tip.id AND payment_status = 'pending';
    END IF;
    SELECT * INTO v_pay FROM public.provider_payments WHERE id = v_pay.id;
    SELECT * INTO v_tip FROM public.tips WHERE id = v_tip.id;
    RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', v_tip.payment_status,
                              'payout_id', NULL, 'payout_status', NULL, 'payout_reason', 'not_captured');
  END IF;

  IF p_capture_id IS NULL OR btrim(p_capture_id) = '' THEN
    RAISE EXCEPTION 'tip_capture_id_required' USING ERRCODE = '22023';
  END IF;
  IF v_pay.provider_capture_id IS NOT NULL AND v_pay.provider_capture_id <> p_capture_id THEN
    RAISE EXCEPTION 'tip_capture_mismatch' USING ERRCODE = '42501',
      DETAIL = 'this tip already has a different capture';
  END IF;
  -- PayPal captured what the order was for, or we stop: a short capture must not read as paid.
  IF p_amount_cents IS DISTINCT FROM v_pay.amount_cents THEN
    RAISE EXCEPTION 'tip_capture_amount_mismatch' USING ERRCODE = '42501',
      DETAIL = format('captured %s, order was for %s', p_amount_cents, v_pay.amount_cents);
  END IF;

  IF v_pay.status IN ('created', 'approved', 'failed') OR (v_pay.status = 'capture_pending' AND p_outcome = 'completed') THEN
    UPDATE public.provider_payments
       SET status = CASE WHEN p_outcome = 'completed' THEN 'captured' ELSE 'capture_pending' END,
           provider_capture_id = p_capture_id,
           updated_at = now()
     WHERE id = v_pay.id;
  END IF;
  SELECT * INTO v_pay FROM public.provider_payments WHERE id = v_pay.id;

  -- Only settled money is a paid tip. A later refund/dispute state keeps the tip as it was.
  IF v_pay.status NOT IN ('captured', 'partially_refunded', 'refunded', 'disputed', 'reversed') THEN
    RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', v_tip.payment_status,
                              'payout_id', NULL, 'payout_status', NULL, 'payout_reason', 'not_settled');
  END IF;
  -- 'failed' -> 'paid' too: a stale decline answered before the real capture.
  UPDATE public.tips SET payment_status = 'paid', failure_reason = NULL
   WHERE id = v_tip.id AND payment_status <> 'paid';

  -- The tip's one payout (tip_id UNIQUE). Already queued: report it, change nothing.
  SELECT id, status INTO v_payout_id, v_payout_status FROM public.provider_payouts WHERE tip_id = v_tip.id;
  IF FOUND THEN
    RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', 'paid',
                              'payout_id', v_payout_id, 'payout_status', v_payout_status, 'payout_reason', 'already_queued');
  END IF;
  -- Money that has started back to the poster is not paid out.
  IF v_pay.status <> 'captured' THEN
    RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', 'paid',
                              'payout_id', NULL, 'payout_status', NULL, 'payout_reason', 'payment_' || v_pay.status);
  END IF;

  -- Where the Helpr is paid, for this payment's environment; copied onto the payout and frozen.
  SELECT a.paypal_email INTO v_dest
    FROM public.payee_accounts a
   WHERE a.user_id = v_tip.helper_id AND a.provider = 'paypal' AND a.env = v_pay.env
     AND a.payable AND a.paypal_email IS NOT NULL;
  IF v_dest IS NULL THEN
    -- Captured and owed, but nowhere to send it yet: the caller alerts ops; a later call queues it.
    RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', 'paid',
                              'payout_id', NULL, 'payout_status', NULL, 'payout_reason', 'no_payable_destination');
  END IF;

  -- The holds a job payout claim respects (refuse_payout_claim_while_held): a Helpr payout hold,
  -- or an open ban settlement review of either party. A held tip payout is recorded, not queued
  -- for payment: the pay queue shows only 'pending'.
  v_held := EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = v_tip.helper_id)
         OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                     WHERE q.review_state = 'open' AND q.user_id IN (v_tip.helper_id, v_tip.tipper_id));

  INSERT INTO public.provider_payouts
    (provider_payment_id, tip_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents, status)
  VALUES
    (v_pay.id, v_tip.id, v_tip.helper_id, 'manual_paypal', v_pay.env, 'paypal_email', v_dest,
     -- The Helpr receives the whole tip (tips.amount is dollars, CHECK > 0 and <= 1000).
     round(v_tip.amount * 100)::bigint,
     CASE WHEN v_held THEN 'held' ELSE 'pending' END)
  RETURNING id, status INTO v_payout_id, v_payout_status;
  v_reason := CASE WHEN v_held THEN 'held' ELSE 'queued' END;

  RETURN jsonb_build_object('tip_id', v_tip.id, 'payment_status', v_pay.status, 'tip_status', 'paid',
                            'payout_id', v_payout_id, 'payout_status', v_payout_status, 'payout_reason', v_reason);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_record_tip_capture(uuid, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_record_tip_capture(uuid, text, text, text, bigint) TO service_role;

COMMENT ON COLUMN public.provider_payouts.tip_id IS
  'Set on a tip payout (instead of payout_transfer_id): the tip it pays. UNIQUE: one payout per tip. Pays out of that tip''s own provider_payments row, to its Helpr, exactly the tip (the poster paid the processing cost on top).';
