CREATE POLICY "Authenticated users can view open jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (status = 'open');