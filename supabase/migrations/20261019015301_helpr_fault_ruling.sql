-- Q2082 (b), owner pop-up 2026-10-18 ("J4"): HELPR FAULT. A poster reports a
-- no-show or a backout; an ADMIN confirms "Helpr at fault" in the dispute /
-- admin tools; the poster then gets a FULL refund (the card fee included) and
-- the Helpr is charged the card cost (a fee debt, like the Declutter seller's
-- defaulter fee) plus a strike.
--
-- This migration is the ruling itself (slice b1):
--   * public.job_helpr_fault_rulings: ONE ruling per job (UNIQUE job_id), so
--     a retry or a second admin can never rule twice; it carries the card
--     cost the Helpr owes once the refund has priced it.
--   * public.admin_rule_helpr_fault(job, helper, kind, note): admin-only,
--     audited (admin_audit_log), idempotent. It checks the Helpr was booked on
--     the job (the job's Helpr now, or the no-show / backout strike the report
--     left on this job), records the ruling, and makes sure the Helpr carries
--     exactly ONE strike for this job: report_helper_no_show ('no_show') and
--     helper_cancel_booking ('job_denial') already wrote one; only when
--     neither did is one added here.
--   * public.bill_helpr_fault_card_fee(job, cents, refund_ref): service_role
--     only, for the full-refund path (next slice): records what the Helpr owes
--     ONCE (a replay returns 0), capped at what the job's charge was.
-- The full refund and the payout deduction are the next slice (Q2082 (b)).

CREATE TABLE IF NOT EXISTS public.job_helpr_fault_rulings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- A Helpr who deletes their account leaves the ruling (and the job) behind.
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('no_show', 'backout')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  -- Set once, by bill_helpr_fault_card_fee, when the full refund is priced.
  card_fee_cents integer CHECK (card_fee_cents IS NULL OR card_fee_cents >= 0),
  card_fee_remaining_cents integer,
  refund_ref text CHECK (refund_ref IS NULL OR char_length(refund_ref) BETWEEN 1 AND 200),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_helpr_fault_fee_remaining CHECK (
    (card_fee_cents IS NULL AND card_fee_remaining_cents IS NULL)
    OR (card_fee_cents IS NOT NULL AND card_fee_remaining_cents BETWEEN 0 AND card_fee_cents))
);
CREATE INDEX IF NOT EXISTS job_helpr_fault_rulings_helper_idx ON public.job_helpr_fault_rulings (helper_id, created_at);
ALTER TABLE public.job_helpr_fault_rulings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_helpr_fault_rulings FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, job_id, helper_id, kind, card_fee_cents, card_fee_remaining_cents, created_at)
  ON TABLE public.job_helpr_fault_rulings TO authenticated;
