-- ME-017 (7): platform_settings is read everywhere with `.limit(1)` and no
-- order (pay-onboarding-fee, create-payment, complete-signup). An admin INSERT
-- policy exists, so a second row was insertable and every such read would
-- then pick an arbitrary row. Enforce the one-row shape in the database.
-- Replay-safe: IF NOT EXISTS, and skipped (with a notice) if a second row
-- already exists, so the migration never fails a deploy on existing data.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.platform_settings) <= 1 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS platform_settings_singleton
      ON public.platform_settings ((true));
  ELSE
    RAISE NOTICE 'platform_settings has more than one row; singleton index not created';
  END IF;
END $$;
