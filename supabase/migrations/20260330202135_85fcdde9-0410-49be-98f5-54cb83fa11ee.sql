
-- Add dispute resolution sub-status and helper response fields
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS dispute_status text DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS dispute_helper_response text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamp with time zone DEFAULT NULL;

-- Update existing disputed jobs to have 'open' status
UPDATE public.jobs SET dispute_status = 'open' WHERE status = 'disputed' AND dispute_status IS NULL;
