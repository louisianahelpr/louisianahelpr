
-- 1. Make user-documents bucket private
UPDATE storage.buckets SET public = false WHERE id = 'user-documents';

-- 2. Drop overly permissive storage policies for user-documents
DROP POLICY IF EXISTS "Anyone can view user documents" ON storage.objects;

-- 3. Add proper user-documents policies (owner + admin only)
CREATE POLICY "Users can view their own documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'user-documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Admins can view all user documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'user-documents'
  AND public.has_role(auth.uid(), 'admin')
);

-- 4. Restrict proof-photos: drop permissive policy, add scoped one
DROP POLICY IF EXISTS "Anyone can view proof photos" ON storage.objects;

CREATE POLICY "Job participants can view proof photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proof-photos'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.jobs
      WHERE (customer_id = auth.uid() OR helper_id = auth.uid())
        AND (
          name = ANY(proof_before_urls) 
          OR name = ANY(proof_after_urls)
        )
    )
  )
);

-- 5. Remove self-insert notification policy (prevents spoofing)
DROP POLICY IF EXISTS "Users can insert their own notifications" ON public.notifications;

-- 6. Add service role insert policy for notifications (edge functions use service role)
CREATE POLICY "Service role can insert notifications"
ON public.notifications FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- 7. Remove duplicate referral code lookup policy
DROP POLICY IF EXISTS "Authenticated users can lookup referral codes" ON public.referral_codes;

-- 8. Create a secure view for open jobs that hides sensitive fields
CREATE OR REPLACE VIEW public.open_jobs_safe AS
SELECT 
  id, title, description, category, budget, date_needed, start_time,
  location, is_urgent, urgent_fee, is_flexible_schedule, is_recurring,
  is_group_job, helpers_needed, estimated_hours, photos, special_requirements,
  created_at, status, customer_id, expires_at, boosted_at, boost_expires_at
FROM public.jobs
WHERE status = 'open';

-- Grant access to the view
GRANT SELECT ON public.open_jobs_safe TO anon, authenticated;
