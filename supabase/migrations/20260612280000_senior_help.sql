-- Family care relationships: adult child manages jobs for senior parent
CREATE TABLE IF NOT EXISTS care_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- adult child
  care_recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- senior parent
  relationship text NOT NULL CHECK (relationship IN (
    'child', 'spouse', 'sibling', 'friend', 'professional_caregiver', 'other'
  )),
  permissions text[] NOT NULL DEFAULT ARRAY['view_jobs', 'post_jobs', 'message_helpers'],
  -- permissions: 'view_jobs' | 'post_jobs' | 'message_helpers' | 'manage_payments'
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  invite_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(caregiver_id, care_recipient_id)
);

ALTER TABLE care_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties manage their relationships" ON care_relationships
  FOR ALL USING (
    auth.uid() = caregiver_id OR auth.uid() = care_recipient_id
  );

-- Senior mode preference on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS senior_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_helper_id uuid REFERENCES auth.users(id);
  -- preferred_helper: "always send to Maria first" for recurring trusted helper

CREATE INDEX IF NOT EXISTS care_relationships_caregiver_idx ON care_relationships(caregiver_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS care_relationships_recipient_idx ON care_relationships(care_recipient_id)
  WHERE status = 'active';
