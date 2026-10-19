-- HOMES: rent paid IN THE APP by bank (ACH), with autopay (owner D2/D7/D9, 2026-10-18). DRAFT: needs the
-- lh-money-escrow review (via the lead) before it leaves wip, and runs in Stripe TEST mode only until the
-- owner (and LREC in writing, D1) say yes to live: the edge functions refuse a live-mode payment outright.
--
-- How the money moves (separate charge, then transfer; nothing is escrowed):
--   1. The tenant pays from the rent card: the edge function rent-bank-checkout calls
--      rentals_start_bank_rent AS THE TENANT (every rule is here), opens a Stripe Checkout page for
--      us_bank_account only, and records it (rentals_bank_rent_attach).
--   2. A bank debit takes days. The webhook moves the row to 'processing' (session completed, unpaid) and
--      to 'succeeded' only when Stripe says the bank confirmed it (payment_intent.succeeded). Only then is
--      a CONFIRMED payment written on the rent record (pay_method 'bank') and the landlord's transfer
--      queued (D9: paid to the landlord when the bank confirms).
--   3. A failed debit marks the row 'failed' (nothing was recorded). A return AFTER success (an ACH
--      return arrives as a dispute) marks it 'returned': the rent record's payment is reversed (an audit
--      entry {action: 'bank_return'}) and the landlord's transfer is reversed (D9: pulled back on a return).
--   The bank cost is Stripe's ACH price, 0.8% capped at $5, passed through (never absorbed): the landlord
--   chooses who pays it (D2). Tenant pays: added to what the bank is debited. Landlord pays: kept from the
--   transfer. The tenant sees the fee before paying either way.
--
--   Autopay (D7): the tenant saves the bank once (a Stripe mandate, rent-bank-autopay edge function); the
--   daily autopay run (rentals_autopay_due, service only) opens one bank payment per rent row due today
--   that is still open, and the edge function charges it off-session. Never re-run late (money).
--
-- Rules: the 'rentals' switch, rentals_assert_member, the tenancy's own landlord or tenant; the landlord
-- must have payouts on (profiles.stripe_account_id + stripe_payouts_enabled) to turn bank pay on, and still
-- at the moment the tenant pays. No client reads or writes the new tables (reads go through the ledger).
-- Replay-safe. Proof: src/test/pglite/homesBankRent.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. The plan's bank options, and the 'bank' way to pay on the record.
ALTER TABLE public.rental_rent_plans ADD COLUMN IF NOT EXISTS bank_pay boolean NOT NULL DEFAULT false;
ALTER TABLE public.rental_rent_plans ADD COLUMN IF NOT EXISTS bank_fee_payer text NOT NULL DEFAULT 'tenant';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_rent_plans_bank_fee_payer_check') THEN
    ALTER TABLE public.rental_rent_plans ADD CONSTRAINT rental_rent_plans_bank_fee_payer_check
      CHECK (bank_fee_payer IN ('tenant', 'landlord'));
  END IF;
  ALTER TABLE public.rental_rent_payments DROP CONSTRAINT IF EXISTS rental_rent_payments_pay_method_check;
  ALTER TABLE public.rental_rent_payments ADD CONSTRAINT rental_rent_payments_pay_method_check
    CHECK (pay_method IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other', 'bank'));
END
$do$;

-- ---------------------------------------------------------------------------
-- 2. The bank payments and the saved autopay bank.
CREATE TABLE IF NOT EXISTS public.rental_rent_bank_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  rent_cents integer NOT NULL CHECK (rent_cents BETWEEN 100 AND 10000000),
  fee_cents integer NOT NULL CHECK (fee_cents BETWEEN 0 AND 500),
  fee_payer text NOT NULL CHECK (fee_payer IN ('tenant', 'landlord')),
  -- What the bank is debited, and what the landlord receives.
  charge_cents integer NOT NULL,
  transfer_cents integer NOT NULL,
  autopay boolean NOT NULL DEFAULT false,
  rent_charge_id uuid REFERENCES public.rental_rent_charges(id) ON DELETE SET NULL,
  livemode boolean,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'succeeded', 'failed', 'returned', 'expired')),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  rent_payment_id uuid REFERENCES public.rental_rent_payments(id) ON DELETE SET NULL,
  transfer_status text NOT NULL DEFAULT 'none' CHECK (transfer_status IN ('none', 'pending', 'failed', 'succeeded', 'reverse_due', 'reversed')),
  stripe_transfer_id text,
  transfer_attempts integer NOT NULL DEFAULT 0,
  next_transfer_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_bank_payments_sums CHECK (
    charge_cents = rent_cents + CASE WHEN fee_payer = 'tenant' THEN fee_cents ELSE 0 END
    AND transfer_cents = rent_cents - CASE WHEN fee_payer = 'landlord' THEN fee_cents ELSE 0 END)
);
CREATE INDEX IF NOT EXISTS rental_rent_bank_payments_tenancy_idx ON public.rental_rent_bank_payments (tenancy_id, created_at);
-- Autopay charges a rent row once.
CREATE UNIQUE INDEX IF NOT EXISTS rental_rent_bank_payments_one_per_charge
  ON public.rental_rent_bank_payments (rent_charge_id) WHERE autopay AND status <> 'failed' AND status <> 'expired';

