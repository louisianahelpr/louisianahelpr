-- Q2172 (b), (c), (d): two edge cases in how a payout gives back the
-- Helpr-fault / card-fee debt it withheld (lead 11-02: build B1 and C1 + the
-- clamp).
--
--   (b) restore_helpr_fault_fee refused whenever ANY payout_transfers row for
--       (job, Helpr) was 'pending', 'paid' or 'reversed'. A reversed transfer
--       gave the Helpr nothing (the money came back), so the deduction it
--       carried was not really collected; yet after one, a later failed attempt
--       could never give its deduction back: the debt read paid while nothing
--       was withheld. Now only a 'pending' (in flight) or 'paid' row blocks the
--       restore. The next payout takes the debt again under the same per-job
--       payout_ref, so nothing is taken twice.
--   (c)/(d) clamp_helpr_fault_fee(helper, job, cents), service_role only: gives
--       back whatever this job's payout booked above `cents`, newest debt first
--       (the reverse of take's oldest-first order), and returns what stays
--       booked (min of the two). Used by the payout paths (_shared/helprFaultFee.ts):
--         * a run that RESUMES or ADOPTS another run's claim never calls take;
--           it clamps to the cents that claim recorded it withholds, so a debt
--           billed in between is never booked as collected (c);
--         * a retry whose cap shrank (the setup fee owed on the second run, or
--           the exact-cents cap) gets the first, larger answer from take; it
--           now clamps to the current cap instead of refusing forever (d).
--       Refuses (55000) once a 'paid' transfer for the job carries the
--       deduction: what a sent payout withheld is never given back.
--
-- take_helpr_fault_fee is unchanged (20261102072106 stays its newest CREATE).
-- restore_helpr_fault_fee is restated from 20261102072106 with only the
-- status list changed. Same per-Helpr advisory lock as take/restore.
-- Replay-safe: CREATE OR REPLACE with the same signatures; grants restated.

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
  -- Q2172 (b): a reversed transfer carried nothing the Helpr kept, so only a
  -- payout in flight or paid keeps the deduction.
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id
                AND pt.status IN ('pending', 'paid')) THEN
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
  FOR x IN
    DELETE FROM public.helpr_card_fee_debt_deductions d
     USING public.helpr_card_fee_debts c
     WHERE d.payout_ref = 'job_payout_' || p_job_id::text
       AND c.id = d.debt_id AND c.helper_id = p_helper_id
    RETURNING d.debt_id, d.deducted_cents
  LOOP
    UPDATE public.helpr_card_fee_debts
       SET remaining_cents = least(card_fee_cents, remaining_cents + x.deducted_cents)
     WHERE id = x.debt_id;
    v_back := v_back + x.deducted_cents;
  END LOOP;
  RETURN v_back;
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_helpr_fault_fee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_helpr_fault_fee(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clamp_helpr_fault_fee(p_helper_id uuid, p_job_id uuid, p_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref text;
  v_total integer;
  v_excess integer;
  v_back integer;
  x record;
BEGIN
  IF p_helper_id IS NULL OR p_job_id IS NULL OR p_cents IS NULL OR p_cents < 0 THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  v_ref := 'job_payout_' || p_job_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended('helpr_fault_fee:' || p_helper_id::text, 0));
  -- What a sent payout withheld stays collected.
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id AND pt.status = 'paid') THEN
    RAISE EXCEPTION 'payout_already_paid' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.job_helpr_fault_rulings WHERE helper_id = p_helper_id FOR UPDATE;
  PERFORM 1 FROM public.helpr_card_fee_debts WHERE helper_id = p_helper_id FOR UPDATE;
  SELECT COALESCE((SELECT sum(d.deducted_cents) FROM public.job_helpr_fault_fee_deductions d
                     JOIN public.job_helpr_fault_rulings r ON r.id = d.ruling_id
                    WHERE d.payout_ref = v_ref AND r.helper_id = p_helper_id), 0)::integer
       + COALESCE((SELECT sum(d.deducted_cents) FROM public.helpr_card_fee_debt_deductions d
                     JOIN public.helpr_card_fee_debts c ON c.id = d.debt_id
                    WHERE d.payout_ref = v_ref AND c.helper_id = p_helper_id), 0)::integer
    INTO v_total;
  IF v_total <= p_cents THEN
    RETURN v_total;
  END IF;
  v_excess := v_total - p_cents;
  -- Newest debt first: the reverse of take's (created_at, kind, id) order, so
  -- the debts that stay booked are the oldest, as a smaller take would have chosen.
  FOR x IN
    SELECT 'ruling'::text AS kind, d.id, d.ruling_id AS debt_id, d.deducted_cents, r.created_at
      FROM public.job_helpr_fault_fee_deductions d
      JOIN public.job_helpr_fault_rulings r ON r.id = d.ruling_id
     WHERE d.payout_ref = v_ref AND r.helper_id = p_helper_id
    UNION ALL
    SELECT 'card_fee_debt'::text, d.id, d.debt_id, d.deducted_cents, c.created_at
      FROM public.helpr_card_fee_debt_deductions d
      JOIN public.helpr_card_fee_debts c ON c.id = d.debt_id
     WHERE d.payout_ref = v_ref AND c.helper_id = p_helper_id
     ORDER BY created_at DESC, kind DESC, debt_id DESC
  LOOP
    EXIT WHEN v_excess <= 0;
    v_back := least(v_excess, x.deducted_cents);
    IF x.kind = 'ruling' THEN
      IF v_back = x.deducted_cents THEN
        DELETE FROM public.job_helpr_fault_fee_deductions WHERE id = x.id;
      ELSE
        UPDATE public.job_helpr_fault_fee_deductions SET deducted_cents = deducted_cents - v_back WHERE id = x.id;
      END IF;
      UPDATE public.job_helpr_fault_rulings
         SET card_fee_remaining_cents = least(card_fee_cents, card_fee_remaining_cents + v_back)
       WHERE id = x.debt_id;
    ELSE
      IF v_back = x.deducted_cents THEN
        DELETE FROM public.helpr_card_fee_debt_deductions WHERE id = x.id;
      ELSE
        UPDATE public.helpr_card_fee_debt_deductions SET deducted_cents = deducted_cents - v_back WHERE id = x.id;
      END IF;
      UPDATE public.helpr_card_fee_debts
         SET remaining_cents = least(card_fee_cents, remaining_cents + v_back)
       WHERE id = x.debt_id;
    END IF;
    v_excess := v_excess - v_back;
  END LOOP;
  RETURN p_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clamp_helpr_fault_fee(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clamp_helpr_fault_fee(uuid, uuid, integer) TO service_role;
