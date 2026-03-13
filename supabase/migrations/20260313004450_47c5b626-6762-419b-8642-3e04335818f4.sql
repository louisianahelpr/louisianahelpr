ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS availability text NULL,
  ADD COLUMN IF NOT EXISTS transportation text NULL,
  ADD COLUMN IF NOT EXISTS hear_about_us text NULL;