-- Allow service_role to delete notifications (for cleanup function)
CREATE POLICY "Service role can delete notifications"
ON public.notifications
FOR DELETE
TO public
USING (auth.role() = 'service_role');

-- Also allow users to delete their own read notifications
CREATE POLICY "Users can delete own read notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND read = true);