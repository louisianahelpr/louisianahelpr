-- ME-013: a referral-credit cash-out left no trace but redeemed=true — no
-- transfer id, no time — so money-reconciliation and support could not tie a
-- Stripe transfer to the credits it paid. cash-out-credits stamps both after a
-- successful transfer. Writes stay service-role only (RLS: the one UPDATE
-- policy is service_role; clients have no INSERT/UPDATE policy).
ALTER TABLE public.referral_credits
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text;

COMMENT ON COLUMN public.referral_credits.stripe_transfer_id IS
  'Stripe transfer that paid this credit out (cash-out-credits). NULL = not cashed out, or cashed out before 2026-09-24.';
