
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_email_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_approval_email_at timestamptz;
