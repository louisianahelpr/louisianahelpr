
-- Allow helpers to update jobs they are assigned to (status, helper_completed_at, proof fields, tracking)
CREATE POLICY "Helpers can update their assigned jobs"
ON public.jobs
FOR UPDATE
USING (auth.uid() = helper_id)
WITH CHECK (auth.uid() = helper_id);
