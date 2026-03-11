ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS poster_completed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS helper_completed_at timestamp with time zone;