-- Helpr-fault card-fee deduction: the booked amount follows the money
-- (lh-money-escrow reviews of c4ec33afb #5, b1730c932 #3 #5, the exact-cents
-- delta #5 #7).
--
-- take_helpr_fault_fee books what a payout keeps back BEFORE the transfer, and
-- restore_helpr_fault_fee gives it back when a run stops. Three ways the
-- booking and the money parted:
--   * a run stopping before its claim restored while another run, which had
--     already read the deduction, sent its transfer withholding it: the Helpr
--     was withheld the fee and still owed it (charged twice);
--   * a run adopting an orphaned transfer (sent by an earlier run, ledger row
--     never stamped) booked THIS run's take, not what that transfer withheld;
--   * a retried payout whose cap shrank (an onboarding fee now owed, or the
--     exact-cents cap) got the first, larger answer back, so the edge refused
--     it forever (a stuck payout).
--
-- public.set_helpr_fault_fee_withheld(helper, payout_ref, cents): service_role
-- only, SECURITY INVOKER. Makes the deduction rows of one payout total exactly
-- what that payout withheld: gives the excess back (newest ruling first) or
-- takes the shortfall from what is still owed (oldest first). Returns the cents
-- now booked; less than asked means the Helpr was withheld more than they owe,
-- which the caller pages. Every payout path calls it once money has moved,
-- with the transfer's own figure.
-- take_helpr_fault_fee: a repeat call whose cap is now smaller answers the cap
-- and gives the rest back (same function), never a figure over the cap.

CREATE OR REPLACE FUNCTION public.set_helpr_fault_fee_withheld(p_helper_id uuid, p_payout_ref text, p_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_have integer;
  v_diff integer;
  v_g integer;
  rw record;
BEGIN
  IF p_helper_id IS NULL OR p_payout_ref IS NULL OR btrim(p_payout_ref) = '' OR p_cents IS NULL OR p_cents < 0 THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('helpr_fault_fee:' || p_helper_id::text, 0));
  SELECT COALESCE(sum(x.deducted_cents), 0)::integer INTO v_have
    FROM public.job_helpr_fault_fee_deductions x
    JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
   WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id;
  v_diff := v_have - p_cents;
  IF v_diff > 0 THEN
    -- Booked more than was withheld: give the excess back, newest ruling first.
    FOR rw IN
      SELECT x.id, x.ruling_id, x.deducted_cents
        FROM public.job_helpr_fault_fee_deductions x
        JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
       WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id
       ORDER BY r.created_at DESC, r.id DESC
       FOR UPDATE OF x
    LOOP
      EXIT WHEN v_diff <= 0;
      v_g := least(v_diff, rw.deducted_cents);
      IF v_g = rw.deducted_cents THEN
        DELETE FROM public.job_helpr_fault_fee_deductions WHERE id = rw.id;
      ELSE
        UPDATE public.job_helpr_fault_fee_deductions SET deducted_cents = deducted_cents - v_g WHERE id = rw.id;
      END IF;
      UPDATE public.job_helpr_fault_rulings
         SET card_fee_remaining_cents = least(card_fee_cents, card_fee_remaining_cents + v_g)
       WHERE id = rw.ruling_id;
      v_diff := v_diff - v_g;
    END LOOP;
  ELSIF v_diff < 0 THEN
    -- Withheld more than is booked: book the rest against what is still owed.
    v_diff := -v_diff;
    FOR rw IN
      SELECT id, card_fee_remaining_cents FROM public.job_helpr_fault_rulings
       WHERE helper_id = p_helper_id AND card_fee_remaining_cents > 0
       ORDER BY created_at, id
       FOR UPDATE
    LOOP
      EXIT WHEN v_diff <= 0;
      v_g := least(v_diff, rw.card_fee_remaining_cents);
      UPDATE public.job_helpr_fault_rulings
         SET card_fee_remaining_cents = card_fee_remaining_cents - v_g WHERE id = rw.id;
      INSERT INTO public.job_helpr_fault_fee_deductions AS d (ruling_id, payout_ref, deducted_cents)
      VALUES (rw.id, p_payout_ref, v_g)
      ON CONFLICT ON CONSTRAINT job_helpr_fault_fee_deduction_once
        DO UPDATE SET deducted_cents = d.deducted_cents + EXCLUDED.deducted_cents;
      v_diff := v_diff - v_g;
    END LOOP;
  END IF;
  SELECT COALESCE(sum(x.deducted_cents), 0)::integer INTO v_have
    FROM public.job_helpr_fault_fee_deductions x
    JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
   WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id;
  RETURN v_have;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_helpr_fault_fee_withheld(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_helpr_fault_fee_withheld(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.take_helpr_fault_fee(p_helper_id uuid, p_payout_ref text, p_max_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_left integer := greatest(COALESCE(p_max_cents, 0), 0);
  v_took integer := 0;
  v_take integer;
  d record;
BEGIN
  IF p_helper_id IS NULL OR p_payout_ref IS NULL OR btrim(p_payout_ref) = '' THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('helpr_fault_fee:' || p_helper_id::text, 0));
  -- A retried payout: the first answer, nothing taken twice; never over this
  -- run's cap (a smaller cap gives the rest back).
  IF EXISTS (SELECT 1 FROM public.job_helpr_fault_fee_deductions x
               JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
              WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id) THEN
    SELECT COALESCE(sum(x.deducted_cents), 0)::integer INTO v_took
      FROM public.job_helpr_fault_fee_deductions x
      JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
     WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id;
    IF v_took > v_left THEN
      RETURN public.set_helpr_fault_fee_withheld(p_helper_id, p_payout_ref, v_left);
    END IF;
    RETURN v_took;
  END IF;
  FOR d IN
    SELECT id, card_fee_remaining_cents FROM public.job_helpr_fault_rulings
     WHERE helper_id = p_helper_id AND card_fee_remaining_cents > 0
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, d.card_fee_remaining_cents);
    UPDATE public.job_helpr_fault_rulings
       SET card_fee_remaining_cents = card_fee_remaining_cents - v_take WHERE id = d.id;
    INSERT INTO public.job_helpr_fault_fee_deductions (ruling_id, payout_ref, deducted_cents)
    VALUES (d.id, p_payout_ref, v_take);
    v_left := v_left - v_take;
    v_took := v_took + v_take;
  END LOOP;
  RETURN v_took;
END;
$fn$;
REVOKE ALL ON FUNCTION public.take_helpr_fault_fee(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_helpr_fault_fee(uuid, text, integer) TO service_role;
