CREATE POLICY "Admins can view all ID documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'id-documents'
  AND public.has_role(auth.uid(), 'admin')
);