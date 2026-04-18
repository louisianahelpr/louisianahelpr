-- 1) Fix addon_requests SELECT policy to include requested_by
DROP POLICY IF EXISTS "Job participants can view addons" ON public.addon_requests;

CREATE POLICY "Job participants can view addons"
ON public.addon_requests
FOR SELECT
USING (
  auth.uid() = requested_by
  OR auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = addon_requests.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = addon_requests.job_id)
);

-- 2) Tighten public bucket listing on job-photos and user-documents
-- Drop overly-broad SELECT policies that allow listing all files
DROP POLICY IF EXISTS "Anyone can view job photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view job photos" ON storage.objects;
DROP POLICY IF EXISTS "Job photos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view user documents" ON storage.objects;
DROP POLICY IF EXISTS "Public can view user documents" ON storage.objects;
DROP POLICY IF EXISTS "User documents are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for user-documents" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for job-photos" ON storage.objects;

-- Recreate: owners can list/manage their own files in their folder
CREATE POLICY "Users can list own job photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can list own user documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'user-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Note: Public direct-URL reads still work because both buckets are public.
-- Removing the broad SELECT policy only blocks listing/enumeration via the API.