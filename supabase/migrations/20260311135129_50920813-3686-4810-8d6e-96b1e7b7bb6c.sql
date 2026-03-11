
-- Allow admins to insert roles
CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT
TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to delete roles
CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));
