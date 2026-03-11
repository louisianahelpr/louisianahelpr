
-- Add payout scheduling column to jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payout_scheduled_at timestamptz DEFAULT NULL;

-- Add latitude/longitude columns to jobs for GPS proximity validation
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS latitude numeric DEFAULT NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS longitude numeric DEFAULT NULL;
