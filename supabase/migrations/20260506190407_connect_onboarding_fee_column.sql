-- Initially added a connect_onboarding_fee_paid_at column for a one-time
-- $2 fee deducted from a helper's first payout. Then realized the
-- existing profiles.onboarding_fee_paid + onboarding_fee_charged_at pair
-- already implements the same concept, used by create-payment +
-- process-scheduled-payouts. Column dropped in the next migration to
-- keep a single source of truth — keeping this file for migration history.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS connect_onboarding_fee_paid_at timestamptz;

COMMENT ON COLUMN public.profiles.connect_onboarding_fee_paid_at IS
  'DEPRECATED — replaced by onboarding_fee_paid + onboarding_fee_charged_at. Will be dropped in 20260506330000.';
