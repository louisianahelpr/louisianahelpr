-- Paid background check → public "Background-Checked" badge.
--
-- Helpers can pay for their own background screening (via the
-- create-bgc-payment edge function + Stripe). The screening runs through the
-- existing verification engine (helper_credentials + verification_checks),
-- but those tables are RLS-scoped to the owning user — so a viewer can't read
-- another helper's credential rows to render a trust badge.
--
-- To make the *outcome* publicly visible on helper cards/profiles, mirror the
-- final state onto profiles.background_check_status (profiles are world-
-- readable). The sync_credential_from_check() trigger keeps it in lockstep
-- with the underlying verification_check.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS background_check_status text NOT NULL DEFAULT 'none';

-- Guard the CHECK so a from-scratch replay (column may already satisfy it)
-- doesn't abort on a duplicate constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_background_check_status_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_background_check_status_check
      CHECK (background_check_status IN ('none', 'pending', 'verified', 'failed'));
  END IF;
END $$;

-- Extend the credential-sync trigger so a background check passing/failing
-- also flips the public profiles flag. Other check types are unaffected.
CREATE OR REPLACE FUNCTION sync_credential_from_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'passed' THEN
    UPDATE helper_credentials
    SET status = 'verified',
        verified_at = now(),
        expiration_date = NEW.expires_at::date
    WHERE id = NEW.credential_id;
  ELSIF NEW.status = 'failed' THEN
    UPDATE helper_credentials
    SET status = 'rejected',
        rejection_reason = NEW.failure_reason
    WHERE id = NEW.credential_id;
  ELSIF NEW.status = 'expired' THEN
    UPDATE helper_credentials
    SET status = 'expired'
    WHERE id = NEW.credential_id;
  END IF;

  -- Mirror background-check outcomes onto the publicly-readable profile flag.
  IF NEW.check_type = 'background' THEN
    IF NEW.status = 'passed' THEN
      UPDATE profiles SET background_check_status = 'verified' WHERE user_id = NEW.user_id;
    ELSIF NEW.status IN ('failed', 'expired') THEN
      UPDATE profiles SET background_check_status = 'failed' WHERE user_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
