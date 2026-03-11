ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reminder_sent boolean NOT NULL DEFAULT false;