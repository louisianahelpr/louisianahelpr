-- Add revision_requested to job_status enum
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'revision_requested';

-- Add revision columns to jobs table
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS revision_note text,
ADD COLUMN IF NOT EXISTS revision_requested_at timestamp with time zone;
