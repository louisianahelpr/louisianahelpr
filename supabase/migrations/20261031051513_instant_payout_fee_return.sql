-- Jobs audit 54a: a failed instant cash-out whose fee was already taken left
-- Cash Out pressable, and the next press took a second fee. The row could not
-- even say whether a fee had left the Helpr's balance (that lived only as
-- words in error_message), so nothing could refuse the second press.
--
-- instant_payouts.fee_state is what happened to THIS attempt's fee:
--   none        no fee was due
--   attempting  the fee transfer is about to be made, or its outcome is unknown
--   taken       the fee left the Helpr's balance and no payout is known to have gone
--   not_taken   the fee transfer did not happen
--   kept        the payout went out, so the fee was earned
--   returned    the transfer was reversed back to the Helpr's balance
--
-- The last line of defence is the trigger. instant_payouts_one_pending_per_helper
-- already allows one attempt at a time, and it runs AFTER INSERT on purpose: once
-- the unique index has let this row in, every other attempt of this Helpr has
-- committed its outcome, so this check reads that outcome and not an in-flight one.
-- A BEFORE trigger could read the earlier attempt as still pending, then have it
-- commit a taken fee, and let a second fee through.

ALTER TABLE public.instant_payouts
  ADD COLUMN IF NOT EXISTS fee_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fee_transfer_id text,
  ADD COLUMN IF NOT EXISTS fee_reversal_id text;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instant_payouts'::regclass AND conname = 'ck_instant_payouts_fee_state'
  ) THEN
    ALTER TABLE public.instant_payouts
      ADD CONSTRAINT ck_instant_payouts_fee_state
      CHECK (fee_state IN ('none', 'attempting', 'taken', 'not_taken', 'kept', 'returned'));
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_instant_payouts_fee_owed
  ON public.instant_payouts (helper_id)
  WHERE fee_state IN ('attempting', 'taken');

CREATE OR REPLACE FUNCTION public.refuse_instant_payout_while_fee_owed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.instant_payouts p
    WHERE p.helper_id = NEW.helper_id
      AND p.id <> NEW.id
      AND p.fee_state IN ('attempting', 'taken')
  ) THEN
    RAISE EXCEPTION 'instant_payout_fee_unresolved' USING ERRCODE = 'IP001';
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.refuse_instant_payout_while_fee_owed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS instant_payouts_refuse_while_fee_owed ON public.instant_payouts;
CREATE TRIGGER instant_payouts_refuse_while_fee_owed
  AFTER INSERT ON public.instant_payouts
  FOR EACH ROW EXECUTE FUNCTION public.refuse_instant_payout_while_fee_owed();
