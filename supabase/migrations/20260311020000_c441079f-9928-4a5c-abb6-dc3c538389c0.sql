
-- Add recurring job fields
ALTER TABLE public.jobs ADD COLUMN is_recurring boolean DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN recurrence_interval text; -- 'daily', 'weekly', 'biweekly', 'monthly'
ALTER TABLE public.jobs ADD COLUMN recurrence_end_date date;
ALTER TABLE public.jobs ADD COLUMN parent_job_id uuid REFERENCES public.jobs(id);

-- Add photo proof fields
ALTER TABLE public.jobs ADD COLUMN proof_before_urls text[] DEFAULT '{}';
ALTER TABLE public.jobs ADD COLUMN proof_after_urls text[] DEFAULT '{}';

-- Add cancellation tracking
ALTER TABLE public.jobs ADD COLUMN cancelled_by uuid;
ALTER TABLE public.jobs ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN cancellation_reason text;
ALTER TABLE public.jobs ADD COLUMN late_cancellation boolean DEFAULT false;

-- Create storage bucket for proof photos
INSERT INTO storage.buckets (id, name, public) VALUES ('proof-photos', 'proof-photos', true) ON CONFLICT DO NOTHING;

-- RLS for proof-photos bucket
CREATE POLICY "Authenticated users can upload proof photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proof-photos');

CREATE POLICY "Anyone can view proof photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos');
