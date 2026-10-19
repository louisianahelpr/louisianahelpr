-- A Helpr-fault card-fee deduction is given back when the job ends with no
-- payout that kept it.
--
-- WHAT WAS BROKEN: take_helpr_fault_fee books the debt as collected the moment a
-- payout run decides to withhold it (job_helpr_fault_fee_deductions), and
-- restore_helpr_fault_fee gave it back only from a payout run's own in-run
-- exits. Three ways a job ended with nothing withheld while the rows stayed:
--   1. the job was refunded in full (Quick Refund, an admin refund, the void
--      sweep, the Stripe Dashboard) after a payout attempt took the debt and
--      stopped unclear: no transfer ever kept the fee;
--   2. the transfer that withheld it was FULLY reversed (a card-dispute
--      clawback, a manual reversal): every cent came back to the platform, so
--      nothing was collected from the Helpr;
--   3. restore refused on ANY 'reversed' payout_transfers row, so a later
--      failed attempt after a fully reversed one lost the deduction too.
-- In every case the debt read collected while nothing was withheld: a fee the
-- platform absorbed (owner rule: never absorb a fee).
--
-- THE FIX:
--   * restore_helpr_fault_fee: a 'reversed' row whose metadata says
--     fully_reversed = true (stripe-webhook transferReversed writes it from
--     Stripe's own amount_reversed) no longer blocks the give-back; a PARTIAL
--     reversal still does (the Helpr kept part of a transfer that withheld the
--     fee: a person settles it, money-reconciliation pages it).
--   * restore_helpr_fault_fee_for_job(job): service_role only. Gives back every
--     Helpr's deduction on the job's payout, but only once the job has ENDED
--     without a payout (payment_status 'refunded' or 'chargeback', or a fully
--     reversed transfer on it), and only through restore_helpr_fault_fee, so a
--     live pending/paid row still refuses. It also stands down while a failed
--     payout row says its transfer error was unclear
--     (metadata.helpr_fault_fee_kept_cents > 0: money may have moved).
--     Called by stripe-webhook charge.refunded (every full refund lands
--     there), transferReversed (a full reversal that is not a dispute
--     clawback: a won dispute repays the reversed amount, already net of the
--     fee) and charge.dispute.closed LOST only ('chargeback' is set when a
--     dispute OPENS, so no caller may run it before the outcome). Anything it
--     cannot give back (a stuck pending claim, an unclear failed attempt) is
--     paged by money-reconciliation's helpr_fault_deduction_not_collected
--     check for a person to settle.
-- No new table, no index, no client grant.

CREATE OR REPLACE FUNCTION public.restore_helpr_fault_fee(p_helper_id uuid, p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_back integer := 0;
  x record;
BEGIN
  IF p_helper_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('helpr_fault_fee:' || p_helper_id::text, 0));
  -- A live or settled payout keeps the deduction. A FULLY reversed transfer
  -- returned every cent, so it collected nothing and does not.
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id
                AND (pt.status IN ('pending', 'paid')
                     OR (pt.status = 'reversed'
                         AND COALESCE(pt.metadata->>'fully_reversed', 'false') <> 'true'))) THEN
    RETURN 0;
  END IF;
  FOR x IN
    DELETE FROM public.job_helpr_fault_fee_deductions d
     USING public.job_helpr_fault_rulings r
     WHERE d.payout_ref = 'job_payout_' || p_job_id::text
       AND r.id = d.ruling_id AND r.helper_id = p_helper_id
    RETURNING d.ruling_id, d.deducted_cents
  LOOP
    -- Capped by the CHECK (remaining <= card_fee_cents): never more back than was billed.
    UPDATE public.job_helpr_fault_rulings
       SET card_fee_remaining_cents = least(card_fee_cents, card_fee_remaining_cents + x.deducted_cents)
     WHERE id = x.ruling_id;
    v_back := v_back + x.deducted_cents;
  END LOOP;
  RETURN v_back;
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_helpr_fault_fee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_helpr_fault_fee(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_helpr_fault_fee_for_job(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_back integer := 0;
  v_ended boolean;
  h record;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  SELECT (j.payment_status::text IN ('refunded', 'chargeback'))
         OR EXISTS (SELECT 1 FROM public.payout_transfers pt
                     WHERE pt.job_id = p_job_id AND pt.status = 'reversed'
                       AND COALESCE(pt.metadata->>'fully_reversed', 'false') = 'true')
    INTO v_ended
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT COALESCE(v_ended, false) THEN
    RETURN 0;
  END IF;
  -- A payout attempt whose transfer error was UNCLEAR (release-payout and
  -- process-scheduled-payouts stamp its failed row with
  -- metadata.helpr_fault_fee_kept_cents) may have moved money with the fee
  -- held back: never given back blind. money-reconciliation pages it and a
  -- person checks Stripe first.
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = p_job_id AND pt.status = 'failed'
                AND COALESCE((pt.metadata->>'helpr_fault_fee_kept_cents')::numeric, 0) > 0) THEN
    RETURN 0;
  END IF;
  FOR h IN
    SELECT DISTINCT r.helper_id
      FROM public.job_helpr_fault_fee_deductions d
      JOIN public.job_helpr_fault_rulings r ON r.id = d.ruling_id
     WHERE d.payout_ref = 'job_payout_' || p_job_id::text AND r.helper_id IS NOT NULL
  LOOP
    v_back := v_back + COALESCE(public.restore_helpr_fault_fee(h.helper_id, p_job_id), 0);
  END LOOP;
  RETURN v_back;
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_helpr_fault_fee_for_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_helpr_fault_fee_for_job(uuid) TO service_role;
