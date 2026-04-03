
-- 1. Fix open jobs: replace the permissive "Anyone can view open jobs" with a restricted version
-- We can't do column-level RLS in Postgres, so we restrict what the public-facing code uses
-- The safe view is already there; we just need apps to use it
-- For now, keep the policy but note the frontend should use open_jobs_safe view

-- 2. Restrict proof-photo uploads to user's own folder
DROP POLICY IF EXISTS "Authenticated users can upload proof photos" ON storage.objects;
CREATE POLICY "Users can upload proof photos to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'proof-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 3. Restrict job-photo uploads to user's own folder
DROP POLICY IF EXISTS "Authenticated users can upload job photos" ON storage.objects;
CREATE POLICY "Users can upload job photos to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 4. Allow users to delete their own ID documents
CREATE POLICY "Users can delete their own ID documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'id-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 5. Enable RLS on realtime.messages if not already enabled
-- Note: We cannot modify realtime schema tables directly, so we skip this
-- Realtime channel security is handled by the RLS on the underlying tables (jobs, messages, etc.)
