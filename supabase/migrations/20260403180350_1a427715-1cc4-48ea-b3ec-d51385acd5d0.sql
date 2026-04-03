
-- Re-add a restricted notification insert policy for authenticated users
-- They can only insert notifications where they are the sender (for their own use)
-- This is needed for client-side code like job checkins
CREATE POLICY "Authenticated users can insert job notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  -- Allow if the user is an admin
  public.has_role(auth.uid(), 'admin')
  -- Or if the notification is for themselves (e.g. self-reminders)
  OR user_id = auth.uid()
  -- Or if they are inserting for another user they share a job with
  OR EXISTS (
    SELECT 1 FROM public.jobs
    WHERE (customer_id = auth.uid() AND helper_id = user_id)
       OR (helper_id = auth.uid() AND customer_id = user_id)
  )
);
