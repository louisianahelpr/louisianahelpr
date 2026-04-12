
-- =============================================
-- 1. Realtime channel authorization
-- =============================================
-- Add RLS policies to realtime.messages to restrict channel subscriptions

-- Policy: Users can listen to their own channels (notifications, messages)
CREATE POLICY "Users can subscribe to own channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Allow if the topic contains the user's ID (e.g., user-specific channels)
  realtime.topic() ~ ('^(notifications|messages):' || auth.uid()::text)
  -- Allow admin access to all channels
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  -- Allow job participants to subscribe to job channels
  OR EXISTS (
    SELECT 1 FROM public.jobs
    WHERE (
      realtime.topic() ~ ('^jobs:' || jobs.id::text)
      OR realtime.topic() ~ ('^job_tracking:' || jobs.id::text)
      OR realtime.topic() ~ ('^job_checkins:' || jobs.id::text)
    )
    AND (jobs.customer_id = auth.uid() OR jobs.helper_id = auth.uid())
  )
  -- Allow general table subscriptions that are filtered by RLS on source tables
  OR realtime.topic() IN ('messages', 'notifications', 'jobs', 'job_tracking', 'job_checkins', 'applications')
);

-- =============================================
-- 2. Secure view for helper job access
-- =============================================
-- Create a view that strips sensitive payment/fee data for helpers

CREATE OR REPLACE VIEW public.jobs_helper_safe AS
SELECT
  id, title, description, category, location, date_needed, start_time,
  estimated_hours, budget, photos, special_requirements, status,
  helper_id, customer_id, created_at, updated_at,
  payment_status, -- helpers need to know if they'll get paid
  boosted_at, boost_expires_at,
  is_recurring, recurrence_interval, recurrence_end_date, parent_job_id,
  proof_before_urls, proof_after_urls,
  cancelled_by, cancelled_at, cancellation_reason, late_cancellation,
  poster_confirmed_at, helper_confirmed_at,
  poster_completed_at, helper_completed_at,
  helpers_needed, is_group_job,
  response_deadline, expires_at,
  revision_note, revision_requested_at, revision_deadline, revision_completed_at, revision_acceptance_deadline,
  dispute_reason, dispute_status, disputed_at, disputed_by, dispute_deadline,
  dispute_helper_response, dispute_resolved_at,
  is_urgent, urgent_fee,
  cancellation_fee, cancellation_fee_status,
  is_flexible_schedule,
  helper_on_the_way_at, helper_arrived_at,
  helper_fee_percent, -- helper needs their own fee percentage
  review_reminder_sent,
  latitude, longitude
  -- EXCLUDED: stripe_session_id, stripe_payment_intent_id, platform_fee_percent, 
  -- platform_fee_amount, customer_fee_amount, sales_tax_rate, sales_tax_amount,
  -- flag_reasons, removal_reason, removed_at, removed_by, payout_scheduled_at, dispute_evidence_urls
FROM public.jobs;

-- Grant access to the view
GRANT SELECT ON public.jobs_helper_safe TO authenticated;
