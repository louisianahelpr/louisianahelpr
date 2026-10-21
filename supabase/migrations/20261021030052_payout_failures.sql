-- Board 143(a): a bank payout that FAILS is recorded and shown to its member.
--
-- Before this, stripe-webhook handled transfer.failed (platform -> the member's
-- payout account) but no payout.* event: when the member's BANK returned a
-- payout (account closed, wrong number), nothing in the app knew, and the
-- member was never told. Lead 10-21: a silent failure; build the record and
-- the notice. NOTIFICATION AND RECORD ONLY: no money moves here and no retry
-- logic changes. The money itself is Stripe's: a failed payout returns to the
-- member's payout balance.
--
-- Rows are written only by the webhook (service_role), one per Stripe payout
-- (stripe_payout_id unique) and per event (stripe_event_id unique), so a
-- redelivered event is a no-op. A member reads only their own rows.
-- `resolved_at` is set by the webhook when a later payout to the same account
-- is paid (payout.paid): until then the member's Home card stays.

CREATE TABLE IF NOT EXISTS public.payout_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  stripe_payout_id text NOT NULL,
  stripe_event_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  failure_code text,
  failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_failures_payout_unique UNIQUE (stripe_payout_id),
  CONSTRAINT payout_failures_event_unique UNIQUE (stripe_event_id)
);

CREATE INDEX IF NOT EXISTS payout_failures_open_by_user
  ON public.payout_failures (user_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS payout_failures_open_by_account
  ON public.payout_failures (stripe_account_id) WHERE resolved_at IS NULL;

ALTER TABLE public.payout_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payout_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payout_failures TO authenticated;
GRANT ALL ON TABLE public.payout_failures TO service_role;

DROP POLICY IF EXISTS "payout_failures own read" ON public.payout_failures;
CREATE POLICY "payout_failures own read" ON public.payout_failures
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

