CREATE TABLE IF NOT EXISTS helper_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_type text NOT NULL CHECK (credential_type IN (
    'identity', 'background_check', 'trade_license', 'insurance', 'bond'
  )),
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN (
    'unverified', 'submitted', 'verified', 'expired', 'rejected'
  )),
  license_number text,
  license_state text DEFAULT 'LA',
  trade_category text,
  issuing_authority text,
  document_url text,
  expiration_date date,
  verified_at timestamptz,
  rejection_reason text,
  vendor_check_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS helper_credentials_user_id_idx ON helper_credentials(user_id);
CREATE INDEX IF NOT EXISTS helper_credentials_status_idx ON helper_credentials(status);

ALTER TABLE helper_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credentials" ON helper_credentials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own credentials" ON helper_credentials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own credentials" ON helper_credentials
  FOR UPDATE USING (auth.uid() = user_id);

-- Function to compute a user's current credential tier
CREATE OR REPLACE FUNCTION get_user_credential_tier(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1 FROM helper_credentials
        WHERE user_id = p_user_id
          AND credential_type IN ('trade_license')
          AND status = 'verified'
          AND (expiration_date IS NULL OR expiration_date > now())
        ) AND EXISTS (
        SELECT 1 FROM helper_credentials
        WHERE user_id = p_user_id
          AND credential_type IN ('insurance', 'bond')
          AND status = 'verified'
          AND (expiration_date IS NULL OR expiration_date > now())
        )
      THEN 3
      WHEN EXISTS (
        SELECT 1 FROM helper_credentials
        WHERE user_id = p_user_id
          AND credential_type = 'trade_license'
          AND status = 'verified'
          AND (expiration_date IS NULL OR expiration_date > now())
        )
      THEN 2
      WHEN EXISTS (
        SELECT 1 FROM helper_credentials
        WHERE user_id = p_user_id
          AND credential_type = 'identity'
          AND status = 'verified'
        )
      THEN 1
      ELSE 0
    END;
$$;

GRANT EXECUTE ON FUNCTION get_user_credential_tier TO authenticated;
