-- Predefined skills per job category
CREATE TABLE IF NOT EXISTS helper_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill text NOT NULL,
  category text,
  endorsement_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill)
);

CREATE TABLE IF NOT EXISTS skill_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES helper_skills(id) ON DELETE CASCADE,
  endorser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(skill_id, endorser_id)
);

ALTER TABLE helper_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_endorsements ENABLE ROW LEVEL SECURITY;

-- Anyone can view skills
CREATE POLICY "Skills are public" ON helper_skills FOR SELECT USING (true);
-- Users manage their own skills
CREATE POLICY "Users manage own skills" ON helper_skills
  FOR ALL USING (auth.uid() = user_id);
-- Anyone authenticated can endorse (once per skill per person)
CREATE POLICY "Anyone can endorse" ON skill_endorsements
  FOR INSERT WITH CHECK (auth.uid() = endorser_id AND auth.uid() != (
    SELECT user_id FROM helper_skills WHERE id = skill_id
  ));
CREATE POLICY "Endorsements are public" ON skill_endorsements FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS helper_skills_user_id_idx ON helper_skills(user_id);
CREATE INDEX IF NOT EXISTS skill_endorsements_skill_id_idx ON skill_endorsements(skill_id);

-- Function to increment endorsement count
CREATE OR REPLACE FUNCTION endorse_skill(p_skill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO skill_endorsements (skill_id, endorser_id)
  VALUES (p_skill_id, auth.uid())
  ON CONFLICT (skill_id, endorser_id) DO NOTHING;

  UPDATE helper_skills
  SET endorsement_count = (
    SELECT COUNT(*) FROM skill_endorsements WHERE skill_id = p_skill_id
  )
  WHERE id = p_skill_id;
END;
$$;

GRANT EXECUTE ON FUNCTION endorse_skill TO authenticated;
