ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS credential_tier integer NOT NULL DEFAULT 0
    CHECK (credential_tier BETWEEN 0 AND 3);

CREATE INDEX IF NOT EXISTS jobs_credential_tier_idx ON jobs(credential_tier)
  WHERE credential_tier > 0;
