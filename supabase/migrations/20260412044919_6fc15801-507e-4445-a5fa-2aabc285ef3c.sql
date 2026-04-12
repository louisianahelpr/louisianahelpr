CREATE POLICY "Helpers can update their own pending applications"
ON public.applications
FOR UPDATE
TO authenticated
USING (auth.uid() = helper_id AND status = 'pending')
WITH CHECK (auth.uid() = helper_id AND status = 'pending');