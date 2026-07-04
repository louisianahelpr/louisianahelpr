-- Payment refunds ledger (F-MONEY-04).
--
-- Symmetric to `payout_transfers`: that table is the authoritative record of
-- money moving OUT to helpers; this one is the authoritative record of money
-- moving BACK to customers. Before this, every refund path
-- (cancel_escrow, admin_refund_dispute, admin_refund_general,
-- void-cancelled-payments) issued a `stripe.refunds.create()` and flipped the
-- job's payment_status, but left no queryable row — so "show me every refund in
-- the last 30 days / how much was refunded on this job" required hitting the
-- Stripe API per job. Escrow that comes back to a customer must reconcile the
-- same way a payout does.
--
-- One row per stripe.refunds.create() call. `stripe_refund_id` is unique so a
-- retried/replayed refund (same Stripe idempotency key → same refund id) upserts
-- to the same row instead of duplicating the ledger.

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_refund_id text UNIQUE NOT NULL,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  is_partial boolean NOT NULL DEFAULT false,
  reason text,
  -- Which code path issued this refund. Kept as free text (not an enum) so a
  -- new refund path doesn't require an ALTER TYPE migration.
  source text NOT NULL,
  initiated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_customer_id ON public.payment_refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_job_id ON public.payment_refunds(job_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_created_at ON public.payment_refunds(created_at DESC);

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

-- Customers can see their own refund history.
DROP POLICY IF EXISTS "Customers can read their own refunds" ON public.payment_refunds;
CREATE POLICY "Customers can read their own refunds"
  ON public.payment_refunds FOR SELECT
  TO authenticated
  USING (auth.uid() = customer_id);

-- Admins can read everything for support / reconciliation.
DROP POLICY IF EXISTS "Admins read all refunds" ON public.payment_refunds;
CREATE POLICY "Admins read all refunds"
  ON public.payment_refunds FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No authed-user INSERT/UPDATE path: refund rows are written ONLY by the
-- edge functions using the service role (which bypasses RLS), and admins may
-- write a manual reconciliation row. There is no anon access.
DROP POLICY IF EXISTS "Admins can write refunds (manual reconciliation)" ON public.payment_refunds;
CREATE POLICY "Admins can write refunds (manual reconciliation)"
  ON public.payment_refunds FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.payment_refunds FROM anon;

COMMENT ON TABLE public.payment_refunds IS
'Authoritative ledger of stripe.refunds.create() calls (money returned to customers). Mirror of payout_transfers for the refund side. Written by the refund edge functions (cancel_escrow, admin_refund_dispute, admin_refund_general, void-cancelled-payments).';
