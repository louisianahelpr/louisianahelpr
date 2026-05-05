-- The handle_new_user trigger fires on every auth.users INSERT (signup).
-- It was still trying to write to profiles.role, which was DROPPED in
-- yesterday's role-checks-via-user-roles migration (20260504142454). The
-- READ side of that migration was fixed (p.role = 'helper' → has_role()),
-- but the WRITE side was missed — so EVERY signup since then has failed
-- with: ERROR: column "role" of relation "profiles" does not exist.
--
-- Confirmed via Postgres logs after a manual signup attempt 2026-05-05:
--   ERROR: column "role" of relation "profiles" does not exist
--   ERROR: current transaction is aborted, commands ignored until end of transaction block
--   → Auth API responds 500 "Database error saving new user"
--
-- Fix: split the INSERT — profiles row gets the non-role columns, and a
-- separate INSERT into user_roles records the role with the proper enum cast.
-- Also guards against unexpected role values in raw_user_meta_data
-- (only the three documented app roles are accepted; default to customer).

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
  IF v_role NOT IN ('customer', 'helper', 'admin') THEN
    v_role := 'customer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role::app_role);

  RETURN NEW;
END;
$function$;
