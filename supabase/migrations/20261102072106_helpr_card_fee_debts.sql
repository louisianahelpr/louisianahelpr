-- Q2245 step a (owner MASTER-LIST 2026-10-21: "lapsed Helpr PAYS the card fee
-- on released paid series dates"; "fee from Helpr's NEXT payout"). A series
-- date whose Helpr's setup lapsed after its visit was paid is refunded to the
-- poster IN FULL (charge-recurring-visits' visit-date sweep, step b); the card
-- fee of that charge becomes a debt of the lapsed Helpr, taken from their next
-- job payout the same way an at-fault ruling's card fee is (20261019015303).
--
--   * public.helpr_card_fee_debts: one debt per visit payment (UNIQUE
--     recurring_visit_payment_id), so a re-run sweep never bills twice. Not
--     tied to an admin ruling (source 'series_visit_lapsed'); the Helpr reads
--     their own rows, like job_helpr_fault_rulings.
--   * public.helpr_card_fee_debt_deductions: one row per (payout, debt),
--     UNIQUE (payout_ref, debt_id), as job_helpr_fault_fee_deductions.
--   * public.bill_helpr_card_fee_debt(visit_payment, cents, refund_ref):
--     service_role only. Bills the visit payment's own Helpr ONCE (a replay
--     returns 0), capped at what the visit's charge was.
--   * take_helpr_fault_fee / restore_helpr_fault_fee are restated (newest
--     CREATE, 20261019015303) to read BOTH debts: same signatures, same
--     per-Helpr advisory lock, same per-job payout_ref, so every payout path
--     that already takes the fault fee (release-payout,
--     process-scheduled-payouts, execute-dispute-split) takes this debt too
--     without an edge change, and a retried payout still takes nothing twice.
--     Oldest debt first across both kinds.
-- Replay-safe: IF NOT EXISTS tables, CREATE OR REPLACE functions with the
-- same signatures, grants and policies restated by name.

CREATE TABLE IF NOT EXISTS public.helpr_card_fee_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A Helpr who deletes their account leaves the debt record behind.
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('series_visit_lapsed')),
  -- The paid visit whose full refund priced this debt. One debt per visit.
  recurring_visit_payment_id uuid UNIQUE REFERENCES public.recurring_visit_payments(id) ON DELETE SET NULL,
  -- The series (parent) job, for the Helpr's statement and the admin.
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  card_fee_cents integer NOT NULL CHECK (card_fee_cents > 0),
  remaining_cents integer NOT NULL,
  refund_ref text CHECK (refund_ref IS NULL OR char_length(refund_ref) BETWEEN 1 AND 200),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helpr_card_fee_debt_remaining CHECK (remaining_cents BETWEEN 0 AND card_fee_cents)
);
CREATE INDEX IF NOT EXISTS helpr_card_fee_debts_helper_idx ON public.helpr_card_fee_debts (helper_id, created_at);
ALTER TABLE public.helpr_card_fee_debts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_card_fee_debts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, helper_id, source, job_id, card_fee_cents, remaining_cents, created_at)
  ON TABLE public.helpr_card_fee_debts TO authenticated;
