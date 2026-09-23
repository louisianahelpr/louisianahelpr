-- Q202 (owner decision 2026-09-23): card-dispute CLAW BACK ledger.
--
-- When a cardholder disputes a charge whose job was already paid out
-- (jobs.payment_status = 'released'), stripe-webhook's charge.dispute.created
-- handler now reverses the Helpr's Stripe transfer(s) for that job
-- (transfer_group job_<id>), and charge.dispute.closed pays them back when the
-- platform WINS the dispute. Before this, a released job's Helpr kept the money
-- and the platform lost the whole charge plus Stripe's ~$15 dispute fee.
--
-- One row per (dispute, original transfer). The row is the idempotency record
-- that makes "never double-reverse, never double-repay" hold across webhook
-- retries and redeliveries, beside Stripe's own idempotency keys
-- (`clawback-<dispute>-<transfer>` / `clawback-repay-<dispute>-<transfer>`):
--   reversing     -> the reversal is being attempted (claimed before the Stripe call)
--   reversed      -> Stripe reversal created (stripe_reversal_id, reversed_cents)
--   reverse_failed-> Stripe refused (e.g. the connected account's balance is
--                    short); error says why; ops is paged (critical alert ledger)
--   repaying      -> dispute WON, the pay-back transfer is being attempted
--   repaid        -> pay-back transfer created (repay_transfer_id)
--   repay_failed  -> pay-back refused; ops paged
--   kept          -> dispute LOST; the reversal stands (final)
--
-- Service role only for writes (the webhook). Admins may read; the Helpr whose
-- transfer it is may read their own rows. No client writes, no anon access.
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before each
-- CREATE POLICY, guarded on to_regclass('public.jobs').

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.chargeback_clawbacks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id text NOT NULL,
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    stripe_transfer_id text NOT NULL,
    stripe_account_id text,
    transfer_amount_cents integer NOT NULL CHECK (transfer_amount_cents >= 0),
    reversed_cents integer NOT NULL DEFAULT 0 CHECK (reversed_cents >= 0),
    stripe_reversal_id text,
    repay_transfer_id text,
    status text NOT NULL DEFAULT 'reversing'
      CHECK (status IN ('reversing', 'reversed', 'reverse_failed', 'repaying', 'repaid', 'repay_failed', 'kept')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chargeback_clawbacks_dispute_transfer_key UNIQUE (dispute_id, stripe_transfer_id)
  );

  CREATE INDEX IF NOT EXISTS chargeback_clawbacks_job_id_idx ON public.chargeback_clawbacks (job_id);
  CREATE INDEX IF NOT EXISTS chargeback_clawbacks_transfer_idx ON public.chargeback_clawbacks (stripe_transfer_id);
  CREATE INDEX IF NOT EXISTS chargeback_clawbacks_helper_idx ON public.chargeback_clawbacks (helper_id);

  ALTER TABLE public.chargeback_clawbacks ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON TABLE public.chargeback_clawbacks FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.chargeback_clawbacks TO authenticated;
  GRANT ALL ON TABLE public.chargeback_clawbacks TO service_role;

  DROP POLICY IF EXISTS "Admins read chargeback clawbacks" ON public.chargeback_clawbacks;
  CREATE POLICY "Admins read chargeback clawbacks" ON public.chargeback_clawbacks
    FOR SELECT TO authenticated
    USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

  DROP POLICY IF EXISTS "Payees read their own chargeback clawbacks" ON public.chargeback_clawbacks;
  CREATE POLICY "Payees read their own chargeback clawbacks" ON public.chargeback_clawbacks
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = helper_id);

  COMMENT ON TABLE public.chargeback_clawbacks IS
    'Q202: one row per (card dispute, reversed payout transfer). Written only by stripe-webhook (chargeDisputeCreated / chargeDisputeClosed via handlers/_chargebackClawback.ts). The idempotency record for reverse-on-dispute and repay-on-win.';
END $$;
