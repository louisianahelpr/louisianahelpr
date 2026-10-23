-- PayPal Plan A, phase 1 (owner 2026-10-23: Stripe closed the platform account; build PayPal
-- behind a switch that starts OFF). Design: ~/.lh-wt/paypal-design.md, sections 5 and 6.
--
-- WHAT THIS ADDS, AND WHY IT TOUCHES NO EXISTING TABLE
-- The Stripe ids live in 76 columns across 39 tables, read by 150 SQL functions. `jobs` carries a
-- table-level UPDATE grant for members and is protected column by column by triggers
-- (enforce_poster_jobs_money_lock and friends). A new money column on `jobs` would be writable by
-- a member until every one of those triggers learned about it. So the PayPal references go in NEW
-- tables that members cannot read or write at all (service_role only, RLS on, no policies):
--
--   provider_payments   one row per money-in (a job, a tip, a repeat visit): order + capture ids.
--   provider_refunds    one row per refund of a provider_payments row.
--   provider_payouts    one row per money-out to a Helpr. The payout leg is its own provider: live
--                       PayPal Payouts was denied 2026-10-23, so the launch path is MANUAL (owner
--                       2026-10-23: an admin pays by hand with PayPal Send Money and marks it paid
--                       with PayPal's transaction id); the Payouts API or another service later.
--   payee_accounts      where a member is paid (their PayPal email, entered once), per env.
--   paypal_webhook_events  the verified-webhook inbox (event id is the primary key, so a
--                       redelivered event is a no-op), like stripe_webhook_events.
--
-- MONEY RULES HELD BY THE DATABASE (review lh-money-escrow / lh-authz-rls, 2026-10-23):
--   * One live funded payment per subject: a second tab's second order cannot also be captured
--     into a funded row for the same job (provider_payments_one_funded_per_subject).
--   * A payout names the payment it pays out of and the payout_transfers claim row (the existing
--     one-live-payout-per-job+Helpr lock), both NOT NULL, and is never more than that payment.
--   * A payout copies WHERE the money goes (destination) when it is queued, so a later email
--     change or account deletion cannot change what the admin pays or what the record shows.
--   * A manual payout reads "success" only with its evidence (PayPal transaction id, who, when),
--     one transaction id marks one payout, and once marked its money fields are frozen.
--   * No refund while a payout of the same payment is queued or sent (pending counts: with manual
--     payouts the admin may have sent the money before pressing "Mark paid"), and refunds never
--     exceed the payment. A refund after payout (dispute, Helpr fault) is a later phase's
--     explicit path, not this table's default.
--
-- THE SWITCH IS ENFORCED HERE TOO. 'paypal_payments' is created OFF. Hiding a button is never the
-- protection, and crons/webhooks have no signed-in user, so the two ENTRY tables refuse a row for a
-- member the switch is off for, whoever writes it (service role included):
--   provider_payments INSERT (new money in: the payer); payer_id may later only become NULL.
--   payee_accounts INSERT, an UPDATE that changes who or where, and one that turns verified/payable
--   ON (not one that only turns them off: an admin must be able to stop a hijacked destination with
--   the switch off). A new destination always resets verified.
-- Refunds and payouts are not gated: they only follow an existing provider_payments row, and
-- turning the switch off must never strand money already taken.
--
-- REPLAY-SAFETY: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS throughout; the switch
-- insert is ON CONFLICT DO NOTHING (an admin's later flip is never overwritten).

INSERT INTO public.feature_switches (key, audience, description) VALUES
  ('paypal_payments', 'off',
   'PayPal payments (replaces Stripe): checkout, refunds and Helpr payouts. Off = no PayPal payment or payout destination can be created for anyone. Testers = admins and test accounts only (sandbox).')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.provider_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL CHECK (subject_kind IN ('job', 'tip', 'recurring_visit')),
  subject_id uuid NOT NULL,
  -- A job can outlive its poster (deletion anonymises), so the payer may become null later.
  payer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('paypal_checkout')),
  env text NOT NULL CHECK (env IN ('sandbox', 'live')),
  -- Must name the amount (and an attempt number): PayPal answers a reused PayPal-Request-Id with
  -- the ORIGINAL order, so a key without the amount would charge an old price after a re-price.
  idempotency_key text NOT NULL UNIQUE,
  provider_order_id text NOT NULL,
  provider_capture_id text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  -- capture_pending: PayPal captured but the money has not settled (e.g. eCheck): NOT funded.
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'approved', 'capture_pending', 'captured', 'partially_refunded',
                      'refunded', 'disputed', 'reversed', 'voided', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id),
  UNIQUE (provider, provider_capture_id),
  CONSTRAINT provider_payments_captured_has_capture
    CHECK (status IN ('created', 'approved', 'voided', 'failed') OR provider_capture_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS provider_payments_subject_idx ON public.provider_payments (subject_kind, subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_payments_one_funded_per_subject
  ON public.provider_payments (subject_kind, subject_id)
  WHERE status IN ('capture_pending', 'captured', 'partially_refunded', 'disputed');

CREATE TABLE IF NOT EXISTS public.provider_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_payment_id uuid NOT NULL REFERENCES public.provider_payments(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  provider_refund_id text UNIQUE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_refunds_payment_idx ON public.provider_refunds (provider_payment_id);

CREATE TABLE IF NOT EXISTS public.provider_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The money this pays out of, and the existing claim row (payout_transfers: one live payout
  -- per job+Helpr). Both required: a payout outside the claim lock would skip it.
  provider_payment_id uuid NOT NULL REFERENCES public.provider_payments(id) ON DELETE RESTRICT,
  payout_transfer_id uuid NOT NULL UNIQUE REFERENCES public.payout_transfers(id) ON DELETE RESTRICT,
  payee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- manual_paypal (owner 2026-10-23, the launch path): an admin pays the Helpr by hand with PayPal
  -- Send Money and marks the row paid with PayPal's transaction id. paypal_payouts: the Payouts
  -- API, once PayPal approves it. Later payout services add their own value here.
  provider text NOT NULL CHECK (provider IN ('manual_paypal', 'paypal_payouts')),
  env text NOT NULL CHECK (env IN ('sandbox', 'live')),
  -- Copied from payee_accounts when queued, then frozen: what the admin pays and the record keeps.
  destination_kind text NOT NULL CHECK (destination_kind IN ('paypal_email', 'paypal_payer_id', 'venmo_handle')),
  destination_value text NOT NULL CHECK (length(btrim(destination_value)) > 0),
  -- Payouts API only: one payout per batch (sender_batch_id is UNIQUE here and at PayPal for 30
  -- days; this UNIQUE is the first lock, PayPal's the second).
  sender_batch_id text UNIQUE,
  provider_batch_id text,
  provider_item_id text UNIQUE,
  -- Manual payouts only: PayPal's transaction id for the Send Money, who pressed "Mark paid", when.
  external_txn_id text UNIQUE,
  -- No foreign key on purpose: evidence outlives the admin's account (a SET NULL would break the
  -- evidence check and block deleting that account).
  marked_paid_by uuid,
  marked_paid_at timestamptz,
  -- When a marked-paid payout comes back (returned / refunded by the Helpr): PayPal's reference.
  return_ref text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  fee_cents bigint CHECK (fee_cents IS NULL OR fee_cents >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'unclaimed', 'returned', 'failed', 'blocked', 'refunded', 'held', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_payouts_api_fields
    CHECK (provider <> 'paypal_payouts'
           OR (sender_batch_id IS NOT NULL AND external_txn_id IS NULL AND marked_paid_at IS NULL AND marked_paid_by IS NULL)),
  CONSTRAINT provider_payouts_manual_fields
    CHECK (provider <> 'manual_paypal'
           OR (sender_batch_id IS NULL AND provider_batch_id IS NULL AND provider_item_id IS NULL)),
  -- A manual payout reads as paid only with its evidence: never "success" on a bare click.
  CONSTRAINT provider_payouts_manual_success_has_evidence
    CHECK (provider <> 'manual_paypal' OR status <> 'success'
           OR (external_txn_id IS NOT NULL AND marked_paid_at IS NOT NULL AND marked_paid_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS provider_payouts_payment_idx ON public.provider_payouts (provider_payment_id);

CREATE TABLE IF NOT EXISTS public.payee_accounts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The payout NETWORK, not how we pay: a PayPal email serves the manual Send Money path and,
  -- later, the Payouts API alike.
  provider text NOT NULL CHECK (provider IN ('paypal')),
  -- Per env, so a sandbox test email can never become the live destination.
  env text NOT NULL CHECK (env IN ('sandbox', 'live')),
  paypal_payer_id text,
  paypal_email text,
  venmo_handle text,
  verified boolean NOT NULL DEFAULT false,
  payable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, env),
  CONSTRAINT payee_accounts_has_destination
    CHECK (paypal_payer_id IS NOT NULL OR paypal_email IS NOT NULL OR venmo_handle IS NOT NULL)
);
-- Not unique (a couple may share one PayPal account), but an admin check reads it: several
-- members paid to one PayPal account is a fraud signal.
CREATE INDEX IF NOT EXISTS payee_accounts_email_idx ON public.payee_accounts (lower(paypal_email)) WHERE paypal_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.paypal_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  resource_type text,
  resource_id text,
  env text NOT NULL CHECK (env IN ('sandbox', 'live')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS paypal_webhook_events_unprocessed_idx
  ON public.paypal_webhook_events (received_at) WHERE processed_at IS NULL;

-- Server-only: RLS on with no policy, and no grant to members or the anon key.
ALTER TABLE public.provider_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_payments, public.provider_refunds, public.provider_payouts,
  public.payee_accounts, public.paypal_webhook_events FROM PUBLIC, anon, authenticated;
-- Server-only, said out loud (one GRANT per table: check-migration-relation-grants reads it so).
GRANT SELECT, INSERT, UPDATE ON public.provider_payments TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.provider_refunds TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.provider_payouts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payee_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.paypal_webhook_events TO service_role;

-- The Q807 statement gate every public table carries (no client writes here anyway; this keeps
-- the class uniform).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The switch, enforced on the two entry tables for whoever writes the row.
CREATE OR REPLACE FUNCTION public.paypal_entry_requires_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_member uuid;
BEGIN
  IF TG_TABLE_NAME = 'provider_payments' THEN
    IF TG_OP = 'UPDATE' THEN
      -- The payer is fixed once money is in; only account deletion may clear it (SET NULL).
      IF NEW.payer_id IS DISTINCT FROM OLD.payer_id AND NEW.payer_id IS NOT NULL THEN
        RAISE EXCEPTION 'payer_immutable' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    v_member := NEW.payer_id;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
         AND NEW.paypal_email IS NOT DISTINCT FROM OLD.paypal_email
         AND NEW.paypal_payer_id IS NOT DISTINCT FROM OLD.paypal_payer_id
         AND NEW.venmo_handle IS NOT DISTINCT FROM OLD.venmo_handle THEN
        -- Who and where unchanged: the values the writer set stand. Turning verified/payable OFF
        -- needs no switch (an admin stopping a hijacked destination); turning either ON is a new
        -- payout path and needs the switch (checked below).
        IF NOT ((NEW.verified AND NOT OLD.verified) OR (NEW.payable AND NOT OLD.payable)) THEN
          RETURN NEW;
        END IF;
      ELSE
        -- A new destination (or owner) is unproven: never "verified" until shown again. Whether it
        -- is payable is the writer's call (set_paypal_payee_email sets payable and holds that
        -- Helpr's pending manual payouts, which keep their own frozen copy of the old destination).
        NEW.verified := false;
      END IF;
    END IF;
    v_member := NEW.user_id;
  END IF;
  IF NOT public.feature_enabled_for_user('paypal_payments', v_member) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501',
      DETAIL = format('paypal_payments is off for this member (%s)', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_entry_requires_switch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_payments_requires_switch ON public.provider_payments;
CREATE TRIGGER trg_provider_payments_requires_switch
  BEFORE INSERT OR UPDATE ON public.provider_payments
  FOR EACH ROW EXECUTE FUNCTION public.paypal_entry_requires_switch();

DROP TRIGGER IF EXISTS trg_payee_accounts_requires_switch ON public.payee_accounts;
CREATE TRIGGER trg_payee_accounts_requires_switch
  BEFORE INSERT OR UPDATE ON public.payee_accounts
  FOR EACH ROW EXECUTE FUNCTION public.paypal_entry_requires_switch();

-- Payouts: never more than the payment; once marked paid, the money fields are frozen.
CREATE OR REPLACE FUNCTION public.provider_payouts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_paid bigint;
  v_refunded bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.marked_paid_at IS NOT NULL THEN
    -- Paid money never "un-happens" by a status edit: a marked-paid payout may only go from
    -- success to returned/refunded, with the return's reference. Never to canceled/failed, which
    -- would let the refund guard pay the same money out again to the poster.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'success' AND NEW.status IN ('returned', 'refunded') AND NEW.return_ref IS NOT NULL) THEN
      RAISE EXCEPTION 'payout_marked_paid_is_frozen' USING ERRCODE = '42501',
        DETAIL = 'a paid payout may only become returned/refunded, with return_ref';
    END IF;
    IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.payout_transfer_id IS DISTINCT FROM OLD.payout_transfer_id
       OR NEW.destination_kind IS DISTINCT FROM OLD.destination_kind
       OR NEW.destination_value IS DISTINCT FROM OLD.destination_value
       OR NEW.external_txn_id IS DISTINCT FROM OLD.external_txn_id
       OR NEW.marked_paid_at IS DISTINCT FROM OLD.marked_paid_at
       OR (NEW.marked_paid_by IS DISTINCT FROM OLD.marked_paid_by AND NEW.marked_paid_by IS NOT NULL)
       OR (OLD.return_ref IS NOT NULL AND NEW.return_ref IS DISTINCT FROM OLD.return_ref) THEN
      RAISE EXCEPTION 'payout_marked_paid_is_frozen' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.destination_value IS DISTINCT FROM OLD.destination_value
                           OR NEW.destination_kind IS DISTINCT FROM OLD.destination_kind) THEN
    RAISE EXCEPTION 'payout_destination_is_frozen' USING ERRCODE = '42501',
      DETAIL = 'cancel this payout and queue a new one for a new destination';
  END IF;
  -- Serialize money movements on one payment (payout vs refund vs payout).
  PERFORM 1 FROM public.provider_payments WHERE id = NEW.provider_payment_id FOR UPDATE;
  -- Only settled, undisputed money is paid out (not pending, not disputed, not refunded).
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.provider_payments
                                       WHERE id = NEW.provider_payment_id AND status IN ('captured', 'partially_refunded')) THEN
    RAISE EXCEPTION 'payout_needs_settled_payment' USING ERRCODE = '42501';
  END IF;
  -- Live payouts plus live refunds out of one payment never exceed it.
  SELECT COALESCE(sum(r.amount_cents), 0) INTO v_refunded
    FROM public.provider_refunds r
   WHERE r.provider_payment_id = NEW.provider_payment_id
     AND r.status NOT IN ('failed', 'cancelled');
  SELECT COALESCE(sum(p.amount_cents), 0) INTO v_paid
    FROM public.provider_payouts p
   WHERE p.provider_payment_id = NEW.provider_payment_id
     AND p.id <> NEW.id
     AND p.status NOT IN ('failed', 'returned', 'canceled');
  IF NEW.status NOT IN ('failed', 'returned', 'canceled')
     AND v_paid + v_refunded + NEW.amount_cents > (SELECT amount_cents FROM public.provider_payments WHERE id = NEW.provider_payment_id) THEN
    RAISE EXCEPTION 'payout_exceeds_payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_payouts_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_payouts_guard ON public.provider_payouts;
CREATE TRIGGER trg_provider_payouts_guard
  BEFORE INSERT OR UPDATE ON public.provider_payouts
  FOR EACH ROW EXECUTE FUNCTION public.provider_payouts_guard();

-- Refunds: never while a payout of the same money is queued or sent; never more than the payment.
CREATE OR REPLACE FUNCTION public.provider_refunds_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_refunded bigint;
BEGIN
  IF NEW.status IN ('failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  -- Serialize money movements on one payment (refund vs payout vs refund).
  PERFORM 1 FROM public.provider_payments WHERE id = NEW.provider_payment_id FOR UPDATE;
  -- A NEW refund (or a dead one brought back) is the decision point. A live refund's later status
  -- update (pending -> completed) must always be recordable, whatever was queued since.
  IF TG_OP = 'INSERT' OR OLD.status IN ('failed', 'cancelled') OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.provider_payments
                    WHERE id = NEW.provider_payment_id AND status IN ('captured', 'partially_refunded', 'disputed')) THEN
      RAISE EXCEPTION 'refund_needs_captured_payment' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.provider_payouts p
                WHERE p.provider_payment_id = NEW.provider_payment_id
                  AND p.status NOT IN ('failed', 'returned', 'canceled')) THEN
      RAISE EXCEPTION 'refund_after_payout_queued' USING ERRCODE = '42501',
        DETAIL = 'a payout of this payment is queued or sent; cancel it first';
    END IF;
  END IF;
  SELECT COALESCE(sum(r.amount_cents), 0) INTO v_refunded
    FROM public.provider_refunds r
   WHERE r.provider_payment_id = NEW.provider_payment_id
     AND r.id <> NEW.id
     AND r.status NOT IN ('failed', 'cancelled');
  IF v_refunded + NEW.amount_cents > (SELECT amount_cents FROM public.provider_payments WHERE id = NEW.provider_payment_id) THEN
    RAISE EXCEPTION 'refund_exceeds_payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_refunds_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_refunds_guard ON public.provider_refunds;
CREATE TRIGGER trg_provider_refunds_guard
  BEFORE INSERT OR UPDATE ON public.provider_refunds
  FOR EACH ROW EXECUTE FUNCTION public.provider_refunds_guard();

COMMENT ON TABLE public.provider_payments IS
  'PayPal (and later) money-in per job/tip/visit. Service role only. Insert refused unless paypal_payments is on for the payer; one funded row per subject.';
COMMENT ON TABLE public.provider_payouts IS
  'Money-out to a Helpr out of one provider_payments row. manual_paypal: an admin paid by hand and marked it with PayPal''s transaction id (success needs that evidence; then frozen). paypal_payouts: sender_batch_id UNIQUE is the first duplicate-payment lock.';
COMMENT ON TABLE public.payee_accounts IS
  'Where a member is paid, per network and env. Service role only. Insert, a change of who/where, or turning verified/payable on refused unless paypal_payments is on for the member; a new destination resets verified.';
COMMENT ON TABLE public.paypal_webhook_events IS
  'Verified PayPal webhook inbox; event_id PK makes redelivery a no-op. Nothing is stored before the signature is verified.';
