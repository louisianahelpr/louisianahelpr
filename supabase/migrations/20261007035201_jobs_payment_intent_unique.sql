-- Q1355 (4) (docs/OPEN.md): jobs.stripe_payment_intent_id is the key every
-- Stripe webhook uses to find its job (charge.refunded, charge.refund.updated,
-- charge.dispute.*, payment_intent.succeeded), each with .maybeSingle(). It had
-- no index at all, so two jobs carrying one PaymentIntent would make every one
-- of those lookups error (PGRST116) and the webhook throw on every redelivery,
-- with the money event never applied.
--
-- Measured live 2026-10-07 before adding it: no index on the column
-- (pg_indexes), and 0 PaymentIntent ids shared by two jobs
-- (SELECT stripe_payment_intent_id FROM jobs WHERE stripe_payment_intent_id IS
-- NOT NULL GROUP BY 1 HAVING count(*) > 1 -> 0 rows). Every writer stamps one
-- job's own PaymentIntent (stripe-webhook checkoutSessionCompleted, the
-- charge-recurring-visits visit insert, void-cancelled-payments' backfill from
-- the job's own session).
--
-- Partial (NULLs are many and legitimate). Replay-safe: IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_stripe_payment_intent_id_unique_idx
  ON public.jobs (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
