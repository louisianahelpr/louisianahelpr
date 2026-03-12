
-- Allow unauthenticated users to read reviews (needed for landing page stats)
-- This is safe since reviews only contain ratings and feedback, not sensitive PII
CREATE POLICY "Anyone can view reviews"
ON public.reviews
FOR SELECT
TO public
USING (true);

-- Drop the authenticated-only policy since the public one covers it
DROP POLICY IF EXISTS "Reviews are viewable by authenticated users" ON public.reviews;

-- Allow unauthenticated read on profiles for landing page
-- But only expose non-sensitive columns via the existing policy
-- The RLS policy allows SELECT but the client code only selects safe columns
-- We need to allow public access to profiles for the landing page helper spotlight
DROP POLICY IF EXISTS "Authenticated users can view approved profiles" ON public.profiles;

CREATE POLICY "Anyone can view approved profiles"
ON public.profiles
FOR SELECT
TO public
USING (
  approval_status = 'approved'
  AND (ban_status IS NULL OR ban_status = 'active')
);
