-- Payout transfers audit table.
--
-- Today the only record of "who got paid for what job, when" is reconstructed
-- after the fact from Stripe webhook events that are logged to the
-- `events.txt`-style trail in stripe-webhook/index.ts. There's no queryable
-- table — so a question like "show me every payout sent in the last 30 days"
-- requires hitting the Stripe API for every helper.
--
-- This table is the authoritative ledger: one row per stripe.transfers.create()
-- call, written by the (forthcoming) release-payout edge function. It links
-- back to the source job + the Stripe transfer id so reconciliation is trivial.
--
-- Schema is intentionally minimal — just enough for accounting + dispute
-- traceability. Add fee/tax breakdowns in a separate migration if needed.

CREATE TABLE IF NOT EXISTS public.payout_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stripe_transfer_id text UNIQUE NOT NULL,
  stripe_account_id text NOT NULL,                 -- destination connected account
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'reversed')),
  failure_reason text,
  initiated_by text NOT NULL DEFAULT 'system'
    CHECK (initiated_by IN ('system', 'admin', 'auto')),
  initiated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  failed_at timestamptz,
  reversed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_payout_transfers_helper_id ON public.payout_transfers(helper_id);
CREATE INDEX idx_payout_transfers_job_id ON public.payout_transfers(job_id);
CREATE INDEX idx_payout_transfers_status ON public.payout_transfers(status);
CREATE INDEX idx_payout_transfers_created_at ON public.payout_transfers(created_at DESC);

ALTER TABLE public.payout_transfers ENABLE ROW LEVEL SECURITY;

-- Helpers can see their own payout history.
CREATE POLICY "Helpers can read their own transfers"
  ON public.payout_transfers FOR SELECT
  TO authenticated
  USING (auth.uid() = helper_id);

-- Admins can read everything for support / reconciliation.
CREATE POLICY "Admins read all transfers"
  ON public.payout_transfers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Only the service role inserts (the release-payout edge function writes
-- this row after stripe.transfers.create() succeeds). No direct INSERTs
-- from authed users.
CREATE POLICY "Admins can write transfers (manual reconciliation)"
  ON public.payout_transfers FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Updates only by admins (e.g., marking a failed transfer reversed).
CREATE POLICY "Admins can update transfers"
  ON public.payout_transfers FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.payout_transfers IS
'Authoritative ledger of stripe.transfers.create() calls. Written by the release-payout edge function on completion.';

COMMENT ON COLUMN public.payout_transfers.initiated_by IS
'Origin of this transfer: system (automated cron), admin (manual via dashboard), auto (auto-release-payment 24h timer).';
