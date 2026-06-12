ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS has_applied_before boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS id_verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (id_verification_status IN ('unverified', 'prompted', 'submitted', 'verified', 'failed'));
