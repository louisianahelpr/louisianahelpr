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
-- Dates are Louisiana dates (America/Chicago, public.shop_local_today()), never UTC's current_date.
-- Lead review (2026-10-19) rules:
--   * each rent row carries its own late fee and grace days (snapshot when written); a plan edit
--     changes only rows written after it;
--   * a rent row is late only if the payments made by its own due + grace date (confirmed with that
--     paid date, or reported by the tenant BY that date and not yet decided) do not cover it, paid to
--     rent rows oldest first (fees never make a later rent late: no fee on a fee), one fee per rent
--     row at most; a decline later lets the next sweep add the fee; a row once found on time by
--     confirmed payments alone is final (a later correction never adds a fee); a row whose due + grace
--     date fell while the sweep skipped the tenancy (a side banned or Homes off) gets no fee;
--   * after a tenancy ends both sides can still record, decide and waive on its record for 90 days
--     (read-only after);
--   * the landlord can reverse or correct a confirmed payment within 30 days with a reason (kept on
--     the payment as an audit trail, tenant told); the tenant can dispute a declined payment once and
--     each later correction or reversal once (the app never decides it, Q35 (a)).
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

-- Louisiana days the sweep skipped a tenancy (a side banned or Homes off), as [{from, to}] periods: no late
-- fee for a rent row whose due + grace date fell in one (lead review round 2 #4). Server only: it would
-- reveal the other side's ban or switch-off, so no client reads it and Download My Data leaves it out
-- (lead review round 3 #1).
CREATE TABLE IF NOT EXISTS public.rental_rent_sweep_skips (
  tenancy_id uuid PRIMARY KEY REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  periods jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(periods) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_rent_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rent', 'late_fee')),
  due_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  rent_charge_id uuid REFERENCES public.rental_rent_charges(id) ON DELETE CASCADE,
  -- Snapshot of the plan when a rent row is written (0 on fee rows): plan edits never reach back.
  late_fee_cents integer NOT NULL DEFAULT 0 CHECK (late_fee_cents BETWEEN 0 AND 10000000),
  grace_days smallint NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 30),
  -- Set when the sweep found this rent row on time by confirmed payments alone: final, never judged again.
  on_time_at timestamptz,
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
  pay_method text NOT NULL CHECK (pay_method IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other')),
  reported_by text NOT NULL CHECK (reported_by IN ('tenant', 'landlord')),
  status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'confirmed', 'declined', 'reversed')),
  decided_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) BETWEEN 3 AND 300),
  -- The landlord's corrections within 30 days of the decision, newest last: {at, action, reason, from, to}.
  corrections jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(corrections) = 'array'),
  -- The tenant's disputes, oldest first: {at, reason}. One per decline and one per later correction.
  -- (named tenant_disputes: a bare 'disputes' key made Stripe mock literals look like rent payments to fixtureSchemaContract)
  tenant_disputes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tenant_disputes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_payments_decided CHECK ((status = 'reported') = (decided_at IS NULL)),
  CONSTRAINT rental_rent_payments_declined_reason CHECK ((status = 'declined') = (decline_reason IS NOT NULL))
);

-- Who ended a tenancy, and the lease end date (lead review #4: the landlord sees the tenant's forwarding
-- address only once the TENANT ended it or the lease end date passed, never right after a landlord-only
-- early end). ended_by is a role word, not a person.
ALTER TABLE public.rental_tenancies ADD COLUMN IF NOT EXISTS ended_by text;
ALTER TABLE public.rental_tenancies ADD COLUMN IF NOT EXISTS lease_ends_on date;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_tenancies_ended_by_check') THEN
    ALTER TABLE public.rental_tenancies ADD CONSTRAINT rental_tenancies_ended_by_check
      CHECK (ended_by IS NULL OR ended_by IN ('landlord', 'tenant'));
  END IF;
END
$do$;
-- Set on the change to 'ended' (rentals_end_tenancy by either side, or the tenant's account deletion,
-- whose trigger rental_tenancies_end_on_tenant_delete fires first: 'end_' sorts before 'zz_').
CREATE OR REPLACE FUNCTION public.rentals_tenancy_ended_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended' THEN
    NEW.ended_by := CASE
      WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NULL THEN 'tenant'
      WHEN (SELECT auth.uid()) = NEW.tenant_id THEN 'tenant'
      WHEN (SELECT auth.uid()) = NEW.landlord_id THEN 'landlord'
      ELSE NEW.ended_by END;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_tenancy_ended_by() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_tenancies_zz_ended_by ON public.rental_tenancies;