GRANT ALL ON TABLE public.job_helpr_fault_rulings TO service_role;
DROP POLICY IF EXISTS "helpr fault rulings: the Helpr reads own" ON public.job_helpr_fault_rulings;
CREATE POLICY "helpr fault rulings: the Helpr reads own" ON public.job_helpr_fault_rulings
  FOR SELECT TO authenticated USING (helper_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "helpr fault rulings: admins read" ON public.job_helpr_fault_rulings;
CREATE POLICY "helpr fault rulings: admins read" ON public.job_helpr_fault_rulings
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.admin_rule_helpr_fault(
  p_job_id uuid,
  p_helper_id uuid,
  p_kind text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_job record;
  v_existing record;
  v_ruling uuid;
  v_strike_added boolean := false;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('no_show', 'backout') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- A ruling charges a person money: the next admin reading the log needs why.
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;
  IF p_helper_id IS NULL THEN
    RAISE EXCEPTION 'helper_required' USING ERRCODE = '22023';
  END IF;

  -- One ruling per job, decided under the job's row lock.
  SELECT j.id, j.title, j.helper_id, j.payment_status, j.is_seed
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.id, r.helper_id INTO v_existing
    FROM public.job_helpr_fault_rulings r WHERE r.job_id = p_job_id;
  IF v_existing.id IS NOT NULL THEN
    -- The same Helpr again (a retry), or the ruled Helpr's account is gone
    -- (helper_id set null): the ruling stands; the refund then keeps the card
    -- fee since nobody can be billed it (owner 2026-10-18 ~22:30Z).
    IF v_existing.helper_id IS NULL OR v_existing.helper_id = p_helper_id THEN
      RETURN jsonb_build_object('outcome', 'already_ruled', 'ruling_id', v_existing.id);
    END IF;
    RAISE EXCEPTION 'already_ruled_other_helper' USING ERRCODE = '23505';
  END IF;

  -- Only a paid job has money to give back in full.
  IF v_job.payment_status IS NULL OR v_job.payment_status IN ('unpaid', 'failed') THEN
    RAISE EXCEPTION 'job_not_paid' USING ERRCODE = '22023';
  END IF;

  -- The Helpr was booked here: still the job's Helpr, or the no-show report
  -- (which unassigns them) or their backout left a strike on this job.
  IF v_job.helper_id IS DISTINCT FROM p_helper_id AND NOT EXISTS (
       SELECT 1 FROM public.user_violations v
        WHERE v.user_id = p_helper_id AND v.job_id = p_job_id
          AND v.violation_type IN ('no_show', 'job_denial')) THEN
    RAISE EXCEPTION 'helper_not_booked' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.job_helpr_fault_rulings (job_id, helper_id, admin_id, kind, note, is_seed)
  VALUES (p_job_id, p_helper_id, v_admin, p_kind, btrim(p_note), COALESCE(v_job.is_seed, false))
  RETURNING id INTO v_ruling;

  -- Exactly one strike for this job: the report or the backout usually wrote it.
  IF NOT EXISTS (
       SELECT 1 FROM public.user_violations v
        WHERE v.user_id = p_helper_id AND v.job_id = p_job_id
          AND v.violation_type IN ('no_show', 'job_denial')) THEN
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken, reported_by)
    VALUES (p_helper_id,
            CASE p_kind WHEN 'no_show' THEN 'no_show' ELSE 'job_denial' END,
            'Helpr at fault (admin ruling): ' || COALESCE(v_job.title, 'job'),
            p_job_id, 'warning', v_admin);
    v_strike_added := true;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'helpr_fault_ruling', 'job', p_job_id::text,
          jsonb_build_object('ruling_id', v_ruling, 'helper_id', p_helper_id, 'kind', p_kind,
                             'note', btrim(p_note), 'strike_added', v_strike_added,
                             'payment_status', v_job.payment_status));

  RETURN jsonb_build_object('outcome', 'ruled', 'ruling_id', v_ruling, 'strike_added', v_strike_added);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_rule_helpr_fault(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rule_helpr_fault(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bill_helpr_fault_card_fee(
  p_job_id uuid,
  p_card_fee_cents integer,
  p_refund_ref text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_cap integer;
  v_fee integer;
BEGIN
  IF p_card_fee_cents IS NULL OR p_card_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee' USING ERRCODE = '22023';
  END IF;
  SELECT x.id, x.helper_id, x.card_fee_cents INTO r
    FROM public.job_helpr_fault_rulings x WHERE x.job_id = p_job_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'not_helpr_fault' USING ERRCODE = 'P0002';
  END IF;
  -- Billed once: a replay or a second refund never charges the Helpr again.
  IF r.card_fee_cents IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT ceil((COALESCE(jb.budget, 0) + COALESCE(jb.customer_fee_amount, 0) + COALESCE(jb.sales_tax_amount, 0)
               + COALESCE(jb.urgent_fee, 0) + COALESCE(jb.onboarding_fee_amount, 0)) * 100)::integer
    INTO v_cap FROM public.jobs jb WHERE jb.id = p_job_id FOR SHARE;
  v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));
  IF r.helper_id IS NULL AND v_fee > 0 THEN
    -- The Helpr's account is gone. create-payment reads that BEFORE the
    -- refund and then keeps the card fee (owner 2026-10-18: never absorbed)
    -- and bills 0; a Helpr deleted between that read and this bill is a
    -- defect the money owner must see, never silent.
    PERFORM public.log_cron_defect('bill_helpr_fault_card_fee', p_job_id::text,
      format('job %s: the Helpr ruled at fault was deleted while its full refund ran, so the %s-cent card fee the refund returned could not be billed: recover it by hand',
             p_job_id, v_fee));
    v_fee := 0;
  END IF;
  UPDATE public.job_helpr_fault_rulings
     SET card_fee_cents = v_fee, card_fee_remaining_cents = v_fee, refund_ref = left(p_refund_ref, 200)
   WHERE id = r.id;
  IF v_fee > 0 THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (r.helper_id, 'Card fee added',
            format('A job you were ruled at fault on (a no-show or a backout) was refunded to the poster in full. Its $%s card fee is added to what you owe; it comes out of your next payout.',
                   to_char(v_fee / 100.0, 'FM999999990.00')),
            'system_alert', '/profile?tab=earnings');
  END IF;
  RETURN v_fee;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) TO service_role;
