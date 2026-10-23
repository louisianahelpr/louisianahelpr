-- PayPal Plan A, phase 6: saved PayPal payment methods (repeat visits, auto-tip), the visit job a
-- repeat-visit payment funds, and the auto-tip payouts still owed. Design:
-- ~/.lh-wt/paypal-design.md §3 (Auto-tip, Recurring visits) and §6 phase 6.
--
-- Builds on 20261023223419_paypal_provider_foundation (phase 1; never edited here).
--
-- 1. paypal_saved_payment_methods: the PayPal vault token a checkout saved (store_in_vault
--    ON_SUCCESS, MEASURED #11), charged later with nobody present (MEASURED #12). Server only.
--    MONEY RULES HELD HERE:
--      * A token belongs to the member who PAID the checkout that vaulted it: an insert must name
--        that captured payment (from_payment_id), whose payer and env must match. No other
--        member's token can be attached to an account.
--      * One active token per member and env (a sandbox token is never charged under live keys).
--      * Entry is behind the switch: an insert is refused when paypal_payments is off for the
--        member, whoever writes it (service role included), like provider_payments.
--      * Once saved, only one change is allowed: active -> revoked (a member removing it, or
--        PayPal's VAULT.PAYMENT-TOKEN.DELETED). Never gated: turning the switch off must never
--        stop a token from being retired. A revoked token is never brought back.
-- 2. provider_payments.funds_job_id: a repeat visit's payment (subject_kind 'recurring_visit')
--    names the visit job it funded, once. The cancel sweep finds a cancelled visit's money by it.
-- 3. paypal_owed_tip_payouts(): tips charged through PayPal whose Helpr payout is not on the
--    manual pay queue yet (auto-tip-charge re-queues them every run). Service role only.
--
-- REPLAY-SAFETY: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS / guarded constraint.

CREATE TABLE IF NOT EXISTS public.paypal_saved_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  env text NOT NULL CHECK (env IN ('sandbox', 'live')),
  vault_id text NOT NULL CHECK (length(btrim(vault_id)) > 0),
  -- A card token is charged as payment_source.card, a PayPal-wallet token as payment_source.paypal.
  source text NOT NULL CHECK (source IN ('card', 'paypal')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- The checkout payment that vaulted it (proves whose it is). Kept if that payment row is ever
  -- removed (RESTRICT: provider_payments rows are never deleted).
  from_payment_id uuid NOT NULL REFERENCES public.provider_payments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (env, vault_id),
  CONSTRAINT paypal_saved_methods_revoked_has_time CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS paypal_saved_methods_one_active
  ON public.paypal_saved_payment_methods (user_id, env) WHERE status = 'active';

ALTER TABLE public.paypal_saved_payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_saved_payment_methods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.paypal_saved_payment_methods TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.paypal_saved_methods_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'saved_method_insert_active_only' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.provider_payments p
                    WHERE p.id = NEW.from_payment_id
                      AND p.payer_id = NEW.user_id
                      AND p.env = NEW.env
                      AND p.status IN ('captured', 'partially_refunded', 'refunded')) THEN
      RAISE EXCEPTION 'saved_method_not_from_members_payment' USING ERRCODE = '42501',
        DETAIL = 'a saved method must name a captured payment this member paid, in the same env';
    END IF;
    IF NOT public.feature_enabled_for_user('paypal_payments', NEW.user_id) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501',
        DETAIL = 'paypal_payments is off for this member (paypal_saved_payment_methods)';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the only change is active -> revoked.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.env IS DISTINCT FROM OLD.env
     OR NEW.vault_id IS DISTINCT FROM OLD.vault_id OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.from_payment_id IS DISTINCT FROM OLD.from_payment_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'saved_method_is_frozen' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'saved_method_revoked_is_final' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_saved_methods_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_paypal_saved_methods_guard ON public.paypal_saved_payment_methods;
CREATE TRIGGER trg_paypal_saved_methods_guard
  BEFORE INSERT OR UPDATE ON public.paypal_saved_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.paypal_saved_methods_guard();

COMMENT ON TABLE public.paypal_saved_payment_methods IS
  'PayPal vault tokens for charges with nobody present (repeat visits, auto-tip). Service role only. Insert names the captured payment of the same member/env that vaulted it, behind paypal_payments; afterwards only active -> revoked.';

-- 2. The visit job a repeat-visit payment funded.
ALTER TABLE public.provider_payments ADD COLUMN IF NOT EXISTS funds_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_payments_funds_job_is_visit'
                   AND conrelid = 'public.provider_payments'::regclass) THEN
    ALTER TABLE public.provider_payments ADD CONSTRAINT provider_payments_funds_job_is_visit
      CHECK (funds_job_id IS NULL OR subject_kind = 'recurring_visit');
  END IF;
END
$do$;
CREATE UNIQUE INDEX IF NOT EXISTS provider_payments_funds_job_once
  ON public.provider_payments (funds_job_id) WHERE funds_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.provider_payments_funds_job_set_once()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Set once, after the money is in; then only the job's deletion may clear it (SET NULL).
  IF NEW.funds_job_id IS DISTINCT FROM OLD.funds_job_id AND NEW.funds_job_id IS NOT NULL THEN
    IF OLD.funds_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'funds_job_is_frozen' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('captured', 'partially_refunded') THEN
      RAISE EXCEPTION 'funds_job_needs_captured_payment' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_payments_funds_job_set_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_payments_funds_job_set_once ON public.provider_payments;
CREATE TRIGGER trg_provider_payments_funds_job_set_once
  BEFORE UPDATE OF funds_job_id ON public.provider_payments
  FOR EACH ROW EXECUTE FUNCTION public.provider_payments_funds_job_set_once();

-- 3. Auto-tips charged through PayPal whose Helpr payout is not queued yet.
CREATE OR REPLACE FUNCTION public.paypal_owed_tip_payouts()
RETURNS TABLE (payment_id uuid, tip_id uuid, job_id uuid, helper_id uuid, tip_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p.id, t.id, t.job_id, t.helper_id, round(t.amount * 100)::integer
    FROM public.provider_payments p
    JOIN public.tips t ON t.id = p.subject_id
   WHERE p.subject_kind = 'tip'
     AND p.status = 'captured'
     AND t.helper_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.provider_payouts po
                      WHERE po.provider_payment_id = p.id
                        AND po.status NOT IN ('failed', 'returned', 'canceled'))
   ORDER BY p.created_at
   LIMIT 200
$fn$;
REVOKE ALL ON FUNCTION public.paypal_owed_tip_payouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_owed_tip_payouts() TO service_role;
