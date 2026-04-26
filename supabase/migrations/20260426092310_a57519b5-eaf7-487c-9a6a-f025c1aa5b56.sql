-- Defense-in-depth: explicitly deny UPDATE and DELETE on user_roles for all
-- non-service callers. Role grants must go through the existing admin-only
-- INSERT policy; revocations must be performed by the service role only.

DROP POLICY IF EXISTS "Deny all updates to user_roles" ON public.user_roles;
CREATE POLICY "Deny all updates to user_roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny all deletes to user_roles" ON public.user_roles;
CREATE POLICY "Deny all deletes to user_roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated, anon
  USING (false);