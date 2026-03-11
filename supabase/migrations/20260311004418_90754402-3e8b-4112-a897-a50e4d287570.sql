
-- Replace the overly permissive insert policy with one that only allows users to insert for themselves
DROP POLICY "Service role can insert notifications" ON public.notifications;

CREATE POLICY "Users can insert their own notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
