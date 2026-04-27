-- Make buckets public so existing /object/public/ URLs resolve
UPDATE storage.buckets SET public = true WHERE id IN ('user-documents', 'job-photos');

-- Public read policies (idempotent)
DROP POLICY IF EXISTS "Public read user-documents" ON storage.objects;
CREATE POLICY "Public read user-documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-documents');

DROP POLICY IF EXISTS "Public read job-photos" ON storage.objects;
CREATE POLICY "Public read job-photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'job-photos');

-- Owner-only write policies
DROP POLICY IF EXISTS "Owner upload user-documents" ON storage.objects;
CREATE POLICY "Owner upload user-documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Owner update user-documents" ON storage.objects;
CREATE POLICY "Owner update user-documents"
ON storage.objects FOR UPDATE
USING (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Owner delete user-documents" ON storage.objects;
CREATE POLICY "Owner delete user-documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Owner upload job-photos" ON storage.objects;
CREATE POLICY "Owner upload job-photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'job-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Owner update job-photos" ON storage.objects;
CREATE POLICY "Owner update job-photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'job-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Owner delete job-photos" ON storage.objects;
CREATE POLICY "Owner delete job-photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'job-photos' AND auth.uid()::text = (storage.foldername(name))[1]);