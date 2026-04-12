
-- Fix 1: Restrict profiles admin/service_role SELECT policies to authenticated role

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role can view all profiles" ON public.profiles;
CREATE POLICY "Service role can view all profiles"
  ON public.profiles FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: Remove user self-insert on notifications
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
