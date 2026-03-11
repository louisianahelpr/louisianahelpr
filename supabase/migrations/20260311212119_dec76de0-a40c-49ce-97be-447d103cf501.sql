-- Add 'disputed' to job_status enum
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'disputed';

-- Add dispute columns to jobs table
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_evidence_urls text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by uuid;

-- Create fraud_flags table
CREATE TABLE public.fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  flag_type text NOT NULL,
  details text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on fraud_flags
ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;

-- Only admins can view and manage fraud flags
CREATE POLICY "Admins can manage fraud flags"
  ON public.fraud_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Service role can insert fraud flags (from edge functions)
CREATE POLICY "Service role can insert fraud flags"
  ON public.fraud_flags FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');