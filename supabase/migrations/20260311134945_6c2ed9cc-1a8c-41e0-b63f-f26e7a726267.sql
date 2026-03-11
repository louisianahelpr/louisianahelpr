
-- Allow admins to update any profile (for approve/deny)
CREATE POLICY "Admins can update all profiles"
ON public.profiles FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to insert notifications for any user
CREATE POLICY "Admins can insert notifications for any user"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