CREATE TRIGGER rental_tenancies_zz_ended_by
  BEFORE UPDATE OF status, tenant_id ON public.rental_tenancies
  FOR EACH ROW EXECUTE FUNCTION public.rentals_tenancy_ended_by();
CREATE INDEX IF NOT EXISTS rental_rent_payments_tenancy_idx ON public.rental_rent_payments (tenancy_id, paid_on);
CREATE INDEX IF NOT EXISTS rental_rent_charges_tenancy_idx ON public.rental_rent_charges (tenancy_id, due_on);
-- Q807: every table refuses a write from a session whose email is not confirmed (the RPCs write as definers).
SELECT public.attach_unconfirmed_email_gate();

ALTER TABLE public.rental_rent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_sweep_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_rent_sweep_skips FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_rent_sweep_skips TO service_role;
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
-- 2. Who is acting on a tenancy: the landlord or the tenant, of a live one or one that ended in the
--    last 90 days (lead review #3: both sides can still record, decide and waive; read-only after).
CREATE OR REPLACE FUNCTION public.rentals_rent_side(p_tenancy_id uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN t.landlord_id = p_uid THEN 'landlord' WHEN t.tenant_id = p_uid THEN 'tenant' END
    FROM public.rental_tenancies t
   WHERE t.id = p_tenancy_id
     AND (t.status = 'active' OR (t.status = 'ended' AND t.ended_at > now() - interval '90 days'));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_side(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_rent_side(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The landlord sets (or changes) the plan, and optionally the lease end date. Charges already
--    written stay as written (each rent row carries its own fee and grace days); the new plan applies
--    from its first due date on.
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
  v_lease date;
  v_today date := public.shop_local_today();
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
                 WHERE k NOT IN ('amount_cents', 'frequency', 'first_due_on', 'grace_days', 'late_fee_cents', 'pay_methods',
                                 'lease_ends_on')) THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_amount := (p_fields ->> 'amount_cents')::integer;
    v_freq := p_fields ->> 'frequency';
    v_first := (p_fields ->> 'first_due_on')::date;
    v_grace := COALESCE((p_fields ->> 'grace_days')::integer, 0);
    v_fee := COALESCE((p_fields ->> 'late_fee_cents')::integer, 0);
    v_methods := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'pay_methods')), '{}'::text[]);
    -- Omitted = keep the stored date; an explicit null clears it (lead review round 2 #7).
    v_lease := CASE WHEN p_fields ? 'lease_ends_on' THEN (p_fields ->> 'lease_ends_on')::date ELSE v_t.lease_ends_on END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END;
  IF v_amount IS NULL OR v_amount NOT BETWEEN 100 AND 10000000
     OR v_freq IS NULL OR v_freq NOT IN ('weekly', 'biweekly', 'monthly')
     OR v_first IS NULL
     -- The first due date is today or later (no back-dated charges), and within a year.
     OR v_first < v_today OR v_first > v_today + 366
     OR (v_freq = 'monthly' AND extract(day FROM v_first) > 28)
     OR v_grace NOT BETWEEN 0 AND 30
     OR v_fee NOT BETWEEN 0 AND 10000000
     OR NOT (v_methods <@ ARRAY['zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order']::text[])
     OR cardinality(v_methods) = 0
     -- A NEW lease end date is at least 30 days out (an unchanged one may be closer): the landlord cannot
     -- set it to today and end the tenancy to read the tenant's forwarding address (lead review #4).
     OR (v_lease IS DISTINCT FROM v_t.lease_ends_on AND v_lease IS NOT NULL AND (v_lease < v_today + 30 OR v_lease > v_today + 3660)) THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  IF v_lease IS DISTINCT FROM v_t.lease_ends_on THEN
    UPDATE public.rental_tenancies SET lease_ends_on = v_lease WHERE id = p_tenancy_id;
  END IF;
  INSERT INTO public.rental_rent_plans (tenancy_id, amount_cents, frequency, first_due_on, grace_days, late_fee_cents, pay_methods)
  VALUES (p_tenancy_id, v_amount, v_freq, v_first, v_grace, v_fee, v_methods)
  ON CONFLICT (tenancy_id) DO UPDATE SET
    amount_cents = EXCLUDED.amount_cents, frequency = EXCLUDED.frequency, first_due_on = EXCLUDED.first_due_on,
    grace_days = EXCLUDED.grace_days, late_fee_cents = EXCLUDED.late_fee_cents, pay_methods = EXCLUDED.pay_methods,
    -- reminded_for stays: an edit on a reminder day never sends that day's reminder twice (lead review #9).
    updated_at = now();
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
     OR p_paid_on IS NULL OR p_paid_on > public.shop_local_today() OR p_paid_on < public.shop_local_today() - 366
     OR p_method IS NULL OR p_method NOT IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other') THEN
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  -- A tenant's reports still waiting, this one included, total at most what is open now plus one rent
  -- (lead review rounds 2-3 #3/#2): made-up large reports cannot hold off late fees on rows not yet due.
  IF v_side = 'tenant' AND p_amount_cents >
       GREATEST(0, (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_charges
                     WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= public.shop_local_today())
                   - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
                       WHERE tenancy_id = p_tenancy_id AND status = 'confirmed'))
       + COALESCE((SELECT amount_cents FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id), 0)
       -- the tenant's own reports still waiting count against the cap too (lead review round 3 #2)
       - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
           WHERE tenancy_id = p_tenancy_id AND status = 'reported' AND reported_by = 'tenant') THEN
    RAISE EXCEPTION 'payment_over_balance' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_rent_payments (tenancy_id, amount_cents, paid_on, pay_method, reported_by, status, decided_at)
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

