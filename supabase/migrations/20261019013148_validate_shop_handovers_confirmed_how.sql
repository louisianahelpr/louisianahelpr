-- Validate shop_handovers_confirmed_how_check (re-added NOT VALID in
-- 20261018211820_shops_handover_payout, Shops M2, #3389). db-deploy's "every
-- public constraint is validated" check (scripts/check-unvalidated-constraints.mjs)
-- failed on it after that migration applied (run 39185291621). Live
-- 2026-10-19: shop_handovers has 0 rows and 0 violators, so VALIDATE scans
-- nothing. Replay-safe: guarded on the constraint existing unvalidated, and
-- VALIDATE on an already-valid constraint is a no-op.

DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.shop_handovers')
          AND conname = 'shop_handovers_confirmed_how_check'
          AND NOT convalidated
     ) THEN
    ALTER TABLE public.shop_handovers
      VALIDATE CONSTRAINT shop_handovers_confirmed_how_check;
  END IF;
END $$;
