-- Pet profiles owned by users
CREATE TABLE IF NOT EXISTS pet_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  species text NOT NULL CHECK (species IN ('dog', 'cat', 'bird', 'rabbit', 'reptile', 'other')),
  breed text,
  age_years numeric(4,1),
  weight_lbs numeric(5,1),
  color_markings text,
  microchip_id text,
  vet_name text,
  vet_phone text,
  medical_notes text,           -- allergies, medications, special needs
  behavioral_notes text,        -- anxious, reactive, friendly, etc.
  emergency_contact text,
  feeding_schedule text,
  photo_url text,
  is_evacuation_registered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Daily report cards from helpers
CREATE TABLE IF NOT EXISTS pet_report_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  ate_well boolean,
  exercise_duration_minutes integer,
  potty_breaks integer,
  mood text CHECK (mood IN ('happy', 'calm', 'anxious', 'tired', 'playful')),
  notes text,
  photos text[] DEFAULT '{}',
  gps_walk_summary text,        -- brief: "2 mile walk in City Park"
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Evacuation shelter pets registry (for disaster mode)
CREATE TABLE IF NOT EXISTS evacuation_pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id uuid NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'needs_transport' CHECK (status IN (
    'needs_transport', 'helper_assigned', 'evacuated', 'safe', 'reunited'
  )),
  destination_address text,
  helper_id uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pet_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_report_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE evacuation_pets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their pets" ON pet_profiles FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Report cards visible to owner and helper" ON pet_report_cards
  FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = helper_id);
CREATE POLICY "Helpers create report cards" ON pet_report_cards
  FOR INSERT WITH CHECK (auth.uid() = helper_id);
CREATE POLICY "Evacuation pets public read" ON evacuation_pets FOR SELECT USING (true);
CREATE POLICY "Owners manage evacuation" ON evacuation_pets
  FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Helpers update assigned evacuations" ON evacuation_pets
  FOR UPDATE USING (auth.uid() = helper_id OR auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS pet_profiles_owner_id_idx ON pet_profiles(owner_id);
CREATE INDEX IF NOT EXISTS pet_report_cards_job_id_idx ON pet_report_cards(job_id);
CREATE INDEX IF NOT EXISTS evacuation_pets_status_idx ON evacuation_pets(status)
  WHERE status IN ('needs_transport', 'helper_assigned');
