-- Q1272 (1) (lh-money-escrow review of Q753): the one-time setup fee is a
-- whole number of dollars, enforced.
--
-- A per-job take-home preview computes floor(x - fee) like the server, while a
-- total computes sum(floor(x)) - fee. The two agree only while
-- platform_settings.onboarding_fee_cents is a whole dollar, and nothing kept it
-- one (no CHECK; the live value is 200, read-only SQL 2026-10-07). Nothing in
-- src/ writes the column (the admin console has no editor for it), so the only
-- writers are migrations and hand SQL, which this now refuses for a cents
-- amount.
--
-- Guard: src/test/onboardingFeeWholeDollars.test.ts (reads this constraint
-- from the migrations and the rounding rule in src/lib/firstPayoutFee.ts).
-- Replay-safe: added only when absent; the live row (200) satisfies it.

DO $$
BEGIN
  IF to_regclass('public.platform_settings') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'platform_settings_onboarding_fee_whole_dollars'
                        AND conrelid = 'public.platform_settings'::regclass) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_onboarding_fee_whole_dollars
      CHECK (onboarding_fee_cents IS NULL OR (onboarding_fee_cents >= 0 AND onboarding_fee_cents % 100 = 0));
  END IF;
END
$$;
