-- Single role model (Lexi 2026-05-06): no helper-vs-customer distinction
-- in the UI. Everyone is a "member" using the existing 'customer' enum
-- value as the universal role. Capabilities (post jobs, accept jobs)
-- gate on Stripe IDV + Stripe Connect at first action — not on role.
--
-- Trigger now ignores raw_user_meta_data->>'role' entirely. Any client
-- that tries to pass role='helper' at signup gets 'customer' instead.
-- Admin promotions stay separate (service_role only, prevent_admin_role_self_grant).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );

  -- Always 'customer' — the universal "member" value. Helper-vs-customer
  -- distinction lives nowhere in the UI; capability gates (IDV, Stripe
  -- Connect) determine what each user can do, not their role.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::app_role);

  RETURN NEW;
END;
$function$;
