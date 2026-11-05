-- Q1918 + Q2148 (2): what to subtract from Stripe's Tax report.
--
-- Stripe Tax never lowers the tax it reports for two things our app does on a
-- Checkout `automatic_tax` charge (docs.stripe.com/tax/reports, "Tax
-- calculations recorded in reports", read 2026-11-04): "Disputes that are
-- upheld by the cardholder's bank" and "Refunds of uncaptured amounts of a
-- payment ... a partial capture for payments of Checkout sessions using
-- capture_method=manual". No Tax API transaction is reachable from a Checkout
-- session (Stripe TEST probe run 41930346999), so there is nothing to reverse
-- on Stripe's side. Lead decision 2026-11-04 8:00 PM: never change how a card
-- is charged; record the tax ACTUALLY collected in our own ledger, and file
-- from it. Lead 8:25 PM: adjustments only (do not copy Stripe's report): one
-- row per correction, livemode + seed rows never reach the export.
--
-- Writers: service role only (stripe-webhook charge.dispute.closed lost
-- branch; the automatic_tax partial-capture paths), idempotent on dedupe_ref.
-- Reader: public.admin_sales_tax_adjustments (admin only).
-- For verdict: lh-money-escrow + lh-authz-rls.

CREATE TABLE IF NOT EXISTS public.sales_tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('partial_capture', 'dispute_lost')),
  -- Which Checkout automatic_tax flow took the charge.
  flow text NOT NULL CHECK (flow IN ('job', 'gift_card', 'boost', 'bgc', 'pro', 'shop_order', 'other')),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  stripe_payment_intent_id text NOT NULL,
  stripe_charge_id text,
  -- 'dispute:<du_>' or 'capture:<pi_>': a webhook retry or a sweep re-run
  -- writes the same ref and is ignored.
  dedupe_ref text NOT NULL UNIQUE,
  -- What Stripe's report still shows for this charge, and what we kept.
  tax_reported_cents integer NOT NULL CHECK (tax_reported_cents >= 0),
  tax_collected_cents integer NOT NULL CHECK (tax_collected_cents >= 0),
  adjustment_cents integer GENERATED ALWAYS AS (tax_collected_cents - tax_reported_cents) STORED,
  state_code text,
  postal_code text,
  currency text NOT NULL DEFAULT 'usd',
  livemode boolean NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  -- When the liability changed (the dispute closing / the capture).
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_tax_adjustments_never_adds CHECK (tax_collected_cents <= tax_reported_cents)
);
CREATE INDEX IF NOT EXISTS sales_tax_adjustments_occurred_idx ON public.sales_tax_adjustments (occurred_at);
CREATE INDEX IF NOT EXISTS sales_tax_adjustments_pi_idx ON public.sales_tax_adjustments (stripe_payment_intent_id);

ALTER TABLE public.sales_tax_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_tax_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sales_tax_adjustments TO service_role;

-- The filing export: live, non-seed corrections in [p_from, p_to). Admin only.
CREATE OR REPLACE FUNCTION public.admin_sales_tax_adjustments(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  occurred_at timestamptz,
  kind text,
  flow text,
  job_id uuid,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  state_code text,
  postal_code text,
  tax_reported_cents integer,
  tax_collected_cents integer,
  adjustment_cents integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'bad period' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.occurred_at, a.kind, a.flow, a.job_id, a.stripe_payment_intent_id, a.stripe_charge_id,
           a.state_code, a.postal_code, a.tax_reported_cents, a.tax_collected_cents, a.adjustment_cents
      FROM public.sales_tax_adjustments a
     WHERE a.livemode
       AND NOT a.is_seed
       AND a.occurred_at >= p_from
       AND a.occurred_at < p_to
     ORDER BY a.occurred_at, a.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_sales_tax_adjustments(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sales_tax_adjustments(timestamptz, timestamptz) TO authenticated, service_role;

-- Q807: refuse writes from an unconfirmed email on the new table (standard guarded attach).
-- Server contexts (stripe-webhook on service_role) carry no end-user sub and pass untouched.
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;
