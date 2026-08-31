-- Make payout_transfers claimable, and make double-paying a job impossible at
-- the storage layer.
--
-- ── Problem 1: the ledger cannot record a transfer that was never created ───
--
-- `payout_transfers` is the dedupe oracle for every payout path
-- (release-payout:248, process-scheduled-payouts:269 — both read it and refuse
-- to send when a pending/paid/reversed row exists), and it is the salt source
-- for the Stripe idempotency key. But the ONLY writer of `status='failed'` is
-- stripe-webhook/handlers/transferFailed.ts, which fires only when Stripe
-- CREATED a transfer and then failed to settle it.
--
-- When `stripe.transfers.create` THROWS (insufficient balance, capability
-- error, network), no transfer object exists, no webhook fires, and the catch
-- blocks wrote nothing. The consequences compounded:
--   * `failedCount` stayed 0, so the next run reused the UNSALTED idempotency
--     key and Stripe replayed its cached failure for ~24h — the retry was a
--     silent no-op for a day.
--   * nothing recorded that an attempt had happened at all, so no give-up
--     logic could exist. Measured in prod on 2026-08-31: `payout_transfers`
--     held ONE row while auto-release-payment had failed the same payout 83
--     times over two days.
--
-- The catch blocks could not write a row even if they wanted to:
-- `stripe_transfer_id` was `NOT NULL` and there is no transfer id to write,
-- and `stripe_account_id` was `NOT NULL` while the commonest give-up cause is
-- "the helper has no Connect account". Both are relaxed here. Uniqueness on
-- `stripe_transfer_id` is UNCHANGED and still enforced: Postgres treats NULLs
-- as distinct in a unique index, so many attempt rows with no transfer id
-- coexist while two rows can still never claim the same real transfer.
--
-- ── Problem 2: the cross-function race was arbitrated by an unlocked read ───
--
-- `process-scheduled-payouts` keys transfers `scheduled-payout-${job_id}` and
-- `release-payout` keys them `release-payout-${job_id}` — DIFFERENT keys on the
-- same job, so Stripe will happily create both. The only thing standing between
-- that and a doubled payout is a plain `SELECT` of payout_transfers in each
-- function: no `FOR UPDATE`, no claiming write, and the table's only unique
-- index was on `stripe_transfer_id`, which a not-yet-created transfer does not
-- have. The comment at process-scheduled-payouts:250-258 claims this "closes
-- the race window". An unlocked read cannot close a race; it can only lose one.
--
-- It has not bitten because 20260618130000 unscheduled `process-scheduled-payouts`,
-- leaving one live writer. That is a scheduling accident, not a guarantee — the
-- admin "Release payout" button and auto-release-payment's Phase 2 already call
-- release-payout concurrently with each other.
--
-- The index below makes the invariant structural: AT MOST ONE live transfer per
-- (job, helper), where "live" means money is out or believed out
-- (pending/paid/reversed). It is deliberately PARTIAL rather than a plain
-- UNIQUE (job_id, helper_id):
--   * a retry after a genuine failure is legitimate and must stay possible, so
--     'failed' rows are excluded and any number may accumulate;
--   * 'canceled' (transfer.canceled webhook) and 'reversal_cleared' (an
--     operator's explicit "safe to re-pay" signal) are likewise excluded, which
--     is exactly what those two statuses mean.
--
-- Paired with the claim protocol in the edge functions (INSERT the pending row
-- BEFORE calling Stripe, then UPDATE it to paid/failed), this index is what
-- actually decides the race: the loser's INSERT raises 23505 and it skips
-- without ever reaching stripe.transfers.create. The index alone would only
-- catch the second write AFTER the second transfer had already gone out, so
-- both halves are needed and neither is redundant.
--
-- REPLAY-SAFETY: `payout_transfers` is created by 20260504155115, which runs
-- earlier, so the table is guaranteed present. Everything below is guarded or
-- IF NOT EXISTS. The unique index is created inside a guard that first proves
-- no existing rows violate it, so a from-scratch rebuild replaying historical
-- data can never abort the deploy — it degrades to a NOTICE and leaves the
-- edge-function claim protocol as the sole (still effective) guard.

-- ── 1. Allow an attempt row for a transfer that was never created ───────────
ALTER TABLE public.payout_transfers
  ALTER COLUMN stripe_transfer_id DROP NOT NULL;

ALTER TABLE public.payout_transfers
  ALTER COLUMN stripe_account_id DROP NOT NULL;

COMMENT ON COLUMN public.payout_transfers.stripe_transfer_id IS
$c$Stripe transfer id, or NULL. NULL means one of two things, told apart by status. status='pending' is a CLAIM row written immediately before stripe.transfers.create so a concurrent payout path is locked out; it is updated with the real id on success. status='failed' means the transfer call threw and no Stripe object was ever created, so there is nothing to reference. Uniqueness still holds for non-NULL ids (Postgres treats NULLs as distinct).$c$;

COMMENT ON COLUMN public.payout_transfers.stripe_account_id IS
$c$Destination connected account, or NULL on a failed attempt where the helper had no Connect account to send to — which is the single commonest payout failure.$c$;

-- ── 2. One live transfer per (job, helper) ──────────────────────────────────
DO $$
DECLARE
  v_dupes int;
BEGIN
  IF to_regclass('public.payout_transfers_one_live_per_job_helper') IS NOT NULL THEN
    RAISE NOTICE 'payout_transfers_one_live_per_job_helper already present';
    RETURN;
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT job_id, helper_id
      FROM public.payout_transfers
     WHERE status IN ('pending', 'paid', 'reversed')
     GROUP BY job_id, helper_id
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    -- Never abort the deploy over historical data. A pre-existing duplicate is
    -- itself a finding money-reconciliation should be reporting; creating the
    -- index is not the place to discover it.
    RAISE WARNING 'payout_transfers has % (job_id, helper_id) pair(s) with more than one live transfer — skipping the uniqueness index. Reconcile those pairs, then re-run this migration body.', v_dupes;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX payout_transfers_one_live_per_job_helper
    ON public.payout_transfers (job_id, helper_id)
    WHERE status IN ('pending', 'paid', 'reversed');

  RAISE NOTICE 'payout_transfers_one_live_per_job_helper created';
END;
$$;

-- ── 3. Find stale claims fast ───────────────────────────────────────────────
-- A claim row whose transfer id is still NULL is either in flight (seconds old)
-- or orphaned by a crash between the INSERT and the Stripe call. The payout
-- paths look these up by (job_id, helper_id) on every run; without an index
-- that is a scan of the whole ledger once per payout.
CREATE INDEX IF NOT EXISTS payout_transfers_open_claim_idx
  ON public.payout_transfers (job_id, helper_id, created_at)
  WHERE status = 'pending' AND stripe_transfer_id IS NULL;
