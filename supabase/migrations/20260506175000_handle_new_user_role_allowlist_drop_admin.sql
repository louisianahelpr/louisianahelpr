-- handle_new_user previously allowlisted ('customer','helper','admin') for
-- the role pulled from auth.users.raw_user_meta_data->>'role'. The
-- prevent_admin_role_self_grant trigger does block the actual write when
-- v_role='admin', but at the cost of failing the whole signup with a
-- security-flavored error. Admin role is never set via signup metadata —
-- it's promoted via service_role tooling — so allowlist should be
-- ('customer','helper') only. Belt-and-suspenders defense.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );

  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'customer');
  -- admin removed from allowlist: signup metadata can never grant admin,
  -- the prevent_admin_role_self_grant trigger remains as defense-in-depth.
  IF v_role NOT IN ('customer', 'helper') THEN
    v_role := 'customer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role::app_role);

  RETURN NEW;
END;
$function$;
