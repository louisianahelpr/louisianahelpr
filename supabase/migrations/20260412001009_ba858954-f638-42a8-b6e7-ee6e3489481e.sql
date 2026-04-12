
-- 1. Drop the overly permissive notification INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert job notifications" ON public.notifications;

-- 2. Create a tighter policy: only allow cross-user notifications for active jobs
CREATE POLICY "Job participants can insert notifications for active jobs"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (user_id = auth.uid())
  OR (EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.status IN ('open', 'accepted', 'in_progress', 'revision_requested', 'disputed')
      AND (
        (jobs.customer_id = auth.uid() AND jobs.helper_id = notifications.user_id)
        OR (jobs.helper_id = auth.uid() AND jobs.customer_id = notifications.user_id)
      )
  ))
);
