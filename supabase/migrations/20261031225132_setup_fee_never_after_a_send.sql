-- The one-time setup fee is never taken from a payout a send was already tried for (review of the B49 rebuild,
-- 10-31, finding (2), MEDIUM, money; ~/.lh-shots/verdicts/b31-b49.txt).
--
-- declutter_payout_take_setup_fee (20261031214749) and helpr_task_payout_take_setup_fee (20261031220617) lower a
-- payout by the $2 right before its transfer, and skip a row with attempts > 0 because its Stripe key
-- (declutter-payout-<id> / helpr-task-payout-<id>) may already have gone out with the old amount. But main's
-- 20261031200034 puts attempts back to 0 on a rebook (declutter_rebook_payout) and when an admin releases a held
-- payout (admin_payout_release). Such a row could then get the fee taken and be resent with a NEW amount under the
-- SAME key: Stripe refuses that (an idempotency key reused with other parameters), so the payout sticks.
--
-- Fix: a marker the reset cannot clear.
--   * declutter_payouts.send_tried / helpr_task_payouts.send_tried (boolean, default false), kept true by a BEFORE
--     INSERT OR UPDATE trigger once attempts was ever above 0: a reset to 0 leaves it true, and nothing sets it false.
--   * Backfilled true for any row that shows a send was tried: attempts > 0, a last_error, an executed_at, a
--     review_held_at, a stripe_transfer_id, or a payout_send_marks row (the mark payout_mark_sending writes before
--     every transfer, kept while the row is pending, failed or held for review).
--   * Both take functions also skip a row with send_tried or with a send mark. Restated from their newest CREATE
--     (20261031214749 and 20261031220617, both only on this branch); the one guard line is the only change.
-- Behind identity_check as before: with the switch off both functions take nothing (declutter_setup_fee_from_payout_cents
-- answers 0 for an exempt member), so this changes no amount on prod today. The column is server-only (no grant).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, grants restated.
-- Proof: src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs and helprSetupFeeFromPayout.pglite.mjs (this file 3x after
-- theirs; FOLLOWUP=skip is red on the new cases).

ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS send_tried boolean NOT NULL DEFAULT false;
ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS send_tried boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.payout_send_tried_sticky()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.send_tried := COALESCE(NEW.send_tried, false) OR COALESCE(NEW.attempts, 0) > 0
    OR (TG_OP = 'UPDATE' AND (OLD.send_tried OR COALESCE(OLD.attempts, 0) > 0));
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_send_tried_sticky() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_payouts_send_tried ON public.declutter_payouts;
CREATE TRIGGER trg_declutter_payouts_send_tried BEFORE INSERT OR UPDATE ON public.declutter_payouts
  FOR EACH ROW EXECUTE FUNCTION public.payout_send_tried_sticky();
DROP TRIGGER IF EXISTS trg_helpr_task_payouts_send_tried ON public.helpr_task_payouts;
CREATE TRIGGER trg_helpr_task_payouts_send_tried BEFORE INSERT OR UPDATE ON public.helpr_task_payouts
  FOR EACH ROW EXECUTE FUNCTION public.payout_send_tried_sticky();

UPDATE public.declutter_payouts p SET send_tried = true
 WHERE NOT p.send_tried
   AND (p.attempts > 0 OR p.last_error IS NOT NULL OR p.executed_at IS NOT NULL OR p.review_held_at IS NOT NULL
        OR p.stripe_transfer_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id));
UPDATE public.helpr_task_payouts p SET send_tried = true
 WHERE NOT p.send_tried
   AND (p.attempts > 0 OR p.last_error IS NOT NULL OR p.executed_at IS NOT NULL OR p.review_held_at IS NOT NULL
        OR p.stripe_transfer_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'helpr_task' AND m.payout_id = p.id));

CREATE OR REPLACE FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- A row a send was ever tried for keeps its amount, even after a rebook or a release put attempts back to 0: its
  -- Stripe key (declutter-payout-<id>) may already carry the old amount.
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.send_tried
     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id) THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(p.seller_id);
  IF v_fee <= 0 OR p.amount_cents - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = p.seller_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.declutter_payouts
     SET setup_fee_cents = v_fee, debt_cents = debt_cents + v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(p.seller_id, 'payment', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your payout for %s, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), public.declutter_order_items_named(p.order_id), to_char(v_amount / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', NULL);
  RETURN v_amount;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_take_setup_fee(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.helpr_task_payouts;
  v_raised integer;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.helpr_task_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- A row a send was ever tried for keeps its amount, even after a release put attempts back to 0: its Stripe key
  -- (helpr-task-payout-<id>) may already carry the old amount.
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.helpr_id IS NULL OR p.send_tried
     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'helpr_task' AND m.payout_id = p.id) THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(p.helpr_id);
  SELECT COALESCE(t.raised_cents, 0) INTO v_raised FROM public.helpr_tasks t WHERE t.id = p.task_id;
  IF v_fee <= 0 OR p.amount_cents - COALESCE(v_raised, 0) - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = p.helpr_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.helpr_task_payouts
     SET setup_fee_cents = v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(p.helpr_id, 'payment', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your delivery payout, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), to_char(v_amount / 100.0, 'FM999990.00')),
    '/declutter?tab=deliver', NULL);
  RETURN v_amount;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) TO service_role;
