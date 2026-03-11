-- Add columns for admin job removal and auto-flagging
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS removal_reason text,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid,
  ADD COLUMN IF NOT EXISTS flag_reasons text[] DEFAULT '{}'::text[];

-- Allow admins to delete jobs (soft delete via update already covered by existing policy)