CREATE TABLE IF NOT EXISTS public.rental_rent_autopay (
  tenancy_id uuid PRIMARY KEY REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  livemode boolean NOT NULL DEFAULT false,
  stripe_customer_id text,
  stripe_payment_method_id text,
  bank_label text CHECK (bank_label IS NULL OR char_length(bank_label) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rent_autopay_has_bank CHECK (NOT enabled OR stripe_payment_method_id IS NOT NULL)
);
SELECT public.attach_unconfirmed_email_gate();
ALTER TABLE public.rental_rent_bank_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_rent_autopay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_rent_bank_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rental_rent_autopay FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_rent_bank_payments TO service_role;
GRANT ALL ON TABLE public.rental_rent_autopay TO service_role;

-- A bank payment on the rent record is the bank's word, not a member's: no member RPC changes it except
-- the tenant's dispute log (lead review #7 corrections are for direct payments).
CREATE OR REPLACE FUNCTION public.rentals_bank_payment_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.pay_method = 'bank' AND (SELECT auth.uid()) IS NOT NULL
     AND (to_jsonb(NEW) - 'tenant_disputes') IS DISTINCT FROM (to_jsonb(OLD) - 'tenant_disputes') THEN
    RAISE EXCEPTION 'bank_payment_locked' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_payment_locked() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_rent_payments_bank_locked ON public.rental_rent_payments;
CREATE TRIGGER rental_rent_payments_bank_locked
  BEFORE UPDATE ON public.rental_rent_payments
  FOR EACH ROW EXECUTE FUNCTION public.rentals_bank_payment_locked();

-- ---------------------------------------------------------------------------
-- 3. The bank cost: Stripe's ACH price, 0.8% rounded up, at most $5.
CREATE OR REPLACE FUNCTION public.rentals_bank_fee_cents(p_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_cents IS NULL OR p_cents <= 0 THEN 0 ELSE least(ceil(p_cents * 0.008)::integer, 500) END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_fee_cents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_bank_fee_cents(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The landlord turns bank pay on or off and chooses who pays the bank cost.
CREATE OR REPLACE FUNCTION public.rentals_set_bank_pay(p_tenancy_id uuid, p_enabled boolean, p_fee_payer text)
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
  IF p_enabled IS NULL OR p_fee_payer IS NULL OR p_fee_payer NOT IN ('tenant', 'landlord') THEN
    RAISE EXCEPTION 'bad_bank_pay' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id) THEN
    RAISE EXCEPTION 'no_rent_plan' USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_uid
                                  AND pr.stripe_account_id IS NOT NULL AND pr.stripe_payouts_enabled) THEN
    RAISE EXCEPTION 'payouts_not_ready' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_plans SET bank_pay = p_enabled, bank_fee_payer = p_fee_payer, updated_at = now()
   WHERE tenancy_id = p_tenancy_id;
  IF NOT p_enabled THEN
    UPDATE public.rental_rent_autopay SET enabled = false, updated_at = now() WHERE tenancy_id = p_tenancy_id;
  END IF;
  PERFORM public.rentals_notify(v_t.tenant_id,
    CASE WHEN p_enabled THEN 'Pay rent in the app' ELSE 'Bank pay turned off' END,
    CASE WHEN p_enabled THEN 'Your landlord takes rent by bank in the app now, with autopay if you want it. '
           || CASE WHEN p_fee_payer = 'tenant' THEN 'The bank cost (0.8%, at most $5) is added to what you pay.' ELSE 'Your landlord pays the bank cost.' END
         ELSE 'Your landlord turned off paying rent by bank in the app. Autopay is off; pay them directly.' END,
    '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_bank_pay(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_bank_pay(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The tenant starts a bank payment (called AS THE TENANT by rent-bank-checkout). Returns what the
--    edge function needs to open the page; the amount is at most what is open now plus one rent.
CREATE OR REPLACE FUNCTION public.rentals_start_bank_rent(p_tenancy_id uuid, p_rent_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_plan public.rental_rent_plans%ROWTYPE;
  v_fee integer;
  v_open bigint;
  v_row public.rental_rent_bank_payments%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.tenant_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id;
  IF NOT FOUND OR NOT v_plan.bank_pay THEN
    RAISE EXCEPTION 'bank_pay_off' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_t.landlord_id
                    AND pr.stripe_account_id IS NOT NULL AND pr.stripe_payouts_enabled)
     OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_t.landlord_id
                  AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'payouts_not_ready' USING ERRCODE = '22023';
  END IF;
  -- One bank payment in flight per tenancy (a debit takes days; a second one would double-pay).
  IF EXISTS (SELECT 1 FROM public.rental_rent_bank_payments WHERE tenancy_id = p_tenancy_id AND status IN ('open', 'processing')
               AND (status = 'processing' OR created_at > now() - interval '35 minutes')) THEN
    RAISE EXCEPTION 'bank_payment_in_flight' USING ERRCODE = '22023';
  END IF;
  v_open := GREATEST(0, (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_charges
                          WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= public.shop_local_today())
                        - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
                            WHERE tenancy_id = p_tenancy_id AND status = 'confirmed'));
  IF p_rent_cents IS NULL OR p_rent_cents NOT BETWEEN 100 AND 10000000 OR p_rent_cents > v_open + v_plan.amount_cents THEN
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  v_fee := public.rentals_bank_fee_cents(p_rent_cents);
  INSERT INTO public.rental_rent_bank_payments (tenancy_id, rent_cents, fee_cents, fee_payer, charge_cents, transfer_cents)
  VALUES (p_tenancy_id, p_rent_cents, v_fee, v_plan.bank_fee_payer,
          p_rent_cents + CASE WHEN v_plan.bank_fee_payer = 'tenant' THEN v_fee ELSE 0 END,
          p_rent_cents - CASE WHEN v_plan.bank_fee_payer = 'landlord' THEN v_fee ELSE 0 END)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'rent_cents', v_row.rent_cents, 'fee_cents', v_row.fee_cents, 'fee_payer', v_row.fee_payer,
    'charge_cents', v_row.charge_cents, 'transfer_cents', v_row.transfer_cents, 'tenant_id', v_t.tenant_id, 'landlord_id', v_t.landlord_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_start_bank_rent(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_start_bank_rent(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. What Stripe says (service only: the edge functions and the webhook). Each is idempotent.
-- The page opened for a bank payment (and which mode it runs in).
CREATE OR REPLACE FUNCTION public.rentals_bank_rent_attach(p_id uuid, p_session_id text, p_livemode boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_' OR p_livemode IS NULL THEN
    RAISE EXCEPTION 'bad_session' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_bank_payments
     SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, p_session_id), livemode = COALESCE(livemode, p_livemode), updated_at = now()
   WHERE id = p_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_rent_attach(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_rent_attach(uuid, text, boolean) TO service_role;

-- The debit started (Checkout completed; an ACH payment is still unpaid for days).
CREATE OR REPLACE FUNCTION public.rentals_bank_rent_processing(p_id uuid, p_payment_intent_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'bad_payment_intent' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_bank_payments
     SET status = 'processing', stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_payment_intent_id), updated_at = now()
   WHERE id = p_id AND status = 'open';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_rent_processing(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_rent_processing(uuid, text) TO service_role;

-- The bank confirmed it (payment_intent.succeeded): the rent record gets a confirmed payment and the
-- landlord's transfer is queued. Once.
CREATE OR REPLACE FUNCTION public.rentals_bank_rent_succeeded(p_payment_intent_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_b public.rental_rent_bank_payments%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
  v_pay uuid;
  v_money text;
BEGIN
  SELECT * INTO v_b FROM public.rental_rent_bank_payments WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status IN ('succeeded', 'returned') THEN
    RETURN v_b.status;
  END IF;
  INSERT INTO public.rental_rent_payments (tenancy_id, amount_cents, paid_on, pay_method, reported_by, status, decided_at)
  VALUES (v_b.tenancy_id, v_b.rent_cents, public.shop_local_today(), 'bank', 'tenant', 'confirmed', now())
  RETURNING id INTO v_pay;
  UPDATE public.rental_rent_bank_payments
     SET status = 'succeeded', rent_payment_id = v_pay, transfer_status = 'pending', next_transfer_at = now(), updated_at = now()
   WHERE id = v_b.id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_b.tenancy_id;
  v_money := to_char(v_b.rent_cents / 100.0, 'FM$999,999,990.00');
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent paid', 'Your bank confirmed your rent payment of ' || v_money || '. It is on your rent record.', '/rentals', false);
  PERFORM public.rentals_notify(v_t.landlord_id, 'Rent received',
    'Your tenant paid ' || v_money || ' by bank. ' || to_char(v_b.transfer_cents / 100.0, 'FM$999,999,990.00') || ' is on its way to your payout account.', '/rentals', false);
  RETURN 'succeeded';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_rent_succeeded(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_rent_succeeded(text) TO service_role;

-- The debit failed before it succeeded (nothing was recorded), or the page expired unpaid.
CREATE OR REPLACE FUNCTION public.rentals_bank_rent_failed(p_id uuid, p_expired boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_b public.rental_rent_bank_payments%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  UPDATE public.rental_rent_bank_payments
     SET status = CASE WHEN p_expired THEN 'expired' ELSE 'failed' END, updated_at = now()
   WHERE id = p_id AND status IN ('open', 'processing')
  RETURNING * INTO v_b;
  IF FOUND AND NOT COALESCE(p_expired, false) THEN
    SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_b.tenancy_id;
    PERFORM public.rentals_notify(v_t.tenant_id, 'Rent payment did not go through',
      'Your bank payment of ' || to_char(v_b.charge_cents / 100.0, 'FM$999,999,990.00') || ' did not go through. Nothing was paid; try again or pay your landlord directly.',
      '/rentals', true);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_rent_failed(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_rent_failed(uuid, boolean) TO service_role;

-- A return AFTER success (ACH return / dispute): the rent record's payment is reversed and the
-- landlord's transfer pulled back (D9). The tenant and the landlord are told.
CREATE OR REPLACE FUNCTION public.rentals_bank_rent_returned(p_payment_intent_id text, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_b public.rental_rent_bank_payments%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'The bank returned the payment.'), 300);
BEGIN
  SELECT * INTO v_b FROM public.rental_rent_bank_payments WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status <> 'succeeded' THEN
    RETURN v_b.status;
  END IF;
  UPDATE public.rental_rent_payments
     SET status = 'reversed',
         corrections = corrections || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'action', 'bank_return', 'reason', v_reason,
           'from', jsonb_build_object('amount_cents', amount_cents, 'paid_on', paid_on)))
   WHERE id = v_b.rent_payment_id AND status = 'confirmed';
  UPDATE public.rental_rent_bank_payments
     SET status = 'returned',
         transfer_status = CASE WHEN transfer_status = 'succeeded' THEN 'reverse_due' WHEN transfer_status IN ('pending', 'failed') THEN 'none' ELSE transfer_status END,
         next_transfer_at = now(), updated_at = now()
   WHERE id = v_b.id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_b.tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent payment returned',
    'Your bank returned your rent payment of ' || to_char(v_b.rent_cents / 100.0, 'FM$999,999,990.00') || ', so it no longer counts on your rent record.', '/rentals', true);
  PERFORM public.rentals_notify(v_t.landlord_id, 'Rent payment returned',
    'Your tenant''s bank returned their payment of ' || to_char(v_b.rent_cents / 100.0, 'FM$999,999,990.00') || '. It no longer counts, and the payout for it is taken back.', '/rentals', true);
  RETURN 'returned';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_rent_returned(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_rent_returned(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The landlord's transfers (service only): what to send or pull back, and what Stripe did.
CREATE OR REPLACE FUNCTION public.rentals_bank_transfers_due(p_limit integer)
RETURNS TABLE (bank_payment_id uuid, action text, transfer_cents integer, stripe_account_id text, payment_intent_id text,
               stripe_transfer_id text, livemode boolean, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT b.id, CASE WHEN b.transfer_status = 'reverse_due' THEN 'reverse' ELSE 'transfer' END, b.transfer_cents, pr.stripe_account_id,
         b.stripe_payment_intent_id, b.stripe_transfer_id, b.livemode, b.transfer_attempts
    FROM public.rental_rent_bank_payments b
    JOIN public.rental_tenancies t ON t.id = b.tenancy_id
    LEFT JOIN public.profiles pr ON pr.user_id = t.landlord_id
   WHERE ((b.status = 'succeeded' AND b.transfer_status IN ('pending', 'failed')) OR b.transfer_status = 'reverse_due')
     AND b.next_transfer_at <= now() AND b.transfer_attempts < 12
   ORDER BY b.next_transfer_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_transfers_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_transfers_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_bank_transfer_executed(p_id uuid, p_action text, p_transfer_id text, p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_action NOT IN ('transfer', 'reverse') OR (p_succeeded AND p_action = 'transfer' AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_')) THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_bank_payments
     SET transfer_status = CASE WHEN NOT p_succeeded THEN CASE WHEN p_action = 'reverse' THEN 'reverse_due' ELSE 'failed' END
                                WHEN p_action = 'reverse' THEN 'reversed' ELSE 'succeeded' END,
         stripe_transfer_id = CASE WHEN p_succeeded AND p_action = 'transfer' THEN p_transfer_id ELSE stripe_transfer_id END,
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         transfer_attempts = CASE WHEN p_succeeded THEN 0 ELSE least(transfer_attempts + 1, 100) END,
         next_transfer_at = CASE WHEN p_succeeded THEN next_transfer_at
                                 ELSE now() + least(interval '10 minutes' * power(2, least(transfer_attempts, 8)), interval '1 day') END,
         updated_at = now()
   WHERE id = p_id
     AND ((p_action = 'transfer' AND transfer_status IN ('pending', 'failed') AND status = 'succeeded')
          OR (p_action = 'reverse' AND transfer_status = 'reverse_due'))
  RETURNING transfer_status INTO v_status;
  IF NOT FOUND THEN
    SELECT transfer_status INTO v_status FROM public.rental_rent_bank_payments WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_payment_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_bank_transfer_executed(uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_bank_transfer_executed(uuid, text, text, boolean, text) TO service_role;
