-- Add IDV + onboarding fee fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS idv_status text DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS idv_session_id text,
  ADD COLUMN IF NOT EXISTS idv_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS idv_confidence numeric,
  ADD COLUMN IF NOT EXISTS idv_failure_reason text,
  ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_manual_review boolean NOT NULL DEFAULT false;

-- Constrain idv_status to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_idv_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_idv_status_check
      CHECK (idv_status IN ('not_started','pending','processing','verified','failed','manual_review','skipped'));
  END IF;
END$$;

-- Add hybrid IDV settings to platform_settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS hybrid_idv_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idv_auto_approve_threshold numeric NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS onboarding_fee_cents integer NOT NULL DEFAULT 200;

-- Backfill: existing pending users stay on manual flow
UPDATE public.profiles
   SET legacy_manual_review = true
 WHERE approval_status = 'pending'
   AND legacy_manual_review = false;

-- Index for admin queue lookups
CREATE INDEX IF NOT EXISTS idx_profiles_idv_status ON public.profiles(idv_status) WHERE idv_status IN ('failed','manual_review');
CREATE INDEX IF NOT EXISTS idx_profiles_legacy_manual ON public.profiles(legacy_manual_review) WHERE legacy_manual_review = true;