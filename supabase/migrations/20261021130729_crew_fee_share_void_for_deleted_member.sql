-- Q1915 (owner decided 2026-10-21): when a crew member deletes their account,
-- their share of a late-cancellation fee goes BACK TO THE POSTER, on the card
-- and the gift paths alike.
--
-- Before: crew_cancellation_fee_shares.helper_id is set NULL by the FK when a
-- member's account is deleted, but the poster was still charged that share
-- and void-cancelled-payments only paged about it, every hour, with nobody to
-- pay. The share could not be closed because the status CHECK allowed only
-- 'pending', 'paid' and 'failed'.
--
-- This adds 'void': void-cancelled-payments marks a deleted member's unpaid
-- share 'void' before it prices the crew's fee (so the poster's refund, or the
-- gift, includes it), or, after the job settled, once the share is refunded to
-- the poster's card. A void row is never paid (the hourly retry reads only
-- 'pending' and 'failed'), and _shared/crewShares.ts leaves it out of the fee
-- (returnsToPoster), as money-reconciliation does.
--
-- REPLAY-SAFETY: the table is created in 20260925154606; this only swaps one
-- CHECK, guarded on the table existing, and is a no-op on a second run.

DO $$
BEGIN
  IF to_regclass('public.crew_cancellation_fee_shares') IS NOT NULL THEN
    ALTER TABLE public.crew_cancellation_fee_shares
      DROP CONSTRAINT IF EXISTS crew_cancellation_fee_shares_status_check;
    ALTER TABLE public.crew_cancellation_fee_shares
      ADD CONSTRAINT crew_cancellation_fee_shares_status_check
      CHECK (status IN ('pending', 'paid', 'failed', 'void'));
  END IF;
END
$$;
