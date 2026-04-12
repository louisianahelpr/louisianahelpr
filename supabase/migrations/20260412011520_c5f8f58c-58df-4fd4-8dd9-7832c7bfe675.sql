
-- Fix 1: Remove the overly permissive realtime policy and replace with a secure version
DROP POLICY IF EXISTS "Users can subscribe to own channels" ON public.messages;

CREATE POLICY "Users can subscribe to own channels"
ON public.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() ~ ('^(notifications|messages):' || auth.uid()::text))
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (EXISTS (
    SELECT 1 FROM jobs
    WHERE (
      (realtime.topic() ~ ('^jobs:' || jobs.id::text))
      OR (realtime.topic() ~ ('^job_tracking:' || jobs.id::text))
      OR (realtime.topic() ~ ('^job_checkins:' || jobs.id::text))
    )
    AND (jobs.customer_id = auth.uid() OR jobs.helper_id = auth.uid())
  ))
);

-- Fix 2: Replace the notifications insert policy that allows cross-user spoofing
DROP POLICY IF EXISTS "Job participants can insert notifications for active jobs" ON public.notifications;

CREATE POLICY "Users can insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR user_id = auth.uid()
);