-- The landlord reverses or corrects a confirmed payment within 30 days of confirming it, with a reason
-- (lead review #7). Each change is kept on the payment (corrections: when, what, why, before and after)
-- and the tenant is told; the tenant can dispute it (below).
CREATE OR REPLACE FUNCTION public.rentals_correct_rent_payment(p_payment_id uuid, p_action text, p_amount_cents integer,
                                                               p_paid_on date, p_reason text)
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
  v_today date := public.shop_local_today();
  v_money text;
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
  IF v_p.status <> 'confirmed' OR v_p.decided_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'payment_not_correctable' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reverse' THEN
    UPDATE public.rental_rent_payments
       SET status = 'reversed',
           corrections = corrections || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'action', 'reverse', 'reason', v_reason,
             'from', jsonb_build_object('amount_cents', v_p.amount_cents, 'paid_on', v_p.paid_on)))
     WHERE id = p_payment_id;
    v_money := to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00');
  ELSIF p_action = 'edit' THEN
    IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 1 AND 10000000
       OR p_paid_on IS NULL OR p_paid_on > v_today OR p_paid_on < v_today - 366
       OR (p_amount_cents = v_p.amount_cents AND p_paid_on = v_p.paid_on) THEN
      RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_rent_payments
       SET amount_cents = p_amount_cents, paid_on = p_paid_on,
           corrections = corrections || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'action', 'edit', 'reason', v_reason,
             'from', jsonb_build_object('amount_cents', v_p.amount_cents, 'paid_on', v_p.paid_on),
             'to', jsonb_build_object('amount_cents', p_amount_cents, 'paid_on', p_paid_on)))
     WHERE id = p_payment_id;
    v_money := to_char(p_amount_cents / 100.0, 'FM$999,999,990.00');
  ELSE
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent payment changed',
    CASE WHEN p_action = 'reverse'
         THEN 'Your landlord took back the payment of ' || v_money || ' on your rent record: ' || v_reason
         ELSE 'Your landlord corrected a payment on your rent record to ' || v_money || ': ' || v_reason END
      || ' If that is wrong, tap Dispute under Homes -> Renting.',
    '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_correct_rent_payment(uuid, text, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_correct_rent_payment(uuid, text, integer, date, text) TO authenticated, service_role;