GRANT ALL ON TABLE public.helpr_card_fee_debts TO service_role;
DROP POLICY IF EXISTS "helpr card fee debts: the Helpr reads own" ON public.helpr_card_fee_debts;
CREATE POLICY "helpr card fee debts: the Helpr reads own" ON public.helpr_card_fee_debts
  FOR SELECT TO authenticated USING (helper_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "helpr card fee debts: admins read" ON public.helpr_card_fee_debts;
CREATE POLICY "helpr card fee debts: admins read" ON public.helpr_card_fee_debts
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.helpr_card_fee_debt_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.helpr_card_fee_debts(id) ON DELETE CASCADE,
  -- The payout this came out of: 'job_payout_<job id>'.
  payout_ref text NOT NULL CHECK (char_length(payout_ref) BETWEEN 1 AND 200),
  deducted_cents integer NOT NULL CHECK (deducted_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One payout takes from one debt at most once.
  CONSTRAINT helpr_card_fee_debt_deduction_once UNIQUE (payout_ref, debt_id)
);
CREATE INDEX IF NOT EXISTS helpr_card_fee_debt_deductions_debt_idx
  ON public.helpr_card_fee_debt_deductions (debt_id);
ALTER TABLE public.helpr_card_fee_debt_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_card_fee_debt_deductions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.helpr_card_fee_debt_deductions TO service_role;

CREATE OR REPLACE FUNCTION public.bill_helpr_card_fee_debt(
  p_visit_payment_id uuid,
  p_card_fee_cents integer,
  p_refund_ref text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row record;
  v_cents integer;
  v_id uuid;
BEGIN
  IF p_visit_payment_id IS NULL OR p_card_fee_cents IS NULL OR p_card_fee_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_debt' USING ERRCODE = '22023';
  END IF;
  -- FOR SHARE: the visit row (and its series, for is_seed) cannot change under the bill.
  SELECT v.id, v.helper_id, v.parent_job_id, v.amount_cents, v.stripe_payment_intent_id, j.is_seed
    INTO v_row
    FROM public.recurring_visit_payments v
    JOIN public.jobs j ON j.id = v.parent_job_id
   WHERE v.id = p_visit_payment_id
   FOR SHARE OF v, j;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Only a visit that was paid has a card fee, and only its own Helpr owes it.
  IF v_row.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'visit_payment_not_paid' USING ERRCODE = '22023';
  END IF;
  IF v_row.helper_id IS NULL THEN
    RAISE EXCEPTION 'visit_payment_no_helper' USING ERRCODE = '22023';
  END IF;
  -- Never more than the visit's charge.
  v_cents := least(p_card_fee_cents, v_row.amount_cents);
  INSERT INTO public.helpr_card_fee_debts
    (helper_id, source, recurring_visit_payment_id, job_id, card_fee_cents, remaining_cents, refund_ref, is_seed)
  VALUES
    (v_row.helper_id, 'series_visit_lapsed', v_row.id, v_row.parent_job_id, v_cents, v_cents,
     NULLIF(btrim(COALESCE(p_refund_ref, '')), ''), v_row.is_seed)
  ON CONFLICT (recurring_visit_payment_id) DO NOTHING
  RETURNING id INTO v_id;
  -- A replay (the visit already billed) bills nothing.
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE v_cents END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bill_helpr_card_fee_debt(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_helpr_card_fee_debt(uuid, integer, text) TO service_role;

-- Restated from 20261019015303: reads the at-fault rulings AND the card-fee
-- debts, oldest first across both.
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
  -- A retried payout: the first answer (both kinds), nothing taken twice.
  IF EXISTS (SELECT 1 FROM public.job_helpr_fault_fee_deductions x
               JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
              WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id)
     OR EXISTS (SELECT 1 FROM public.helpr_card_fee_debt_deductions x
                  JOIN public.helpr_card_fee_debts c ON c.id = x.debt_id
                 WHERE x.payout_ref = p_payout_ref AND c.helper_id = p_helper_id) THEN
    SELECT COALESCE((SELECT sum(x.deducted_cents) FROM public.job_helpr_fault_fee_deductions x
                       JOIN public.job_helpr_fault_rulings r ON r.id = x.ruling_id
                      WHERE x.payout_ref = p_payout_ref AND r.helper_id = p_helper_id), 0)::integer
         + COALESCE((SELECT sum(x.deducted_cents) FROM public.helpr_card_fee_debt_deductions x
                       JOIN public.helpr_card_fee_debts c ON c.id = x.debt_id
                      WHERE x.payout_ref = p_payout_ref AND c.helper_id = p_helper_id), 0)::integer
      INTO v_took;
    RETURN v_took;
  END IF;
  -- Row locks on everything this Helpr owes, before reading the amounts.
  PERFORM 1 FROM public.job_helpr_fault_rulings
   WHERE helper_id = p_helper_id AND card_fee_remaining_cents > 0 FOR UPDATE;
  PERFORM 1 FROM public.helpr_card_fee_debts
   WHERE helper_id = p_helper_id AND remaining_cents > 0 FOR UPDATE;
  FOR d IN
    SELECT 'ruling'::text AS kind, r.id, r.card_fee_remaining_cents AS remaining, r.created_at
      FROM public.job_helpr_fault_rulings r
     WHERE r.helper_id = p_helper_id AND r.card_fee_remaining_cents > 0
    UNION ALL
    SELECT 'card_fee_debt'::text, c.id, c.remaining_cents, c.created_at
      FROM public.helpr_card_fee_debts c
     WHERE c.helper_id = p_helper_id AND c.remaining_cents > 0
     ORDER BY created_at, kind, id
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, d.remaining);
    IF d.kind = 'ruling' THEN
      UPDATE public.job_helpr_fault_rulings
         SET card_fee_remaining_cents = card_fee_remaining_cents - v_take WHERE id = d.id;
      INSERT INTO public.job_helpr_fault_fee_deductions (ruling_id, payout_ref, deducted_cents)
      VALUES (d.id, p_payout_ref, v_take);
    ELSE
      UPDATE public.helpr_card_fee_debts
         SET remaining_cents = remaining_cents - v_take WHERE id = d.id;
      INSERT INTO public.helpr_card_fee_debt_deductions (debt_id, payout_ref, deducted_cents)
      VALUES (d.id, p_payout_ref, v_take);
    END IF;
    v_left := v_left - v_take;
    v_took := v_took + v_take;
  END LOOP;
  RETURN v_took;
END;
$fn$;
REVOKE ALL ON FUNCTION public.take_helpr_fault_fee(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_helpr_fault_fee(uuid, text, integer) TO service_role;

-- Restated from 20261019015303: gives back both kinds.
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

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
