-- The delivery Helpr's one-time setup fee comes out of their first payout (owner 2026-10-30: "Delivery Helpr: ID when
-- taking a delivery; $2 from first payout", the lead's reading; once per account, ever, across all of Helpr).
-- The same way as the seller's (20261031214749, Builder 49's 20261031002445 rebuilt). The switch `identity_check` stays OFF: while it is off,
-- declutter_setup_fee_from_payout_cents answers 0 for every member, so no row and no amount changes.
--
--   * helpr_task_payout_take_setup_fee, called by declutter-money right before the transfer, claims the fee and lowers
--     that payout by it. Only then: the delivery is confirmed and the send is certain.
--
-- How the money is recorded: the fee has its own column, and the amount CHECK subtracts it. fee_cents stays the
-- advertised 5% + 70c, and pay - fee rounded down stays what the delivery earned. The transfer is $2 smaller than the
-- charge funds, and the platform keeps the difference.
--
-- Comes out of the order's part only. A raise part and a held tip are each sent whole from their own charge, so a payout
-- whose order part could not still send at least $1 keeps its amount: the flag stays unset for the next payout.
-- Never touched: a row with a try already used (attempts > 0). Its Stripe idempotency key was sent with the old amount,
-- and a new amount under that key is refused. The fee then waits for the next payout.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS then ADD, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/helprSetupFeeFromPayout.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- REBUILT 2026-10-31 (LEAD-B49-REBUILD, Builder 31) from Builder 49's 20261031014752 (wip/b49-1030-id-rulings), which
-- never landed. Same SQL, new timestamp. It restates no function; the one constraint it replaces,
-- helpr_task_payouts_amount, is still newest in 20261021181118 on origin/main 492d2b3241 (B49's base).
-- The fee is only taken once declutter-money calls helpr_task_payout_take_setup_fee (the edge part of this rebuild).

ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'helpr_task_payouts_setup_fee'
                   AND conrelid = 'public.helpr_task_payouts'::regclass) THEN
    ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_setup_fee
      CHECK (setup_fee_cents >= 0 AND setup_fee_cents <= 10000);
  END IF;
END
$do$;
COMMENT ON COLUMN public.helpr_task_payouts.setup_fee_cents IS
  'The one-time account setup fee taken out of this payout (owner 2026-10-30). Subtracted in the amount CHECK. 0 for almost every row.';
GRANT SELECT (setup_fee_cents) ON TABLE public.helpr_task_payouts TO authenticated;

ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_amount;
ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_amount
  CHECK (amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - setup_fee_cents AND amount_cents >= 0);

-- Right before the transfer: take the fee once and answer the amount to send. Idempotent: a row that already carries the
-- fee answers its stored amount, so a retry sends the same amount under the same Stripe key.
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
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.helpr_id IS NULL THEN
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
    '/declutter?view=deliver', NULL);
  RETURN v_amount;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) TO service_role;
