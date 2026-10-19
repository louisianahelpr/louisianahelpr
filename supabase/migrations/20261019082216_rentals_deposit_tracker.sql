-- HOMES: the security deposit tracker, TRACK ONLY (owner D6, 2026-10-18).
-- The deposit is paid directly to the landlord, never through the app (Stripe
-- does not do escrow; docs/specs/landlord-hub-prep.md). The app keeps the record
-- both sides see and runs Louisiana's return clock (R.S. 9:3251, as amended by
-- Acts 2026, No. 63):
--   * the deposit is returned within ONE MONTH after the tenancy ends;
--   * anything kept needs an ITEMIZED statement (each reason and amount);
--   * the tenant gives a forwarding address.
-- The app never decides a dispute (Q35 (a)): it reminds the landlord, records
-- what was returned and kept and why, and sends the statement to the tenant.
--
--   rental_deposits  one per tenancy: the amount, when the landlord received
--                    it, the tenant's forwarding address (the landlord reads it
--                    only once the tenancy has ended), and the settlement:
--                    returned amount, itemized deductions, when it was sent.
--
--   rentals_set_deposit(tenancy, amount_cents, received_on)   landlord, live tenancy
--   rentals_set_forwarding_address(tenancy, address)          tenant, live or ended
--   rentals_settle_deposit(tenancy, returned_cents, deductions, returned_on)
--                                                             landlord, ended tenancy
--   rentals_deposit(tenancy)                                  either side (read)
--   rentals_deposit_sweep()                                   server: the reminders
--
-- Rules: the 'rentals' switch and rentals_assert_member on every write; the
-- tenancy's own landlord or tenant only; no client writes the table. Replay-safe.
-- Proof: src/test/pglite/homesDepositTracker.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. The table.
CREATE TABLE IF NOT EXISTS public.rental_deposits (
  tenancy_id uuid PRIMARY KEY REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 10000000),
  received_on date NOT NULL,
  forwarding_address text CHECK (forwarding_address IS NULL OR char_length(forwarding_address) BETWEEN 10 AND 300),
  returned_cents integer CHECK (returned_cents IS NULL OR returned_cents >= 0),
  deductions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deductions) = 'array'),
  returned_on date,
  settled_at timestamptz,
  reminded_stage smallint NOT NULL DEFAULT 0 CHECK (reminded_stage BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_deposits_settled CHECK ((settled_at IS NULL) = (returned_cents IS NULL) AND (settled_at IS NULL) = (returned_on IS NULL))
);
ALTER TABLE public.rental_deposits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_deposits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_deposits TO service_role;
-- No client SELECT: the forwarding address is shown to the landlord only once the tenancy ended, so every
-- read goes through rentals_deposit, which applies that rule.
COMMENT ON TABLE public.rental_deposits IS
  'Homes D6 deposit tracker (20261019082216): track only, paid directly to the landlord. Read through rentals_deposit; written by its RPCs.';

