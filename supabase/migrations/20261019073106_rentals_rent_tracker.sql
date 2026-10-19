-- HOMES: the rent tracker, PAY DIRECT (owner D2, 2026-10-18; R1-R5 in
-- docs/specs/landlord-hub-prep.md). No money moves through the app here: the
-- tenant pays the landlord directly (Zelle, Venmo, Cash App, cash, check, money
-- order) and the app keeps ONE record both sides see. The in-app bank option
-- with autopay (D2/D7/D9) is a later, separate slice.
--
--   rental_rent_plans     one per tenancy, set by the landlord: amount, how
--                         often (weekly / every 2 weeks / monthly), the first
--                         due date (monthly: day 1-28, so every month has it),
--                         grace days and a flat late fee (D10: the amount is up
--                         to the landlord; the app shows a warning, no cap),
--                         and which direct ways the landlord takes.
--   rental_rent_charges   what is owed: one 'rent' row per due date (written on
--                         its due date by the daily sweep) and at most one
--                         'late_fee' row per rent row (written once the grace
--                         days pass with that rent still unpaid). The landlord
--                         may waive a charge (kept, marked waived).
--   rental_rent_payments  what was paid: the tenant reports "I paid"
--                         (reported -> the landlord confirms "Rent received" or
--                         declines with a reason), or the landlord records a
--                         payment directly (confirmed at once). Partial
--                         payments are fine (D11).
-- Balance = charges due and not waived - confirmed payments, oldest first.
--
-- Rules: the 'rentals' switch, a member who is not banned or under 18
-- (rentals_assert_member), the tenancy's own landlord or its tenant only. The
-- tables are read through rentals_rent_ledger (RLS SELECT for the two sides as
-- well, no client writes). Formal late or eviction notices are never sent by
-- the app (Q33): the reminders are friendly ones only.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF
-- EXISTS, the cron job upserts by name. Proof: src/test/pglite/homesRentTracker.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. Tables.
CREATE TABLE IF NOT EXISTS public.rental_rent_plans (
  tenancy_id uuid PRIMARY KEY REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 10000000),
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  first_due_on date NOT NULL,
  grace_days smallint NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 30),
  late_fee_cents integer NOT NULL DEFAULT 0 CHECK (late_fee_cents BETWEEN 0 AND 10000000),
  pay_methods text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (pay_methods <@ ARRAY['zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order']::text[]),
  reminded_for date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_plans_monthly_day CHECK (frequency <> 'monthly' OR extract(day FROM first_due_on) <= 28)
);

