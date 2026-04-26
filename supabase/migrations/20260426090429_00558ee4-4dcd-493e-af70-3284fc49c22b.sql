-- Hard guard against privilege escalation on user_roles
-- Blocks any non-service-role insert/update that would grant the 'admin' role.
-- Admin grants must happen via service_role (edge functions / SQL by owner).

CREATE OR REPLACE FUNCTION public.prevent_admin_role_self_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Determine the effective Postgres role for this statement.
  -- service_role bypasses this check (used by edge functions / admin tooling).
  v_role := current_setting('role', true);

  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Block any attempt to insert or change a row to role='admin' via RLS path.
  IF NEW.role = 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Admin roles can only be granted via service_role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_role_grant_insert ON public.user_roles;
CREATE TRIGGER enforce_admin_role_grant_insert
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_self_grant();

DROP TRIGGER IF EXISTS enforce_admin_role_grant_update ON public.user_roles;
CREATE TRIGGER enforce_admin_role_grant_update
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_self_grant();