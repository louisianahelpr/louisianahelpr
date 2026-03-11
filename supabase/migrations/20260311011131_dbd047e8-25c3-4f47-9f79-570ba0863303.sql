-- Add portfolio_urls column to profiles for storing uploaded document URLs
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS portfolio_urls text[] DEFAULT '{}'::text[];

-- Create user-documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-documents', 'user-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload their own documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow public read access
CREATE POLICY "Anyone can view user documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-documents');

-- Allow users to delete their own documents
CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-documents' AND (storage.foldername(name))[1] = auth.uid()::text);