-- 1. Add the legacy flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_legacy_user boolean NOT NULL DEFAULT false;

-- 2. One-time backfill: every existing user is "legacy" and bypasses the gate
UPDATE public.profiles
SET is_legacy_user = true
WHERE created_at < NOW();

-- 3. Helpful index for the gate check
CREATE INDEX IF NOT EXISTS idx_profiles_is_legacy_user
  ON public.profiles (is_legacy_user)
  WHERE is_legacy_user = false;