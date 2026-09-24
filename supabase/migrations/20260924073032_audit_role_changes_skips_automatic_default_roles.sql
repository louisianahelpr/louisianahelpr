-- AM-004: audit_role_changes logged every signup's automatic default role grant
-- (and every account deletion's cascade revoke) as an "admin action" by the
-- zero-UUID sentinel: 742 of the rows on prod at 2026-09-24 were customer/helper
-- rows with no acting user, drowning the Audit Log an admin opens to answer
-- "who did what to whom". Now: a change to the ADMIN role is always logged
-- (whoever or whatever made it), and any change made by a signed-in user is
-- logged; only the automatic non-admin role bookkeeping with no actor is
-- skipped. Body otherwise the live pg_get_functiondef of 2026-09-24.
-- Existing rows are left in place (deleting audit history is an owner call).
CREATE OR REPLACE FUNCTION public.audit_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(NEW.role, OLD.role)::text <> 'admin' THEN -- AM-004 skip automatic default roles
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
      'role_granted',
      NEW.user_id::text,
      'user_role',
      jsonb_build_object('role', NEW.role)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
      'role_revoked',
      OLD.user_id::text,
      'user_role',
      jsonb_build_object('role', OLD.role)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
