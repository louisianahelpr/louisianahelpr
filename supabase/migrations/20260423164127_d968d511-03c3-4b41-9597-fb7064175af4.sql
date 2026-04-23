-- Public CDN URLs for files in `social-posts` keep working (Supabase serves them
-- directly from the public bucket CDN, bypassing storage.objects SELECT).
-- This change only stops anonymous users from listing every file in the bucket.
DROP POLICY IF EXISTS "Public can view social post images" ON storage.objects;

CREATE POLICY "Admins can list social post images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'social-posts'
  AND has_role(auth.uid(), 'admin'::app_role)
);