-- Make application-attachments private
UPDATE storage.buckets SET public = false WHERE id = 'application-attachments';

-- Drop overly permissive existing policies on this bucket
DROP POLICY IF EXISTS "Anyone can view application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Helpers can upload application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Job participants can view application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Helpers can update own application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Helpers can delete own application attachments" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view application attachments" ON storage.objects;

-- Helper (uploader) can view their own files (path: {helper_id}/{job_id}/...)
CREATE POLICY "Helpers can view own application attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'application-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Job owner can view attachments for applications on their jobs
CREATE POLICY "Job owners can view application attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'application-attachments'
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id::text = (storage.foldername(name))[2]
      AND j.customer_id = auth.uid()
  )
);

-- Admins can view all
CREATE POLICY "Admins can view application attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'application-attachments'
  AND public.has_role(auth.uid(), 'admin')
);

-- Helpers can upload only into their own folder
CREATE POLICY "Helpers can upload application attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'application-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Helpers can update/delete only their own files
CREATE POLICY "Helpers can update own application attachments"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'application-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Helpers can delete own application attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'application-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);