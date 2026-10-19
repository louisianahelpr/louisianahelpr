-- Q2082 (b), owner pop-up 2026-10-18 ("J4"), slice b3: the card cost a Helpr
-- ruled at fault owes (job_helpr_fault_rulings.card_fee_remaining_cents, set by
-- bill_helpr_fault_card_fee when the poster's full refund priced it) comes out
-- of that Helpr's NEXT job payout. Copied from Declutter's seller fee debt
-- (declutter_consume_fee_debt, 20261014224914):
--   * public.job_helpr_fault_fee_deductions: one row per (payout, ruling); the
--     UNIQUE (payout_ref, ruling_id) means a retried payout never takes twice.
--     No person column: the Helpr is reached through the ruling.
--   * public.take_helpr_fault_fee(helper, payout_ref, max_cents): service_role
--     only. Returns the cents to keep back from that payout: never more than
--     p_max_cents (the caller passes what keeps the payout at $1 or more),
--     never more than is owed (remaining CHECK >= 0), oldest ruling first, and
--     the same payout_ref twice returns the first answer without taking again.
--     Serialized per Helpr (advisory lock, then row locks).
--   * public.restore_helpr_fault_fee(helper, job): service_role only. A payout
--     that stops BEFORE any money moved (the same exits that un-claim the
--     onboarding fee) gives what it took back, so the debt is never lost.

CREATE TABLE IF NOT EXISTS public.job_helpr_fault_fee_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruling_id uuid NOT NULL REFERENCES public.job_helpr_fault_rulings(id) ON DELETE CASCADE,
  -- The payout this came out of: 'job_payout_<job id>'.
  payout_ref text NOT NULL CHECK (char_length(payout_ref) BETWEEN 1 AND 200),
  deducted_cents integer NOT NULL CHECK (deducted_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One payout takes from one ruling's debt at most once.
  CONSTRAINT job_helpr_fault_fee_deduction_once UNIQUE (payout_ref, ruling_id)
);
CREATE INDEX IF NOT EXISTS job_helpr_fault_fee_deductions_ruling_idx
  ON public.job_helpr_fault_fee_deductions (ruling_id);
ALTER TABLE public.job_helpr_fault_fee_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_helpr_fault_fee_deductions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_helpr_fault_fee_deductions TO service_role;

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
  -- A retried payout: the first answer, nothing taken twice.
  IF EXISTS (SELECT 1 FROM public.job_helpr_fault_fee_deductions x
               JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
              WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id) THEN
    SELECT COALESCE(sum(x.deducted_cents), 0)::integer INTO v_took
      FROM public.job_helpr_fault_fee_deductions x
      JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
     WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id;
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
  IF EXISTS (SELECT 1 FROM public.payout_transfers pt
              WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id
                AND pt.status IN ('pending', 'paid', 'reversed')) THEN
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