-- The tenant disputes a declined, reversed or corrected payment, within 30 days of that decision or
-- change. The app records it and tells the landlord; it never decides who is right (Q35 (a)).
CREATE OR REPLACE FUNCTION public.rentals_dispute_rent_payment(p_payment_id uuid, p_reason text)
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
  v_last timestamptz;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_p FROM public.rental_rent_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_p.tenancy_id, v_uid) IS DISTINCT FROM 'tenant' THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The last landlord decision or change; each one may be disputed once, within 30 days (lead review
  -- round 2 #1): a dispute dated at or after it means that one was already disputed.
  v_last := GREATEST(v_p.decided_at, (SELECT max((c ->> 'at')::timestamptz) FROM jsonb_array_elements(v_p.corrections) c));
  IF NOT (v_p.status IN ('declined', 'reversed') OR jsonb_array_length(v_p.corrections) > 0)
     OR v_last IS NULL OR v_last < now() - interval '30 days'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_p.tenant_disputes) x WHERE (x ->> 'at')::timestamptz >= v_last) THEN
    RAISE EXCEPTION 'payment_not_disputable' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_payments
     SET tenant_disputes = tenant_disputes || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'reason', v_reason))
   WHERE id = p_payment_id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.landlord_id, 'Rent payment disputed',
    'Your tenant disputes the payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || ': ' || v_reason
      || ' Talk it through in Messages; you can record or correct it under Homes -> Owning.',
    '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_dispute_rent_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_dispute_rent_payment(uuid, text) TO authenticated, service_role;

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
  v_t public.rental_tenancies%ROWTYPE;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- An ended tenancy's record stays readable by both sides.
  SELECT * INTO v_t FROM public.rental_tenancies t WHERE t.id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_owed FROM public.rental_rent_charges
   WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= v_today;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_paid FROM public.rental_rent_payments
   WHERE tenancy_id = p_tenancy_id AND status = 'confirmed';
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'lease_ends_on', v_t.lease_ends_on,
    -- Writes stay open while the tenancy is live and for 90 days after it ended (then read-only).
    'open', v_t.status = 'active' OR (v_t.status = 'ended' AND v_t.ended_at > now() - interval '90 days'),
    'open_until', CASE WHEN v_t.status = 'ended' THEN ((v_t.ended_at + interval '90 days') AT TIME ZONE 'America/Chicago')::date END,
    -- Which home (for the receipts, R5): the property label, unit, city and ZIP; never the other side's id.
    'home', (SELECT jsonb_build_object('label', rp.label, 'unit_label', u.label, 'city', rp.city, 'zip_code', rp.zip_code)
               FROM public.rental_tenancies t
               JOIN public.rental_properties rp ON rp.id = t.property_id
               JOIN public.rental_units u ON u.id = t.unit_id
              WHERE t.id = p_tenancy_id),
    'plan', CASE WHEN v_plan.tenancy_id IS NULL THEN NULL ELSE jsonb_build_object(
      'amount_cents', v_plan.amount_cents, 'frequency', v_plan.frequency, 'first_due_on', v_plan.first_due_on,
      'grace_days', v_plan.grace_days, 'late_fee_cents', v_plan.late_fee_cents, 'pay_methods', to_jsonb(v_plan.pay_methods),
      'next_due_on', CASE WHEN v_t.status = 'active' THEN public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency,
                       GREATEST(v_today + 1, (SELECT COALESCE(max(due_on) + 1, v_today) FROM public.rental_rent_charges
                                                   WHERE tenancy_id = p_tenancy_id AND kind = 'rent'))) END) END,
    'balance_cents', v_owed - v_paid,
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'due_on', c.due_on,
                          'amount_cents', c.amount_cents, 'waived', c.waived_at IS NOT NULL) ORDER BY c.due_on, c.kind)
                          FROM public.rental_rent_charges c WHERE c.tenancy_id = p_tenancy_id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                          'method', p.pay_method, 'reported_by', p.reported_by, 'status', p.status, 'decline_reason', p.decline_reason,
                          'decided_at', p.decided_at, 'corrections', p.corrections,
                          'correctable_until', CASE WHEN p.status = 'confirmed' AND p.decided_at > now() - interval '30 days'
                                                    THEN p.decided_at + interval '30 days' END,
                          'disputes', p.tenant_disputes)
                          ORDER BY p.paid_on, p.created_at)
                          FROM public.rental_rent_payments p WHERE p.tenancy_id = p_tenancy_id), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_rent_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_rent_ledger(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The daily sweep (server only), in Louisiana dates:
--    * rent rows that have come due, each carrying the plan's late fee and grace days as they are now
--      (live tenancies only);
--    * a late fee on a rent row whose own due + grace date has passed when the payments made by that
--      date (confirmed, or reported by the tenant and not yet decided: on time until the landlord
--      declines) do not cover the rent rows up to and including it, oldest first. Fees are left out of
--      that sum, so a fee never makes a later rent late; one fee per rent row at most. Runs for live
--      tenancies and those ended in the last 90 days (a decline after the end can still add one);
--    * friendly reminders 3 days before and on the due date, once a day, never when what is due by
--      then is already paid (prepaid). Never a formal notice (Q33).
--    A tenancy is skipped while either side is banned or Homes is off for the tenant (who gets the
--    notices) or the landlord (lead review #8).
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
  v_skipped integer := 0;
  v_next date;
  v_paid bigint;
  v_through bigint;
  v_owed bigint;
  v_today date := public.shop_local_today();
BEGIN
  FOR v_plan IN
    SELECT p.*, t.tenant_id, t.landlord_id, t.status AS tenancy_status
      FROM public.rental_rent_plans p
      JOIN public.rental_tenancies t ON t.id = p.tenancy_id
     WHERE t.status = 'active' OR (t.status = 'ended' AND t.ended_at > now() - interval '90 days')
  LOOP
    IF NOT public.feature_enabled_for_user('rentals', v_plan.tenant_id)
       OR NOT public.feature_enabled_for_user('rentals', v_plan.landlord_id)
       OR EXISTS (SELECT 1 FROM public.profiles pr
                   WHERE pr.user_id IN (v_plan.tenant_id, v_plan.landlord_id)
                     AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                     AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
      -- Remember the skipped day: extend the last period when it ran to yesterday or today, else start one.
      INSERT INTO public.rental_rent_sweep_skips AS k (tenancy_id, periods)
      VALUES (v_plan.tenancy_id, jsonb_build_array(jsonb_build_object('from', v_today, 'to', v_today)))
      ON CONFLICT (tenancy_id) DO UPDATE
        SET periods = CASE
              WHEN jsonb_array_length(k.periods) > 0 AND (k.periods -> -1 ->> 'to')::date >= v_today - 1
                THEN jsonb_set(k.periods, ARRAY[(jsonb_array_length(k.periods) - 1)::text, 'to'], to_jsonb(v_today))
              ELSE k.periods || jsonb_build_array(jsonb_build_object('from', v_today, 'to', v_today)) END,
            updated_at = now();
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    -- Rent rows that have come due (first due date on, today included), live tenancies only.
    IF v_plan.tenancy_status = 'active' THEN
      v_due := v_plan.first_due_on;
      WHILE v_due <= v_today LOOP
        INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents, late_fee_cents, grace_days)
        VALUES (v_plan.tenancy_id, 'rent', v_due, v_plan.amount_cents, v_plan.late_fee_cents, v_plan.grace_days)
        ON CONFLICT (tenancy_id, due_on) WHERE kind = 'rent' DO NOTHING;
        IF FOUND THEN v_rents := v_rents + 1; END IF;
        v_due := public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency, v_due + 1);
      END LOOP;
    END IF;
    -- Late fees, per rent row, on that row's own fee and grace days.
    FOR v_rent IN
      SELECT c.* FROM public.rental_rent_charges c
       WHERE c.tenancy_id = v_plan.tenancy_id AND c.kind = 'rent' AND c.waived_at IS NULL
         AND c.late_fee_cents > 0
         AND c.on_time_at IS NULL
         AND c.due_on + c.grace_days < v_today
         AND NOT EXISTS (SELECT 1 FROM public.rental_rent_charges f WHERE f.rent_charge_id = c.id)
         -- No fee when its due + grace date (or the day after, when the fee would have been written)
         -- fell while the sweep skipped this tenancy.
         AND NOT EXISTS (SELECT 1 FROM public.rental_rent_sweep_skips ss, jsonb_array_elements(ss.periods) k
                          WHERE ss.tenancy_id = c.tenancy_id
                            AND c.due_on + c.grace_days BETWEEN (k ->> 'from')::date - 1 AND (k ->> 'to')::date)
       ORDER BY c.due_on
    LOOP
      SELECT COALESCE(sum(amount_cents), 0) INTO v_through FROM public.rental_rent_charges
       WHERE tenancy_id = v_plan.tenancy_id AND kind = 'rent' AND waived_at IS NULL AND due_on <= v_rent.due_on;
      -- Confirmed payments paid by the due + grace date. A payment the TENANT reported counts from the later
      -- of its paid date and the day it was reported (Louisiana time), so a late report dated back and then
      -- confirmed never makes a row on time (lead review round 3 #3).
      SELECT COALESCE(sum(amount_cents), 0) INTO v_paid FROM public.rental_rent_payments
       WHERE tenancy_id = v_plan.tenancy_id AND status = 'confirmed'
         AND CASE WHEN reported_by = 'tenant' THEN GREATEST(paid_on, (created_at AT TIME ZONE 'America/Chicago')::date) ELSE paid_on END
             <= v_rent.due_on + v_rent.grace_days;
      IF v_paid >= v_through THEN
        -- On time by confirmed payments alone: final (a later correction never adds a fee).
        UPDATE public.rental_rent_charges SET on_time_at = now() WHERE id = v_rent.id;
        CONTINUE;
      END IF;
      -- Plus the tenant's reports MADE by that date (Louisiana time) and still waiting: on time until declined.
      v_paid := v_paid + (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
                           WHERE tenancy_id = v_plan.tenancy_id AND status = 'reported'
                             AND GREATEST(paid_on, (created_at AT TIME ZONE 'America/Chicago')::date) <= v_rent.due_on + v_rent.grace_days);
      IF v_paid < v_through THEN
        INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents, rent_charge_id)
        VALUES (v_plan.tenancy_id, 'late_fee', v_today, v_rent.late_fee_cents, v_rent.id)
        ON CONFLICT (rent_charge_id) WHERE kind = 'late_fee' DO NOTHING;
        IF FOUND THEN
          v_fees := v_fees + 1;
          PERFORM public.rentals_notify(v_plan.tenant_id, 'Late fee added',
            'Rent due ' || to_char(v_rent.due_on, 'FMMon FMDD') || ' is still open, so the late fee in your rent schedule was added.', '/rentals', false);
        END IF;
      END IF;
    END LOOP;
    -- Friendly reminders: 3 days before the next due date and on it, at most once a day, live tenancies
    -- only, and never when what is due by then is already covered by confirmed payments.
    IF v_plan.tenancy_status = 'active' THEN
      v_next := public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency, v_today);
      IF v_next IN (v_today, v_today + 3) AND v_plan.reminded_for IS DISTINCT FROM v_today THEN
        SELECT COALESCE(sum(amount_cents), 0)
               + CASE WHEN EXISTS (SELECT 1 FROM public.rental_rent_charges
                                    WHERE tenancy_id = v_plan.tenancy_id AND kind = 'rent' AND due_on = v_next)
                      THEN 0 ELSE v_plan.amount_cents END
          INTO v_owed
          FROM public.rental_rent_charges
         WHERE tenancy_id = v_plan.tenancy_id AND waived_at IS NULL AND due_on <= v_next;
        v_owed := v_owed - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
                             WHERE tenancy_id = v_plan.tenancy_id AND status = 'confirmed');
        IF v_owed > 0 THEN
          UPDATE public.rental_rent_plans SET reminded_for = v_today WHERE tenancy_id = v_plan.tenancy_id;
          PERFORM public.rentals_notify(v_plan.tenant_id, 'Rent reminder',
            CASE WHEN v_next = v_today THEN 'Rent is due today.' ELSE 'Rent is due ' || to_char(v_next, 'FMDay, FMMon FMDD') || '.' END,
            '/rentals', false);
          v_reminders := v_reminders + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('rent_rows', v_rents, 'late_fees', v_fees, 'reminders', v_reminders, 'skipped', v_skipped);
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

-- cronCatchUpPolicy (Q30) reads the NEWEST migration that seeds public.cron_catchup_policy as the whole
-- policy, so this restates every row of 20261018035944 verbatim plus listing-photo-purge, rentals-rent-sweep (never re-run late).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;
