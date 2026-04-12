CREATE POLICY "Helpers can delete their own pending applications"
ON public.applications
FOR DELETE
TO authenticated
USING (auth.uid() = helper_id AND status = 'pending');