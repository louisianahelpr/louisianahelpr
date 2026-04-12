-- Make user-documents public (avatars & portfolio are displayed to all users)
UPDATE storage.buckets SET public = true WHERE id = 'user-documents';

-- Add public read access policy
CREATE POLICY "Anyone can view user documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-documents');

-- Drop the restrictive owner-only policy 
DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
-- Drop admin-only policy (redundant when public)
DROP POLICY IF EXISTS "Admins can view all user documents" ON storage.objects;