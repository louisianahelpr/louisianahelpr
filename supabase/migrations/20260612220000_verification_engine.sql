-- Verification check runs — one row per vendor check attempt
CREATE TABLE IF NOT EXISTS verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES helper_credentials(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor text NOT NULL CHECK (vendor IN (
    'stripe_identity', 'checkr', 'certificial', 'middesk', 'certemy', 'manual'
  )),
  vendor_check_id text,                -- external reference ID from vendor
  check_type text NOT NULL CHECK (check_type IN (
    'identity', 'background', 'insurance', 'trade_license', 'business_entity'
  )),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'pending', 'passed', 'failed', 'expired', 'manual_review'
  )),
  raw_result jsonb,                    -- vendor webhook payload (sanitized)
  failure_reason text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,              -- for continuous monitoring (insurance renews annually)
  next_check_at timestamptz            -- scheduled re-check for expiry monitoring
);

CREATE INDEX IF NOT EXISTS verification_checks_credential_id_idx ON verification_checks(credential_id);
CREATE INDEX IF NOT EXISTS verification_checks_user_id_status_idx ON verification_checks(user_id, status);
CREATE INDEX IF NOT EXISTS verification_checks_next_check_at_idx ON verification_checks(next_check_at)
  WHERE next_check_at IS NOT NULL;

ALTER TABLE verification_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own checks" ON verification_checks
  FOR SELECT USING (auth.uid() = user_id);

-- Exception queue — cases that need human review
CREATE TABLE IF NOT EXISTS verification_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid REFERENCES verification_checks(id),
  credential_id uuid REFERENCES helper_credentials(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exception_type text NOT NULL CHECK (exception_type IN (
    'name_mismatch', 'board_no_api', 'adverse_action', 'document_unclear', 'other'
  )),
  notes text,
  assigned_to text,                    -- support staff email
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'in_progress', 'resolved', 'dismissed'
  )),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE verification_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage exceptions" ON verification_exceptions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
-- Users can see their own
CREATE POLICY "Users see own exceptions" ON verification_exceptions
  FOR SELECT USING (auth.uid() = user_id);

-- Trigger: when a verification_check passes, auto-update helper_credentials.status
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_credential_trigger ON verification_checks;
CREATE TRIGGER sync_credential_trigger
  AFTER UPDATE OF status ON verification_checks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_credential_from_check();

CREATE INDEX IF NOT EXISTS verification_exceptions_status_idx ON verification_exceptions(status)
  WHERE status = 'open';
