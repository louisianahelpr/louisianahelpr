-- Dispute split execution state.
--
-- `rpc_decide_dispute` RECORDS an admin's payout split (poster X% / helper Y%)
-- on `public.disputes.payout_split`, but nothing ever moved the money: the
-- admin UI said so out loud ("Recorded only — a partial split does not move
-- money"). The new `execute-dispute-split` edge function closes that loop —
-- one Stripe transfer for the helper's share, one Stripe refund for the
-- poster's share, both off the job's original PaymentIntent.
--
-- Moving real money needs a durable, single-flight execution record, which the
-- disputes table did not have. These columns are it:
--
--   • execution_status      — the claim/state machine. NULL = never attempted.
--                             'executing' is claimed BEFORE any Stripe call so a
--                             double-clicked or redelivered execution can be
--                             recognised; 'executed' is terminal and refuses a
--                             re-run outright; 'failed' is re-claimable so a run
--                             that died mid-way can be resumed.
--   • execution_started_at  — when the claim was taken (stuck-run forensics).
--   • executed_at           — when BOTH legs settled.
--   • execution_transfer_id / execution_refund_id
--                           — the Stripe object ids, so the two legs are
--                             independently resumable: a run that transferred
--                             but failed to refund records the transfer id,
--                             and the retry skips the leg already done.
--   • execution_helper_cents / execution_refund_cents
--                           — what actually moved, in cents, so the dispute row
--                             reconciles against payout_transfers +
--                             payment_refunds without a Stripe round-trip.
--   • execution_error       — the last failure reason, surfaced to the admin.
--
-- IMPORTANT: 'executing' is deliberately RE-CLAIMABLE (see the edge function's
-- claim query). It is a progress marker, not the anti-double-pay guard — those
-- are (a) the fail-closed `payout_transfers` / `payment_refunds` ledger reads
-- and (b) the deterministic Stripe idempotency keys derived from the dispute id.
-- This is the same trade-off `create-payment`'s cancel_escrow makes with its
-- 'cancelling' claim: a crashed run must never be able to permanently strand
-- half-moved money behind a lock nobody can release.
--
-- Replay-safety: every statement is ADD COLUMN IF NOT EXISTS / DROP ... IF
-- EXISTS / CREATE INDEX IF NOT EXISTS, and `public.disputes` is created by
-- 20260609140000_disputes_table.sql — far earlier than this timestamp — so a
-- from-scratch replay always finds the table. The CHECK constraint is dropped
-- before it is added so a re-run does not fail on a duplicate constraint name.
--
-- No new function is defined here, so the CI grant-guard has nothing to match;
-- the explicit table GRANT/REVOKE below is still stated rather than inherited,
-- for the same reason the guard exists (defaults have been silently stripped
-- before). RLS on `public.disputes` is unchanged and still decides who sees
-- these columns: admins (full), the opener, and the job's two parties.

-- ── 1. Execution-state columns ─────────────────────────────────────
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS execution_status text,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_transfer_id text,
  ADD COLUMN IF NOT EXISTS execution_refund_id text,
  ADD COLUMN IF NOT EXISTS execution_helper_cents integer,
  ADD COLUMN IF NOT EXISTS execution_refund_cents integer,
  ADD COLUMN IF NOT EXISTS execution_error text;

-- Named CHECK, dropped first so the migration is re-runnable. NULL passes
-- (never attempted), which is the state every pre-existing row is in.
ALTER TABLE public.disputes
  DROP CONSTRAINT IF EXISTS disputes_execution_status_check;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_execution_status_check
  CHECK (
    execution_status IS NULL
    OR execution_status IN ('pending', 'executing', 'executed', 'failed')
  );

-- Amounts are cents and can be zero (a 100/0 split moves nothing on one leg),
-- but never negative — a negative here would mean the money math inverted.
ALTER TABLE public.disputes
  DROP CONSTRAINT IF EXISTS disputes_execution_amounts_check;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_execution_amounts_check
  CHECK (
    COALESCE(execution_helper_cents, 0) >= 0
    AND COALESCE(execution_refund_cents, 0) >= 0
  );

-- Ops queue: "which decided splits have not settled yet?". Partial so the index
-- stays tiny — the overwhelming majority of rows are terminal or untouched.
CREATE INDEX IF NOT EXISTS disputes_pending_execution_idx
  ON public.disputes (execution_status, decided_at DESC)
  WHERE execution_status IN ('pending', 'executing', 'failed');

COMMENT ON COLUMN public.disputes.execution_status IS
  'Split-execution state machine: NULL (never attempted) | pending | executing (claimed, re-claimable) | executed (terminal) | failed (re-claimable). Written only by the execute-dispute-split edge function under the service role.';

-- ── 2. Explicit grants ─────────────────────────────────────────────
-- Stated, not inherited. `public.disputes` shipped in 20260609140000 with NO
-- explicit table grant anywhere in the corpus — it has been riding the Supabase
-- default privileges this whole time, which is exactly the thing that has been
-- silently stripped before (the #355/#358/#364/#366 grant-regression saga).
--
-- The grant below is deliberately NON-NARROWING: it restates the CRUD set
-- `authenticated` already has by default rather than trimming it, because every
-- one of those verbs is still gated by the RLS policies from 20260609140000
-- (opener SELECT/UPDATE, both job parties SELECT, admin ALL) and narrowing here
-- would revoke a capability the admin policy is written to allow. `anon` gets
-- nothing: no policy on this table targets it, so the revoke only removes a
-- privilege that RLS already made unusable.
REVOKE ALL ON TABLE public.disputes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.disputes TO authenticated;
