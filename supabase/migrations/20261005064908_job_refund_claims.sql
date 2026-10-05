-- Who holds a job's 'cancelling' refund claim (docs/OPEN.md Q1323; the
-- lh-money-escrow review of Q1290, 2026-10-05).
--
-- jobs.payment_status = 'cancelling' is a refund-in-flight claim taken by two
-- paths: create-payment cancel_escrow (the poster cancels a funded, unhired
-- job) and, since Q1290, create-payment admin_refund_general (a full admin
-- refund). Nothing recorded WHICH path held it, so:
--   * cancel_escrow, which re-enters 'cancelling' to finish its own stranded
--     claim, could take over an admin refund's claim and refund the same
--     charge under a second idempotency key;
--   * money-reconciliation's cancelling_stranded page guessed the owner from
--     helper_id (wrong for an admin refund of an open job);
--   * a stranded admin claim answered "the cancellation is refunding right
--     now" to every later admin refund, forever.
-- One row per held claim: the path that took it, who, and when. Written by the
-- service role right after the job's compare-and-set to 'cancelling' (a claim
-- whose row cannot be written is put back at once and the call answers 503),
-- deleted when the claim is put back. A job closed from 'cancelling'
-- (refunded / cancelled) keeps its row, which matters only while the job
-- reads 'cancelling'. cancel_escrow re-enters 'cancelling' only when this row
-- positively says cancel_escrow. The job CAS stays the lock; this row says
-- whose it is.
--
-- Readers/writers: create-payment and money-reconciliation (service role).
-- Nothing else may read or write it: RLS on with no policy, revoked from
-- PUBLIC, anon and authenticated.
--
-- REPLAY-SAFETY: public.jobs exists from the first migration; every statement
-- is IF NOT EXISTS / OR REPLACE.

CREATE TABLE IF NOT EXISTS public.job_refund_claims (
  job_id     uuid        PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  claimed_by text        NOT NULL CHECK (claimed_by IN ('cancel_escrow', 'admin_refund_general')),
  actor_user_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_refund_claims ENABLE ROW LEVEL SECURITY;
SELECT public.attach_unconfirmed_email_gate();

REVOKE ALL ON TABLE public.job_refund_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_refund_claims TO service_role;

COMMENT ON TABLE public.job_refund_claims IS
  'Q1323: which path holds a job''s payment_status=''cancelling'' refund claim (cancel_escrow or admin_refund_general), and since when. Service role only.';
