
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS drip_step integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_drip_at timestamptz;
