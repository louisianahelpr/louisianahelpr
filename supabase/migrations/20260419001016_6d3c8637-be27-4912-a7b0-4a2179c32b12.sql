ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_email_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_verification_email_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_email_verified_pending
  ON public.profiles (email_verified, last_verification_email_at)
  WHERE email_verified = false;