CREATE TABLE IF NOT EXISTS public.rental_rent_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rent', 'late_fee')),
  due_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  rent_charge_id uuid REFERENCES public.rental_rent_charges(id) ON DELETE CASCADE,
  waived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_charges_fee_has_rent CHECK ((kind = 'late_fee') = (rent_charge_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_rent_charges_one_rent_per_due ON public.rental_rent_charges (tenancy_id, due_on) WHERE kind = 'rent';
CREATE UNIQUE INDEX IF NOT EXISTS rental_rent_charges_one_fee_per_rent ON public.rental_rent_charges (rent_charge_id) WHERE kind = 'late_fee';

CREATE TABLE IF NOT EXISTS public.rental_rent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other')),
  reported_by text NOT NULL CHECK (reported_by IN ('tenant', 'landlord')),
  status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'confirmed', 'declined')),
  decided_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_payments_decided CHECK ((status = 'reported') = (decided_at IS NULL)),
  CONSTRAINT rental_rent_payments_declined_reason CHECK ((status = 'declined') = (decline_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rental_rent_payments_tenancy_idx ON public.rental_rent_payments (tenancy_id, paid_on);
CREATE INDEX IF NOT EXISTS rental_rent_charges_tenancy_idx ON public.rental_rent_charges (tenancy_id, due_on);

ALTER TABLE public.rental_rent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_rent_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rental_rent_plans TO authenticated;
GRANT ALL ON TABLE public.rental_rent_plans TO service_role;
REVOKE ALL ON TABLE public.rental_rent_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rental_rent_charges TO authenticated;
GRANT ALL ON TABLE public.rental_rent_charges TO service_role;
REVOKE ALL ON TABLE public.rental_rent_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rental_rent_payments TO authenticated;
GRANT ALL ON TABLE public.rental_rent_payments TO service_role;

-- The two sides of the tenancy read its rows (switch on). No client writes.
CREATE OR REPLACE FUNCTION public.rentals_tenancy_party(p_tenancy_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.rental_tenancies t
                  WHERE t.id = p_tenancy_id
                    AND (t.landlord_id = (SELECT auth.uid()) OR t.tenant_id = (SELECT auth.uid())));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_tenancy_party(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_tenancy_party(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "rent plans: the two sides" ON public.rental_rent_plans;
CREATE POLICY "rent plans: the two sides" ON public.rental_rent_plans FOR SELECT TO authenticated
  USING ((SELECT public.feature_enabled_for('rentals')) AND public.rentals_tenancy_party(tenancy_id));
DROP POLICY IF EXISTS "rent charges: the two sides" ON public.rental_rent_charges;
CREATE POLICY "rent charges: the two sides" ON public.rental_rent_charges FOR SELECT TO authenticated
  USING ((SELECT public.feature_enabled_for('rentals')) AND public.rentals_tenancy_party(tenancy_id));
DROP POLICY IF EXISTS "rent payments: the two sides" ON public.rental_rent_payments;
CREATE POLICY "rent payments: the two sides" ON public.rental_rent_payments FOR SELECT TO authenticated
  USING ((SELECT public.feature_enabled_for('rentals')) AND public.rentals_tenancy_party(tenancy_id));

-- ---------------------------------------------------------------------------
-- 2. Who is acting on a tenancy: the landlord or the tenant, of a live one.
CREATE OR REPLACE FUNCTION public.rentals_rent_side(p_tenancy_id uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN t.landlord_id = p_uid THEN 'landlord' WHEN t.tenant_id = p_uid THEN 'tenant' END
    FROM public.rental_tenancies t
   WHERE t.id = p_tenancy_id AND t.status = 'active';
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_side(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_rent_side(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The landlord sets (or changes) the plan. Charges already written stay;
--    the new plan applies from its first due date on.
CREATE OR REPLACE FUNCTION public.rentals_set_rent_plan(p_tenancy_id uuid, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_amount integer;
  v_freq text;
  v_first date;
  v_grace integer;
  v_fee integer;
  v_methods text[];
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_fields) k
                 WHERE k NOT IN ('amount_cents', 'frequency', 'first_due_on', 'grace_days', 'late_fee_cents', 'pay_methods')) THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_amount := (p_fields ->> 'amount_cents')::integer;
    v_freq := p_fields ->> 'frequency';
    v_first := (p_fields ->> 'first_due_on')::date;
    v_grace := COALESCE((p_fields ->> 'grace_days')::integer, 0);
    v_fee := COALESCE((p_fields ->> 'late_fee_cents')::integer, 0);
    v_methods := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'pay_methods')), '{}'::text[]);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END;
  IF v_amount IS NULL OR v_amount NOT BETWEEN 100 AND 10000000
     OR v_freq IS NULL OR v_freq NOT IN ('weekly', 'biweekly', 'monthly')
     OR v_first IS NULL
     -- The first due date is today or later (no back-dated charges), and within a year.
     OR v_first < current_date OR v_first > current_date + 366
     OR (v_freq = 'monthly' AND extract(day FROM v_first) > 28)
     OR v_grace NOT BETWEEN 0 AND 30
     OR v_fee NOT BETWEEN 0 AND 10000000
     OR NOT (v_methods <@ ARRAY['zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order']::text[])
     OR cardinality(v_methods) = 0 THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_rent_plans (tenancy_id, amount_cents, frequency, first_due_on, grace_days, late_fee_cents, pay_methods)
  VALUES (p_tenancy_id, v_amount, v_freq, v_first, v_grace, v_fee, v_methods)
  ON CONFLICT (tenancy_id) DO UPDATE SET
    amount_cents = EXCLUDED.amount_cents, frequency = EXCLUDED.frequency, first_due_on = EXCLUDED.first_due_on,
    grace_days = EXCLUDED.grace_days, late_fee_cents = EXCLUDED.late_fee_cents, pay_methods = EXCLUDED.pay_methods,
    reminded_for = NULL, updated_at = now();
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent schedule set',
    'Your landlord set your rent schedule. See it under Homes -> Renting.', '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_rent_plan(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_rent_plan(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. A payment: the tenant reports one ("I paid"), the landlord records one.
CREATE OR REPLACE FUNCTION public.rentals_add_rent_payment(p_tenancy_id uuid, p_amount_cents integer, p_paid_on date, p_method text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_side text;
  v_t public.rental_tenancies%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  v_side := public.rentals_rent_side(p_tenancy_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 1 AND 10000000
     OR p_paid_on IS NULL OR p_paid_on > current_date OR p_paid_on < current_date - 366
     OR p_method IS NULL OR p_method NOT IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other') THEN
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  INSERT INTO public.rental_rent_payments (tenancy_id, amount_cents, paid_on, method, reported_by, status, decided_at)
  VALUES (p_tenancy_id, p_amount_cents, p_paid_on, p_method, v_side,
          CASE WHEN v_side = 'landlord' THEN 'confirmed' ELSE 'reported' END,
          CASE WHEN v_side = 'landlord' THEN now() END)
  RETURNING id INTO v_id;
  IF v_side = 'tenant' THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'Rent payment to confirm',
      'Your tenant says they paid ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '. Tap Rent received once it reaches you.', '/rentals', false);
  ELSE
    PERFORM public.rentals_notify(v_t.tenant_id, 'Rent received',
      'Your landlord recorded a payment of ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '.', '/rentals', false);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_add_rent_payment(uuid, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_add_rent_payment(uuid, integer, date, text) TO authenticated, service_role;

-- The landlord confirms ("Rent received") or declines (with a reason the tenant sees) a reported payment.
CREATE OR REPLACE FUNCTION public.rentals_decide_rent_payment(p_payment_id uuid, p_received boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_p public.rental_rent_payments%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_p FROM public.rental_rent_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_p.tenancy_id, v_uid) IS DISTINCT FROM 'landlord' THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status <> 'reported' THEN
    RAISE EXCEPTION 'payment_already_decided' USING ERRCODE = '22023';
  END IF;
  IF p_received IS NULL OR (NOT p_received AND char_length(v_reason) NOT BETWEEN 3 AND 300) THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_payments
     SET status = CASE WHEN p_received THEN 'confirmed' ELSE 'declined' END,
         decided_at = now(),
         decline_reason = CASE WHEN p_received THEN NULL ELSE v_reason END
   WHERE id = p_payment_id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id,
    CASE WHEN p_received THEN 'Rent received' ELSE 'Rent payment not confirmed' END,
    CASE WHEN p_received THEN 'Your landlord confirmed your payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || '.'
         ELSE 'Your landlord has not received your payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || ': ' || v_reason END,
    '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_decide_rent_payment(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_decide_rent_payment(uuid, boolean, text) TO authenticated, service_role;

-- The landlord waives a charge (a late fee, or a rent row by agreement). Kept on the record, marked waived.
CREATE OR REPLACE FUNCTION public.rentals_waive_rent_charge(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_c public.rental_rent_charges%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_c FROM public.rental_rent_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_c.tenancy_id, v_uid) IS DISTINCT FROM 'landlord' THEN
    RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_c.waived_at IS NULL THEN
    UPDATE public.rental_rent_charges SET waived_at = now() WHERE id = p_charge_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_waive_rent_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_waive_rent_charge(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The next due date on or after a day, for a plan.
CREATE OR REPLACE FUNCTION public.rentals_rent_next_due(p_first date, p_frequency text, p_on_or_after date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_on_or_after <= p_first THEN p_first
    WHEN p_frequency = 'monthly' THEN
      (SELECT d FROM (SELECT (p_first + make_interval(months => n))::date AS d
                        FROM generate_series(0, 1200) n) s WHERE d >= p_on_or_after ORDER BY d LIMIT 1)
    ELSE p_first + (CASE p_frequency WHEN 'weekly' THEN 7 ELSE 14 END)
                   * ceil((p_on_or_after - p_first)::numeric / (CASE p_frequency WHEN 'weekly' THEN 7 ELSE 14 END))::integer
  END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_next_due(date, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_rent_next_due(date, text, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The record both sides see.
CREATE OR REPLACE FUNCTION public.rentals_rent_ledger(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_side text;
  v_plan public.rental_rent_plans%ROWTYPE;
  v_owed bigint;
  v_paid bigint;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- An ended tenancy's record stays readable by both sides.
  SELECT CASE WHEN t.landlord_id = v_uid THEN 'landlord' WHEN t.tenant_id = v_uid THEN 'tenant' END INTO v_side
    FROM public.rental_tenancies t WHERE t.id = p_tenancy_id;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_owed FROM public.rental_rent_charges
   WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= current_date;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_paid FROM public.rental_rent_payments
   WHERE tenancy_id = p_tenancy_id AND status = 'confirmed';
  RETURN jsonb_build_object(
    'side', v_side,
    -- Which home (for the receipts, R5): the property label, unit, city and ZIP; never the other side's id.
    'home', (SELECT jsonb_build_object('label', rp.label, 'unit_label', u.label, 'city', rp.city, 'zip_code', rp.zip_code)
               FROM public.rental_tenancies t
               JOIN public.rental_properties rp ON rp.id = t.property_id
               JOIN public.rental_units u ON u.id = t.unit_id
              WHERE t.id = p_tenancy_id),
    'plan', CASE WHEN v_plan.tenancy_id IS NULL THEN NULL ELSE jsonb_build_object(
      'amount_cents', v_plan.amount_cents, 'frequency', v_plan.frequency, 'first_due_on', v_plan.first_due_on,
      'grace_days', v_plan.grace_days, 'late_fee_cents', v_plan.late_fee_cents, 'pay_methods', to_jsonb(v_plan.pay_methods),
      'next_due_on', public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency,
                       GREATEST(current_date + 1, (SELECT COALESCE(max(due_on) + 1, current_date) FROM public.rental_rent_charges
                                                   WHERE tenancy_id = p_tenancy_id AND kind = 'rent')))) END,
    'balance_cents', v_owed - v_paid,
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'due_on', c.due_on,
                          'amount_cents', c.amount_cents, 'waived', c.waived_at IS NOT NULL) ORDER BY c.due_on, c.kind)
                          FROM public.rental_rent_charges c WHERE c.tenancy_id = p_tenancy_id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                          'method', p.method, 'reported_by', p.reported_by, 'status', p.status, 'decline_reason', p.decline_reason,
                          'decided_at', p.decided_at)
                          ORDER BY p.paid_on, p.created_at)
                          FROM public.rental_rent_payments p WHERE p.tenancy_id = p_tenancy_id), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_rent_ledger(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The daily sweep (server only): writes each live tenancy's rent rows that
--    have come due, a late fee once a rent row is past its grace days and
--    still unpaid (payments count oldest charge first), and friendly reminders
--    (3 days before and on the due date). Never a formal notice (Q33).
CREATE OR REPLACE FUNCTION public.rentals_rent_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_plan record;
  v_due date;
  v_rent record;
  v_rents integer := 0;
  v_fees integer := 0;
  v_reminders integer := 0;
  v_next date;
  v_paid bigint;
  v_through bigint;
BEGIN
  FOR v_plan IN
    SELECT p.*, t.tenant_id, t.landlord_id
      FROM public.rental_rent_plans p
      JOIN public.rental_tenancies t ON t.id = p.tenancy_id
     WHERE t.status = 'active'
  LOOP
    -- Rent rows that have come due (first due date on, today included).
    v_due := v_plan.first_due_on;
    WHILE v_due <= current_date LOOP
      INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents)
      VALUES (v_plan.tenancy_id, 'rent', v_due, v_plan.amount_cents)
      ON CONFLICT (tenancy_id, due_on) WHERE kind = 'rent' DO NOTHING;
      IF FOUND THEN v_rents := v_rents + 1; END IF;
      v_due := public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency, v_due + 1);
    END LOOP;
    -- Late fees: a rent row past due + grace, not waived, no fee yet, and the confirmed
    -- payments do not cover every charge up to and including it.
    IF v_plan.late_fee_cents > 0 THEN
      SELECT COALESCE(sum(amount_cents), 0) INTO v_paid FROM public.rental_rent_payments
       WHERE tenancy_id = v_plan.tenancy_id AND status = 'confirmed';
      FOR v_rent IN
        SELECT c.* FROM public.rental_rent_charges c
         WHERE c.tenancy_id = v_plan.tenancy_id AND c.kind = 'rent' AND c.waived_at IS NULL
           AND c.due_on + v_plan.grace_days < current_date
           AND NOT EXISTS (SELECT 1 FROM public.rental_rent_charges f WHERE f.rent_charge_id = c.id)
         ORDER BY c.due_on
      LOOP
        SELECT COALESCE(sum(amount_cents), 0) INTO v_through FROM public.rental_rent_charges
         WHERE tenancy_id = v_plan.tenancy_id AND waived_at IS NULL
           AND (due_on < v_rent.due_on OR id = v_rent.id);
        IF v_paid < v_through THEN
          INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents, rent_charge_id)
          VALUES (v_plan.tenancy_id, 'late_fee', current_date, v_plan.late_fee_cents, v_rent.id)
          ON CONFLICT (rent_charge_id) WHERE kind = 'late_fee' DO NOTHING;
          IF FOUND THEN
            v_fees := v_fees + 1;
            PERFORM public.rentals_notify(v_plan.tenant_id, 'Late fee added',
              'Rent due ' || to_char(v_rent.due_on, 'FMMon FMDD') || ' is still open, so the late fee in your rent schedule was added.', '/rentals', false);
          END IF;
        END IF;
      END LOOP;
    END IF;
    -- Friendly reminders: 3 days before the next due date and on it, once each.
    v_next := public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency, current_date);
    IF v_next IN (current_date, current_date + 3) AND v_plan.reminded_for IS DISTINCT FROM v_next - (v_next - current_date) THEN
      UPDATE public.rental_rent_plans SET reminded_for = current_date WHERE tenancy_id = v_plan.tenancy_id;
      PERFORM public.rentals_notify(v_plan.tenant_id, 'Rent reminder',
        CASE WHEN v_next = current_date THEN 'Rent is due today.' ELSE 'Rent is due ' || to_char(v_next, 'FMDay, FMMon FMDD') || '.' END,
        '/rentals', false);
      v_reminders := v_reminders + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('rent_rows', v_rents, 'late_fees', v_fees, 'reminders', v_reminders);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_rent_sweep() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('rentals-rent-sweep', interval '26 hours',
            'Homes rent tracker (D2): daily, writes rent rows that came due, late fees past the grace days, and friendly rent reminders.',
            'exempt',
            'While Homes is testers-only or no rent schedule is set, a run that writes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 13:07 UTC = 8:07 a.m. Central (CDT): reminders arrive in the morning.
    PERFORM cron.schedule('rentals-rent-sweep', '7 13 * * *',
      $c$SELECT public.cron_record_work('rentals-rent-sweep', to_jsonb(public.rentals_rent_sweep()));$c$);
  END IF;
END
$do$;
