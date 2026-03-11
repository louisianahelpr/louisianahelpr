ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS denial_email_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_denial_email_at timestamptz,
  ADD COLUMN IF NOT EXISTS denial_reason text;