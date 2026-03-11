
-- Add approval fields to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS id_document_url text;

-- Create storage bucket for ID documents
INSERT INTO storage.buckets (id, name, public) VALUES ('id-documents', 'id-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Only authenticated users can upload their own ID docs
CREATE POLICY "Users can upload their own ID docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'id-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can view their own ID docs
CREATE POLICY "Users can view their own ID docs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'id-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Admins can view all ID docs (using service role, no policy needed)
