-- Drop the redundant column. The existing profiles.onboarding_fee_paid
-- + onboarding_fee_charged_at pair (added in earlier migrations) is the
-- canonical place to track the one-time $2 platform onboarding fee.
-- create-payment, process-scheduled-payouts, and release-payout all
-- read/write that pair.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS connect_onboarding_fee_paid_at;
