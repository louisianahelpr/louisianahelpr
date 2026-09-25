-- The tip minimum is $3 (owner, 2026-09-24/25; TIP_MIN_CENTS in
-- supabase/functions/_shared/tipFees.ts). A FIXED auto-tip and a percent
-- auto-tip's CAP therefore start at 3. The percent itself stays 1..50: a percent
-- tip that works out under $3 is not charged (auto-tip-charge asks the poster
-- to tip by hand instead).
--
-- Live on 2026-09-25: 1 profile has auto-tip on (percent 15, cap 15), none in
-- fixed mode, so every row already satisfies the new bounds. Replay-safe: the
-- constraint is dropped and re-added under the same name each time.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_auto_tip_valid;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_auto_tip_valid CHECK (
    (auto_tip_mode = 'off'::auto_tip_mode AND auto_tip_value IS NULL)
    OR (
      auto_tip_mode = 'percent'::auto_tip_mode
      AND auto_tip_value >= 1 AND auto_tip_value <= 50
      AND (auto_tip_cap IS NULL OR (auto_tip_cap >= 3 AND auto_tip_cap <= 500))
    )
    OR (
      auto_tip_mode = 'fixed'::auto_tip_mode
      AND auto_tip_value >= 3 AND auto_tip_value <= 500
      AND auto_tip_cap IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_auto_tip_valid;
