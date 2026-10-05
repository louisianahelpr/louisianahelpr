-- Q1222: a tip paid while its Helpr is on a payout hold is held back, then
-- re-paid once the hold is released.
--
-- WHAT WAS BROKEN. A tip is a destination charge: Stripe moves it to the
-- Helpr the moment the poster pays. create-payment checks the payout hold
-- when it OPENS the tip Checkout, so a session opened before a hold and paid
-- after it still paid the held Helpr (lh-money-escrow review of Q764).
--
-- THE DECISION (lead, 2026-10-04). Tips are final (Q781, owner): the poster is
-- never refunded. Instead checkout.session.completed reverses the tip's
-- transfer back to the platform, and process-scheduled-payouts (a scheduled
-- money cron) re-pays it, idempotently, once the hold is released. Each held
-- tip gets ONE row here: the claim row both sides move through.
--
--   owed          the tip was paid while the Helpr was held; its transfer
--                 (transfer_id) is about to be reversed
--   reversed      the transfer came back to the platform (reversal_id)
--   repaying      the re-drive claimed it and is calling Stripe
--   repaid        re-paid to the Helpr (repay_transfer_id)
--   failed        the re-pay was refused by Stripe (failure_reason); a person
--   not_reversed  the reversal was refused by Stripe; the Helpr kept the
--                 money while held (failure_reason); a person
--   kept          the hold was released before the reversal ever ran, so
--                 the Helpr simply keeps the tip
--
-- ON DELETE RESTRICT on tip_id: the debt record must not vanish with its tip,
-- so a job delete that cascades to a held tip fails (23503) until a person
-- settles that tip (noted on Q1222).
--
-- Server-only: RLS on with no policy, no client grants. The row says a Helpr
-- is on hold, which is staff business (the tip refusal does not name it).
--
-- REPLAY-SAFETY: CREATE TABLE IF NOT EXISTS; constraints inline; REVOKE/GRANT
-- restated.

CREATE TABLE IF NOT EXISTS public.tip_hold_redrives (
  tip_id            uuid PRIMARY KEY REFERENCES public.tips(id) ON DELETE RESTRICT,
  helper_id         uuid NOT NULL,
  transfer_id       text NOT NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  status            text NOT NULL DEFAULT 'owed'
                    CHECK (status IN ('owed', 'reversed', 'repaying', 'repaid', 'failed', 'not_reversed', 'kept')),
  reversal_id       text,
  repay_transfer_id text UNIQUE,
  failure_reason    text,
  -- The first time the re-drive claimed it with the Helpr clear: the clock
  -- money-reconciliation's held_money_not_redriven measures from (updated_at
  -- moves on every hourly attempt, so it can never age).
  first_repay_attempt_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tip_hold_redrives_open_idx
  ON public.tip_hold_redrives (status, updated_at)
  WHERE status IN ('owed', 'reversed', 'repaying');

ALTER TABLE public.tip_hold_redrives ENABLE ROW LEVEL SECURITY;
-- Q807: every public table carries the unconfirmed-email write gate.
SELECT public.attach_unconfirmed_email_gate();

REVOKE ALL ON TABLE public.tip_hold_redrives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tip_hold_redrives TO service_role;

-- Q1223: a WON chargeback's re-pay that a payout hold (or an unreadable hold)
-- stopped is OWED from this moment; process-scheduled-payouts re-drives every
-- row with it set once the Helpr's hold is gone, and clears it on the re-pay
-- (or when Stripe refuses it, which pages a person). Its own column, so a
-- failure_reason written by a later attempt can never erase the debt.
DO $$
BEGIN
  IF to_regclass('public.chargeback_clawbacks') IS NOT NULL THEN
    ALTER TABLE public.chargeback_clawbacks ADD COLUMN IF NOT EXISTS held_repay_owed_at timestamptz;
    -- The re-drive's first attempt with the Helpr clear (see first_repay_attempt_at above).
    ALTER TABLE public.chargeback_clawbacks ADD COLUMN IF NOT EXISTS held_repay_first_attempt_at timestamptz;
    CREATE INDEX IF NOT EXISTS chargeback_clawbacks_held_repay_owed_idx
      ON public.chargeback_clawbacks (held_repay_owed_at)
      WHERE held_repay_owed_at IS NOT NULL;
  END IF;
END
$$;
