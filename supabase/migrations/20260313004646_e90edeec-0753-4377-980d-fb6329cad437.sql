ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS experience_level text NULL,
  ADD COLUMN IF NOT EXISTS tools_equipment text NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text NULL,
  ADD COLUMN IF NOT EXISTS job_radius text NULL;