-- ---------------------------------------------------------------------------
-- 2. The landlord records the deposit (amount and the day they received it).
CREATE OR REPLACE FUNCTION public.rentals_set_deposit(p_tenancy_id uuid, p_amount_cents integer, p_received_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
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
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 100 AND 10000000
     OR p_received_on IS NULL OR p_received_on > current_date OR p_received_on < current_date - 3660 THEN
    RAISE EXCEPTION 'bad_deposit' USING ERRCODE = '22023';
  END IF;
  -- A settled deposit is final.
  IF EXISTS (SELECT 1 FROM public.rental_deposits d WHERE d.tenancy_id = p_tenancy_id AND d.settled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_deposits (tenancy_id, amount_cents, received_on)
  VALUES (p_tenancy_id, p_amount_cents, p_received_on)
  ON CONFLICT (tenancy_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, received_on = EXCLUDED.received_on, updated_at = now();
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit recorded',
    'Your landlord recorded your security deposit of ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '. See it under Homes.', '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_deposit(uuid, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_deposit(uuid, integer, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The tenant gives (or changes) the forwarding address the deposit and statement go to.
CREATE OR REPLACE FUNCTION public.rentals_set_forwarding_address(p_tenancy_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_addr text := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  -- The tenant of a live or ended tenancy (the address matters most after move-out).
  IF NOT FOUND OR v_t.tenant_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_addr) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'bad_address' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_deposits SET forwarding_address = v_addr, updated_at = now()
   WHERE tenancy_id = p_tenancy_id AND settled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deposit_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_forwarding_address(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_forwarding_address(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The landlord settles it once the tenancy ended: what was returned, and each amount kept with its
--    reason (the itemized statement). Returned + kept = the deposit, exactly. Final; the tenant gets the
--    statement as a notification (and email).
CREATE OR REPLACE FUNCTION public.rentals_settle_deposit(p_tenancy_id uuid, p_returned_cents integer, p_deductions jsonb, p_returned_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_d public.rental_deposits%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reason text;
  v_cents integer;
  v_kept bigint := 0;
  v_lines text := '';
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deposit_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  -- Settled after the tenancy ends (the return clock starts then).
  IF v_t.status <> 'ended' THEN
    RAISE EXCEPTION 'tenancy_not_ended' USING ERRCODE = '22023';
  END IF;
  IF p_deductions IS NULL OR jsonb_typeof(p_deductions) <> 'array' OR jsonb_array_length(p_deductions) > 20 THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_deductions) LOOP
    BEGIN
      v_reason := btrim(v_item ->> 'reason');
      v_cents := (v_item ->> 'amount_cents')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END;
    IF jsonb_typeof(v_item) <> 'object' OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200
       OR v_cents IS NULL OR v_cents < 1 THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END IF;
    v_kept := v_kept + v_cents;
    v_items := v_items || jsonb_build_array(jsonb_build_object('reason', v_reason, 'amount_cents', v_cents));
    v_lines := v_lines || E'\n- ' || v_reason || ': ' || to_char(v_cents / 100.0, 'FM$999,999,990.00');
  END LOOP;
  IF p_returned_cents IS NULL OR p_returned_cents < 0 OR p_returned_cents + v_kept <> v_d.amount_cents
     OR p_returned_on IS NULL OR p_returned_on > current_date OR p_returned_on < v_d.received_on THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_deposits
     SET returned_cents = p_returned_cents, deductions = v_items, returned_on = p_returned_on, settled_at = now(), updated_at = now()
   WHERE tenancy_id = p_tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit statement',
    'Your landlord returned ' || to_char(p_returned_cents / 100.0, 'FM$999,999,990.00') || ' of your '
      || to_char(v_d.amount_cents / 100.0, 'FM$999,999,990.00') || ' deposit on ' || to_char(p_returned_on, 'FMMon FMDD, YYYY') || '.'
      || CASE WHEN v_kept > 0 THEN ' Kept, itemized:' || v_lines ELSE ' Nothing was kept.' END,
    '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_settle_deposit(uuid, integer, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_settle_deposit(uuid, integer, jsonb, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The record both sides see. The return-by date is one month after the tenancy ended. The forwarding
--    address goes to the landlord only once the tenancy has ended (the tenant always sees their own).
CREATE OR REPLACE FUNCTION public.rentals_deposit(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_side text;
  v_d public.rental_deposits%ROWTYPE;
  v_due date;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('side', v_side, 'tenancy_status', v_t.status, 'deposit', NULL);
  END IF;
  v_due := CASE WHEN v_t.status = 'ended' AND v_t.ended_at IS NOT NULL
                THEN ((v_t.ended_at AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date END;
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'deposit', jsonb_build_object(
      'amount_cents', v_d.amount_cents,
      'received_on', v_d.received_on,
      'forwarding_address', CASE WHEN v_side = 'tenant' OR v_t.status = 'ended' THEN v_d.forwarding_address END,
      'has_forwarding_address', v_d.forwarding_address IS NOT NULL,
      'return_by', v_due,
      'returned_cents', v_d.returned_cents,
      'deductions', v_d.deductions,
      'returned_on', v_d.returned_on,
      'settled_at', v_d.settled_at));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_deposit(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The reminders (server only, daily): to the landlord of an ENDED tenancy whose deposit is not settled,
--    on the day it ended (stage 1), 7 days before the return-by date (stage 2) and on the day after it
--    passed (stage 3), once each. Friendly words; the app never sends a legal notice.
CREATE OR REPLACE FUNCTION public.rentals_deposit_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v record;
  v_due date;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_stage smallint;
  v_n integer := 0;
BEGIN
  FOR v IN
    SELECT d.tenancy_id, d.amount_cents, d.reminded_stage, t.landlord_id, t.ended_at
      FROM public.rental_deposits d
      JOIN public.rental_tenancies t ON t.id = d.tenancy_id
     WHERE d.settled_at IS NULL AND t.status = 'ended' AND t.ended_at IS NOT NULL AND d.reminded_stage < 3
     FOR UPDATE OF d
  LOOP
    v_due := ((v.ended_at AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date;
    v_stage := CASE WHEN v_today > v_due THEN 3 WHEN v_today >= v_due - 7 THEN 2 ELSE 1 END;
    IF v_stage > v.reminded_stage THEN
      UPDATE public.rental_deposits SET reminded_stage = v_stage, updated_at = now() WHERE tenancy_id = v.tenancy_id;
      PERFORM public.rentals_notify(v.landlord_id,
        CASE v_stage WHEN 3 THEN 'Deposit return is overdue' WHEN 2 THEN 'Deposit return due soon' ELSE 'Return the deposit' END,
        CASE v_stage
          WHEN 3 THEN 'The deposit (' || to_char(v.amount_cents / 100.0, 'FM$999,999,990.00') || ') was due back by ' || to_char(v_due, 'FMMon FMDD') || '. Louisiana law can make a landlord pay more for a late return. Record it under Homes.'
          WHEN 2 THEN 'Return the deposit, with an itemized list of anything you keep, by ' || to_char(v_due, 'FMMon FMDD') || '.'
          ELSE 'The tenancy ended. Louisiana gives you one month, until ' || to_char(v_due, 'FMMon FMDD') || ', to return the deposit with an itemized list of anything you keep.' END,
        '/rentals', v_stage >= 2);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reminders', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_deposit_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_deposit_sweep() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('rentals-deposit-sweep', interval '26 hours',
            'Homes deposit tracker (D6): daily, reminds the landlord of an ended tenancy to return the deposit (R.S. 9:3251 one-month clock).',
            'exempt',
            'While no tenancy with a recorded deposit has ended, a run that sends nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 13:12 UTC = 8:12 a.m. Central (CDT), after the rent sweep.
    PERFORM cron.schedule('rentals-deposit-sweep', '12 13 * * *',
      $c$SELECT public.cron_record_work('rentals-deposit-sweep', to_jsonb(public.rentals_deposit_sweep()));$c$);
  END IF;
END
$do$;
