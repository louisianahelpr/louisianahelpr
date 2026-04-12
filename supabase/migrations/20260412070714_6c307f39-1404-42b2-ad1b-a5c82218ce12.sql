-- Drop the existing overly-permissive policy
DROP POLICY IF EXISTS "Users can subscribe to own channels" ON realtime.messages;

-- Recreate with scoped-only topics (no bare topic name fallback)
CREATE POLICY "Users can subscribe to own channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Personal channels scoped to user's own ID
  realtime.topic() ~ ('^(notifications|messages):' || auth.uid()::text)
  -- Admin bypass
  OR has_role(auth.uid(), 'admin')
  -- Job-related channels scoped to jobs where user is participant
  OR EXISTS (
    SELECT 1 FROM public.jobs
    WHERE (
      realtime.topic() ~ ('^jobs:' || jobs.id::text)
      OR realtime.topic() ~ ('^job_tracking:' || jobs.id::text)
      OR realtime.topic() ~ ('^job_checkins:' || jobs.id::text)
    )
    AND (jobs.customer_id = auth.uid() OR jobs.helper_id = auth.uid())
  )
);