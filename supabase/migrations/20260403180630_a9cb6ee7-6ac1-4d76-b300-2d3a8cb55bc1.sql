
-- 1. Drop the overly permissive open jobs policy
DROP POLICY IF EXISTS "Anyone can view open jobs" ON public.jobs;

-- 2. Add a restricted policy: anon can only see open jobs with limited usefulness
-- Since we can't do column-level RLS, we limit anon access and let the frontend use the safe view
-- Anon users reading from the jobs table directly will still see all columns, 
-- but we revoke direct SELECT on jobs for anon and force them through the view
REVOKE SELECT ON public.jobs FROM anon;

-- Grant anon access only to the safe view
GRANT SELECT ON public.open_jobs_safe TO anon;

-- 3. Add UPDATE policies for storage buckets
CREATE POLICY "Users can update their own proof photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'proof-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own job photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'job-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
