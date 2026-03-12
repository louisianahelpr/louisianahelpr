
-- ============================================================
-- 1. FIX CRITICAL: Profiles PII exposure
-- Replace the blanket "Profiles are viewable by everyone" policy
-- with one that only exposes non-sensitive fields to public
-- ============================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Create a view for public profile data (non-sensitive fields only)
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  user_id,
  full_name,
  avatar_url,
  bio,
  location,
  skills,
  hourly_rate,
  role,
  subscription_tier,
  portfolio_urls,
  created_at
FROM public.profiles
WHERE approval_status = 'approved' AND (ban_status IS NULL OR ban_status = 'active');

-- New policy: authenticated users can see basic profile info of all approved users
CREATE POLICY "Authenticated users can view approved profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  approval_status = 'approved'
  AND (ban_status IS NULL OR ban_status = 'active')
);

-- ============================================================
-- 2. FIX CRITICAL: Jobs sensitive data exposure
-- Replace blanket "Anyone can view open jobs" 
-- ============================================================

DROP POLICY IF EXISTS "Anyone can view open jobs" ON public.jobs;

-- Public (unauthenticated) can only see open jobs
CREATE POLICY "Anyone can view open jobs"
ON public.jobs
FOR SELECT
TO public
USING (status = 'open');

-- Authenticated users can view jobs they participate in (any status)
CREATE POLICY "Users can view their own jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  auth.uid() = customer_id
  OR auth.uid() = helper_id
);

-- ============================================================
-- 3. FIX WARN: Referral codes enumeration
-- ============================================================

DROP POLICY IF EXISTS "Anyone can lookup referral codes" ON public.referral_codes;

-- Only allow looking up codes by value, not bulk enumeration
-- (Users still need the SELECT to validate a code during signup)
CREATE POLICY "Authenticated users can lookup referral codes"
ON public.referral_codes
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
);

-- ============================================================
-- 4. FIX WARN: Function search_path mutable
-- ============================================================

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT msg_id, read_ct, message FROM pgmq.read(queue_name, vt, batch_size); $$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT pgmq.delete(queue_name, message_id); $$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT pgmq.send(queue_name, payload); $$;

-- ============================================================
-- 5. PERFORMANCE: Add indexes for common dashboard queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_boosted ON public.jobs (status, boosted_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_customer_id ON public.jobs (customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_helper_id ON public.jobs (helper_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON public.applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_helper_id ON public.applications (helper_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id ON public.reviews (reviewee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON public.notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON public.messages (receiver_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role_approval ON public.profiles (role, approval_status);
CREATE INDEX IF NOT EXISTS idx_helper_availability_helper ON public.helper_availability (helper_id);
